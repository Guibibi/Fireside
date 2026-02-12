use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use uuid::Uuid;

use super::broadcast::{
    broadcast_channel_message, broadcast_global_message, cleanup_connection, send_server_message,
};
use super::messages::{ClientMessage, ServerMessage, VoicePresenceChannel};
use crate::auth::validate_token;
use crate::AppState;

pub async fn ws_upgrade(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sink, mut stream) = socket.split();

    let (claims, user_id) = loop {
        match stream.next().await {
            Some(Ok(Message::Text(text))) => match serde_json::from_str::<ClientMessage>(&text) {
                Ok(ClientMessage::Authenticate { token }) => {
                    let claims = match validate_token(&token, &state.config.jwt.secret) {
                        Ok(claims) => claims,
                        Err(_) => {
                            if let Ok(json) = serde_json::to_string(&ServerMessage::Error {
                                message: "Invalid token".into(),
                            }) {
                                let _ = sink.send(Message::Text(json.into())).await;
                            }
                            return;
                        }
                    };

                    let user_id_row: Option<(Uuid,)> =
                        sqlx::query_as("SELECT id FROM users WHERE username = $1")
                            .bind(&claims.username)
                            .fetch_optional(&state.db)
                            .await
                            .ok()
                            .flatten();

                    let Some((user_id,)) = user_id_row else {
                        if let Ok(json) = serde_json::to_string(&ServerMessage::Error {
                            message: "User not found".into(),
                        }) {
                            let _ = sink.send(Message::Text(json.into())).await;
                        }
                        return;
                    };

                    {
                        let mut active_usernames = state.active_usernames.write().await;
                        if active_usernames.contains(&claims.username) {
                            if let Ok(json) = serde_json::to_string(&ServerMessage::Error {
                                message: "Username already connected".into(),
                            }) {
                                let _ = sink.send(Message::Text(json.into())).await;
                            }
                            return;
                        }
                        active_usernames.insert(claims.username.clone());
                    }

                    break (claims, user_id);
                }
                _ => {
                    if let Ok(json) = serde_json::to_string(&ServerMessage::Error {
                        message: "Must authenticate first".into(),
                    }) {
                        let _ = sink.send(Message::Text(json.into())).await;
                    }
                    return;
                }
            },
            Some(Ok(Message::Close(_))) | None => {
                return;
            }
            _ => continue,
        }
    };

    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
    let writer = tokio::spawn(async move {
        while let Some(payload) = out_rx.recv().await {
            if sink.send(Message::Text(payload.into())).await.is_err() {
                break;
            }
        }
    });

    let connection_id = Uuid::new_v4();
    {
        let mut ws_connections = state.ws_connections.write().await;
        ws_connections.insert(connection_id, out_tx.clone());
    }

    send_server_message(
        &out_tx,
        ServerMessage::Authenticated {
            user_id,
            username: claims.username.clone(),
        },
    );

    let connected_usernames: Vec<String> = {
        let active_usernames = state.active_usernames.read().await;
        let mut usernames: Vec<String> = active_usernames.iter().cloned().collect();
        usernames.sort_unstable();
        usernames
    };

    send_server_message(
        &out_tx,
        ServerMessage::PresenceSnapshot {
            usernames: connected_usernames,
        },
    );

    let voice_presence_channels: Vec<VoicePresenceChannel> = {
        let voice_members_by_channel = state.voice_members_by_channel.read().await;
        let mut channels: Vec<VoicePresenceChannel> = voice_members_by_channel
            .iter()
            .map(|(channel_id, usernames)| {
                let mut sorted_usernames: Vec<String> = usernames.iter().cloned().collect();
                sorted_usernames.sort_unstable();
                VoicePresenceChannel {
                    channel_id: *channel_id,
                    usernames: sorted_usernames,
                }
            })
            .collect();
        channels.sort_by_key(|entry| entry.channel_id);
        channels
    };

    send_server_message(
        &out_tx,
        ServerMessage::VoicePresenceSnapshot {
            channels: voice_presence_channels,
        },
    );

    broadcast_global_message(
        &state,
        ServerMessage::UserConnected {
            username: claims.username.clone(),
        },
        Some(connection_id),
    )
    .await;

    while let Some(Ok(msg)) = stream.next().await {
        match msg {
            Message::Text(text) => match serde_json::from_str::<ClientMessage>(&text) {
                Ok(client_msg) => {
                    handle_client_message(&state, &claims, connection_id, client_msg, &out_tx)
                        .await;
                }
                Err(e) => {
                    send_server_message(
                        &out_tx,
                        ServerMessage::Error {
                            message: format!("Invalid message: {e}"),
                        },
                    );
                }
            },
            Message::Close(_) => break,
            _ => {}
        }
    }

    let disconnected_username = claims.username.clone();
    let removed_voice_channel =
        cleanup_connection(&state, Some(&disconnected_username), Some(connection_id)).await;
    if let Some(channel_id) = removed_voice_channel {
        broadcast_global_message(
            &state,
            ServerMessage::VoiceUserLeft {
                channel_id,
                username: disconnected_username.clone(),
            },
            None,
        )
        .await;
    }
    broadcast_global_message(
        &state,
        ServerMessage::UserDisconnected {
            username: disconnected_username,
        },
        None,
    )
    .await;
    writer.abort();
}

async fn handle_client_message(
    state: &AppState,
    claims: &crate::auth::Claims,
    connection_id: Uuid,
    msg: ClientMessage,
    out_tx: &mpsc::UnboundedSender<String>,
) {
    match msg {
        ClientMessage::SubscribeChannel { channel_id } => {
            let mut subscriptions = state.channel_subscriptions.write().await;
            subscriptions.insert(connection_id, channel_id);
        }
        ClientMessage::SendMessage {
            channel_id,
            content,
        } => {
            let trimmed = content.trim();
            if trimmed.is_empty() || trimmed.len() > 4000 {
                send_server_message(
                    out_tx,
                    ServerMessage::Error {
                        message: "Message content must be between 1 and 4000 characters".into(),
                    },
                );
                return;
            }

            let user_id_row: Option<(Uuid,)> =
                sqlx::query_as("SELECT id FROM users WHERE username = $1")
                    .bind(&claims.username)
                    .fetch_optional(&state.db)
                    .await
                    .ok()
                    .flatten();

            let Some((user_id,)) = user_id_row else {
                send_server_message(
                    out_tx,
                    ServerMessage::Error {
                        message: "User not found".into(),
                    },
                );
                return;
            };

            let message_row: Option<(Uuid, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
                "INSERT INTO messages (id, channel_id, author_id, content) VALUES ($1, $2, $3, $4) RETURNING id, created_at",
            )
            .bind(Uuid::new_v4())
            .bind(channel_id)
            .bind(user_id)
            .bind(trimmed)
            .fetch_one(&state.db)
            .await
            .ok();

            let Some((message_id, created_at)) = message_row else {
                send_server_message(
                    out_tx,
                    ServerMessage::Error {
                        message: "Failed to save message".into(),
                    },
                );
                return;
            };

            let response = ServerMessage::NewMessage {
                id: message_id,
                channel_id,
                author_id: user_id,
                author_username: claims.username.clone(),
                content: trimmed.to_string(),
                created_at: created_at.to_rfc3339(),
            };

            broadcast_channel_message(state, channel_id, response, None).await;
            broadcast_global_message(state, ServerMessage::ChannelActivity { channel_id }, None)
                .await;
        }
        ClientMessage::TypingStart { channel_id } => {
            let response = ServerMessage::TypingStart {
                channel_id,
                username: claims.username.clone(),
            };

            broadcast_channel_message(state, channel_id, response, Some(connection_id)).await;
        }
        ClientMessage::TypingStop { channel_id } => {
            let response = ServerMessage::TypingStop {
                channel_id,
                username: claims.username.clone(),
            };

            broadcast_channel_message(state, channel_id, response, Some(connection_id)).await;
        }
        ClientMessage::JoinVoice { channel_id } => {
            let channel_kind_row: Option<(String,)> =
                sqlx::query_as("SELECT kind::text FROM channels WHERE id = $1")
                    .bind(channel_id)
                    .fetch_optional(&state.db)
                    .await
                    .ok()
                    .flatten();

            let Some((channel_kind,)) = channel_kind_row else {
                send_server_message(
                    out_tx,
                    ServerMessage::Error {
                        message: "Channel not found".into(),
                    },
                );
                return;
            };

            if channel_kind != "voice" {
                send_server_message(
                    out_tx,
                    ServerMessage::Error {
                        message: "Selected channel is not voice-enabled".into(),
                    },
                );
                return;
            }

            let user_id_row: Option<(Uuid,)> =
                sqlx::query_as("SELECT id FROM users WHERE username = $1")
                    .bind(&claims.username)
                    .fetch_optional(&state.db)
                    .await
                    .ok()
                    .flatten();

            let Some((user_id,)) = user_id_row else {
                send_server_message(
                    out_tx,
                    ServerMessage::Error {
                        message: "User not found".into(),
                    },
                );
                return;
            };

            let previous_channel_id = {
                let mut voice_members_by_connection = state.voice_members_by_connection.write().await;
                voice_members_by_connection.insert(connection_id, channel_id)
            };

            let joined_new_channel = {
                let mut voice_members_by_channel = state.voice_members_by_channel.write().await;

                if let Some(previous_channel_id) = previous_channel_id {
                    if previous_channel_id != channel_id {
                        if let Some(usernames) = voice_members_by_channel.get_mut(&previous_channel_id)
                        {
                            usernames.remove(&claims.username);
                            if usernames.is_empty() {
                                voice_members_by_channel.remove(&previous_channel_id);
                            }
                        }
                    }
                }

                let channel_members = voice_members_by_channel.entry(channel_id).or_default();
                channel_members.insert(claims.username.clone())
            };

            if let Some(previous_channel_id) = previous_channel_id {
                if previous_channel_id != channel_id {
                    broadcast_global_message(
                        state,
                        ServerMessage::VoiceUserLeft {
                            channel_id: previous_channel_id,
                            username: claims.username.clone(),
                        },
                        None,
                    )
                    .await;
                }
            }

            if joined_new_channel || previous_channel_id != Some(channel_id) {
                broadcast_global_message(
                    state,
                    ServerMessage::VoiceUserJoined {
                        channel_id,
                        username: claims.username.clone(),
                    },
                    None,
                )
                .await;
            }

            send_server_message(
                out_tx,
                ServerMessage::VoiceJoined {
                    channel_id,
                    user_id,
                },
            );
        }
        ClientMessage::LeaveVoice { channel_id } => {
            let left_channel_id = {
                let mut voice_members_by_connection = state.voice_members_by_connection.write().await;
                voice_members_by_connection.remove(&connection_id)
            };

            if let Some(left_channel_id_value) = left_channel_id {
                let mut voice_members_by_channel = state.voice_members_by_channel.write().await;
                if let Some(usernames) = voice_members_by_channel.get_mut(&left_channel_id_value) {
                    usernames.remove(&claims.username);
                    if usernames.is_empty() {
                        voice_members_by_channel.remove(&left_channel_id_value);
                    }
                }

                broadcast_global_message(
                    state,
                    ServerMessage::VoiceUserLeft {
                        channel_id: left_channel_id_value,
                        username: claims.username.clone(),
                    },
                    None,
                )
                .await;
            }

            let user_id_row: Option<(Uuid,)> =
                sqlx::query_as("SELECT id FROM users WHERE username = $1")
                    .bind(&claims.username)
                    .fetch_optional(&state.db)
                    .await
                    .ok()
                    .flatten();

            let Some((user_id,)) = user_id_row else {
                send_server_message(
                    out_tx,
                    ServerMessage::Error {
                        message: "User not found".into(),
                    },
                );
                return;
            };

            send_server_message(
                out_tx,
                ServerMessage::VoiceLeft {
                    channel_id: left_channel_id.unwrap_or(channel_id),
                    user_id,
                },
            );
        }
        ClientMessage::MediaSignal {
            channel_id,
            payload,
        } => {
            send_server_message(
                out_tx,
                ServerMessage::MediaSignal {
                    channel_id,
                    payload,
                },
            );
        }
        ClientMessage::Authenticate { .. } => {
            send_server_message(
                out_tx,
                ServerMessage::Error {
                    message: "Already authenticated".into(),
                },
            );
        }
    }
}
