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

use super::messages::{ClientMessage, ServerMessage};
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
    cleanup_connection(&state, Some(&disconnected_username), Some(connection_id)).await;
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
                ServerMessage::VoiceJoined {
                    channel_id,
                    user_id,
                },
            );
        }
        ClientMessage::LeaveVoice { channel_id } => {
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
                    channel_id,
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

fn send_server_message(tx: &mpsc::UnboundedSender<String>, msg: ServerMessage) {
    if let Ok(json) = serde_json::to_string(&msg) {
        let _ = tx.send(json);
    }
}

async fn broadcast_channel_message(
    state: &AppState,
    channel_id: Uuid,
    msg: ServerMessage,
    exclude_connection_id: Option<Uuid>,
) {
    let payload = match serde_json::to_string(&msg) {
        Ok(payload) => payload,
        Err(_) => return,
    };

    let target_connections: Vec<Uuid> = {
        let subscriptions = state.channel_subscriptions.read().await;
        subscriptions
            .iter()
            .filter_map(|(connection_id, subscribed_channel)| {
                if *subscribed_channel == channel_id
                    && Some(*connection_id) != exclude_connection_id
                {
                    Some(*connection_id)
                } else {
                    None
                }
            })
            .collect()
    };

    let mut stale = Vec::new();
    {
        let connections = state.ws_connections.read().await;
        for connection_id in target_connections {
            let Some(tx) = connections.get(&connection_id) else {
                stale.push(connection_id);
                continue;
            };

            if tx.send(payload.clone()).is_err() {
                stale.push(connection_id);
            }
        }
    }

    if !stale.is_empty() {
        let mut connections = state.ws_connections.write().await;
        let mut subscriptions = state.channel_subscriptions.write().await;
        for connection_id in stale {
            connections.remove(&connection_id);
            subscriptions.remove(&connection_id);
        }
    }
}

async fn broadcast_global_message(
    state: &AppState,
    msg: ServerMessage,
    exclude_connection_id: Option<Uuid>,
) {
    let payload = match serde_json::to_string(&msg) {
        Ok(payload) => payload,
        Err(_) => return,
    };

    let target_connections: Vec<Uuid> = {
        let connections = state.ws_connections.read().await;
        connections
            .keys()
            .filter_map(|connection_id| {
                if Some(*connection_id) == exclude_connection_id {
                    None
                } else {
                    Some(*connection_id)
                }
            })
            .collect()
    };

    let mut stale = Vec::new();
    {
        let connections = state.ws_connections.read().await;
        for connection_id in target_connections {
            let Some(tx) = connections.get(&connection_id) else {
                stale.push(connection_id);
                continue;
            };

            if tx.send(payload.clone()).is_err() {
                stale.push(connection_id);
            }
        }
    }

    if !stale.is_empty() {
        let mut connections = state.ws_connections.write().await;
        let mut subscriptions = state.channel_subscriptions.write().await;
        for connection_id in stale {
            connections.remove(&connection_id);
            subscriptions.remove(&connection_id);
        }
    }
}

async fn cleanup_connection(state: &AppState, username: Option<&str>, connection_id: Option<Uuid>) {
    if let Some(username) = username {
        let mut active_usernames = state.active_usernames.write().await;
        active_usernames.remove(username);
    }

    if let Some(connection_id) = connection_id {
        let mut ws_connections = state.ws_connections.write().await;
        ws_connections.remove(&connection_id);

        let mut subscriptions = state.channel_subscriptions.write().await;
        subscriptions.remove(&connection_id);
    }
}
