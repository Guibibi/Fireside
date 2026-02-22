use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio::time::timeout;
use uuid::Uuid;

use super::broadcast::{
    broadcast_channel_message, broadcast_dm_thread_message, broadcast_global_message,
    broadcast_user_ids_message, cleanup_connection, send_server_message,
};
use super::media_signal::{
    allow_media_signal_event, handle_media_signal_message, media_signal_payload_size_bytes,
    request_id_from_payload, send_media_signal_error, MAX_MEDIA_SIGNAL_PAYLOAD_BYTES,
};
use super::messages::{ClientMessage, PresenceUser, ServerMessage, VoicePresenceChannel};
use super::voice::{broadcast_closed_producers, broadcast_voice_activity_to_channel};
use crate::auth::{validate_token, Claims};
use crate::message_attachments::{
    load_message_attachments_by_message, persist_message_attachments_in_tx,
    resolve_uploads_for_message,
};
use crate::AppState;

const WS_IDLE_TIMEOUT: Duration = Duration::from_secs(45);
const WS_AUTH_TIMEOUT: Duration = Duration::from_secs(15);
const PRESENCE_IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const WS_OUTBOUND_QUEUE_CAPACITY: usize = 256;

pub async fn ws_upgrade(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sink, mut stream) = socket.split();

    let (claims, user_id) = loop {
        let next_message = timeout(WS_AUTH_TIMEOUT, stream.next()).await;
        let Some(next_result) = (match next_message {
            Ok(result) => result,
            Err(_) => {
                if let Ok(json) = serde_json::to_string(&ServerMessage::Error {
                    message: "Authentication timed out".into(),
                }) {
                    let _ = sink.send(Message::Text(json.into())).await;
                }
                return;
            }
        }) else {
            return;
        };

        match next_result {
            Ok(Message::Text(text)) => match serde_json::from_str::<ClientMessage>(&text) {
                Ok(ClientMessage::Authenticate { token }) => {
                    let claims: Claims = match validate_token(&token, &state.config.jwt.secret) {
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

                    let user_id = claims.user_id;

                    let user_exists: bool =
                        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)")
                            .bind(user_id)
                            .fetch_one(&state.db)
                            .await
                            .unwrap_or(false);

                    if !user_exists {
                        if let Ok(json) = serde_json::to_string(&ServerMessage::Error {
                            message: "User not found".into(),
                        }) {
                            let _ = sink.send(Message::Text(json.into())).await;
                        }
                        return;
                    }

                    replace_existing_connection_for_username(&state, &claims.username).await;

                    {
                        let mut active_usernames = state.active_usernames.write().await;
                        active_usernames.insert(claims.username.clone());
                    }

                    {
                        let mut user_presence_by_username =
                            state.user_presence_by_username.write().await;
                        user_presence_by_username
                            .insert(claims.username.clone(), "online".to_string());
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
            Ok(Message::Close(_)) => {
                return;
            }
            Err(_) => {
                continue;
            }
            _ => continue,
        }
    };

    let (out_tx, mut out_rx) = mpsc::channel::<String>(WS_OUTBOUND_QUEUE_CAPACITY);
    let writer = tokio::spawn(async move {
        while let Some(payload) = out_rx.recv().await {
            if sink.send(Message::Text(payload.into())).await.is_err() {
                return;
            }
        }
    });

    let connection_id = Uuid::new_v4();
    {
        let mut ws_connections = state.ws_connections.write().await;
        ws_connections.insert(connection_id, out_tx.clone());
    }
    {
        let mut connection_usernames = state.connection_usernames.write().await;
        connection_usernames.insert(connection_id, claims.username.clone());
    }
    {
        let mut connection_user_ids = state.connection_user_ids.write().await;
        connection_user_ids.insert(connection_id, claims.user_id);
    }

    send_server_message(
        &out_tx,
        ServerMessage::Authenticated {
            user_id,
            username: claims.username.clone(),
            role: claims.role.clone(),
        },
    );

    let connected_users: Vec<PresenceUser> = {
        let user_presence_by_username = state.user_presence_by_username.read().await;
        let mut users: Vec<PresenceUser> = user_presence_by_username
            .iter()
            .map(|(username, status)| PresenceUser {
                username: username.clone(),
                status: status.clone(),
            })
            .collect();
        users.sort_unstable_by(|left, right| left.username.cmp(&right.username));
        users
    };

    send_server_message(
        &out_tx,
        ServerMessage::PresenceSnapshot {
            users: connected_users,
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
            status: "online".to_string(),
        },
        Some(connection_id),
    )
    .await;

    let mut last_client_activity_at = Instant::now();
    let mut last_presence_activity_at = Instant::now();
    let mut current_presence_status = "online".to_string();

    loop {
        let next_message = timeout(WS_IDLE_TIMEOUT, stream.next()).await;
        let Some(result) = (match next_message {
            Ok(result) => result,
            Err(_) => {
                tracing::warn!(
                    connection_id = %connection_id,
                    username = %claims.username,
                    idle_for_ms = WS_IDLE_TIMEOUT.as_millis(),
                    "Closing idle websocket connection"
                );
                break;
            }
        }) else {
            break;
        };

        let msg = match result {
            Ok(msg) => msg,
            Err(error) => {
                tracing::warn!(
                    connection_id = %connection_id,
                    username = %claims.username,
                    error = %error,
                    "Websocket stream error"
                );
                break;
            }
        };

        if !is_connection_active(&state, connection_id, &claims.username).await {
            tracing::info!(
                connection_id = %connection_id,
                username = %claims.username,
                "Closing stale websocket session after replacement"
            );
            break;
        }

        match msg {
            Message::Text(text) => {
                last_client_activity_at = Instant::now();
                match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(client_msg) => {
                        if !matches!(client_msg, ClientMessage::Heartbeat) {
                            last_presence_activity_at = Instant::now();
                            if current_presence_status != "online" {
                                update_presence_status(&state, &claims.username, "online").await;
                                current_presence_status = "online".to_string();
                            }
                        }

                        if handle_client_message(
                            &state,
                            &claims,
                            connection_id,
                            client_msg,
                            &out_tx,
                        )
                        .await
                        {
                            break;
                        }
                    }
                    Err(e) => {
                        tracing::warn!(
                            connection_id = %connection_id,
                            username = %claims.username,
                            payload_len = text.len(),
                            error = %e,
                            "Rejected invalid websocket message"
                        );
                        send_server_message(
                            &out_tx,
                            ServerMessage::Error {
                                message: format!("Invalid message: {e}"),
                            },
                        );
                    }
                }
            }
            Message::Ping(_) | Message::Pong(_) => {
                last_client_activity_at = Instant::now();
            }
            Message::Close(_) => break,
            _ => {}
        }

        if last_client_activity_at.elapsed() > WS_IDLE_TIMEOUT {
            tracing::warn!(
                connection_id = %connection_id,
                username = %claims.username,
                idle_for_ms = last_client_activity_at.elapsed().as_millis(),
                "Closing websocket connection due to inactivity"
            );
            break;
        }

        if current_presence_status == "online"
            && last_presence_activity_at.elapsed() > PRESENCE_IDLE_TIMEOUT
        {
            update_presence_status(&state, &claims.username, "idle").await;
            current_presence_status = "idle".to_string();
        }
    }

    let disconnected_username = claims.username.clone();
    let removed_voice_channel =
        cleanup_connection(&state, Some(&disconnected_username), Some(connection_id)).await;
    if let Some(channel_id) = removed_voice_channel {
        broadcast_voice_activity_to_channel(
            &state,
            channel_id,
            &disconnected_username,
            false,
            None,
        )
        .await;
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
    let closed_producers = state.media.cleanup_connection_media(connection_id).await;
    broadcast_closed_producers(&state, &closed_producers, Some(connection_id)).await;
    {
        let mut media_signal_rate_by_connection =
            state.media_signal_rate_by_connection.write().await;
        media_signal_rate_by_connection.remove(&connection_id);
    }
    if !username_has_active_connections(&state, &disconnected_username).await {
        broadcast_global_message(
            &state,
            ServerMessage::UserDisconnected {
                username: disconnected_username,
            },
            None,
        )
        .await;
    }
    writer.abort();
}

async fn is_connection_active(state: &AppState, connection_id: Uuid, username: &str) -> bool {
    let connection_usernames = state.connection_usernames.read().await;
    matches!(
        connection_usernames.get(&connection_id),
        Some(connected_username) if connected_username == username
    )
}

async fn update_presence_status(state: &AppState, username: &str, status: &str) {
    let did_change = {
        let mut user_presence_by_username = state.user_presence_by_username.write().await;
        if user_presence_by_username
            .get(username)
            .is_some_and(|current| current == status)
        {
            false
        } else {
            user_presence_by_username.insert(username.to_string(), status.to_string());
            true
        }
    };

    if did_change {
        broadcast_global_message(
            state,
            ServerMessage::UserStatusChanged {
                username: username.to_string(),
                status: status.to_string(),
            },
            None,
        )
        .await;
    }
}

async fn username_has_active_connections(state: &AppState, username: &str) -> bool {
    let connection_usernames = state.connection_usernames.read().await;
    connection_usernames
        .values()
        .any(|connected_username| connected_username == username)
}

async fn replace_existing_connection_for_username(state: &AppState, username: &str) {
    let existing_connection_id = {
        let connection_usernames = state.connection_usernames.read().await;
        connection_usernames
            .iter()
            .find_map(|(connection_id, connected_username)| {
                if connected_username == username {
                    Some(*connection_id)
                } else {
                    None
                }
            })
    };

    let Some(existing_connection_id) = existing_connection_id else {
        return;
    };

    tracing::info!(
        username = %username,
        connection_id = %existing_connection_id,
        "Replacing existing websocket session for username"
    );

    let existing_sender = {
        let connections = state.ws_connections.read().await;
        connections.get(&existing_connection_id).cloned()
    };

    if let Some(existing_sender) = existing_sender {
        send_server_message(
            &existing_sender,
            ServerMessage::Error {
                message: "You were logged out because this account connected from another session"
                    .into(),
            },
        );
    }

    let removed_voice_channel =
        cleanup_connection(state, Some(username), Some(existing_connection_id)).await;
    if let Some(channel_id) = removed_voice_channel {
        broadcast_voice_activity_to_channel(state, channel_id, username, false, None).await;
        broadcast_global_message(
            state,
            ServerMessage::VoiceUserLeft {
                channel_id,
                username: username.to_string(),
            },
            None,
        )
        .await;
    }

    let closed_producers = state
        .media
        .cleanup_connection_media(existing_connection_id)
        .await;
    broadcast_closed_producers(state, &closed_producers, Some(existing_connection_id)).await;

    if !username_has_active_connections(state, username).await {
        broadcast_global_message(
            state,
            ServerMessage::UserDisconnected {
                username: username.to_string(),
            },
            None,
        )
        .await;
    }
}

async fn handle_client_message(
    state: &AppState,
    claims: &crate::auth::Claims,
    connection_id: Uuid,
    msg: ClientMessage,
    out_tx: &mpsc::Sender<String>,
) -> bool {
    match msg {
        ClientMessage::SubscribeChannel { channel_id } => {
            let mut subscriptions = state.channel_subscriptions.write().await;
            subscriptions.insert(connection_id, channel_id);
        }
        ClientMessage::SubscribeDm { thread_id } => {
            if !is_dm_thread_participant(state, thread_id, claims.user_id).await {
                send_server_message(
                    out_tx,
                    ServerMessage::Error {
                        message: "DM thread not found".into(),
                    },
                );
                return false;
            }

            let mut subscriptions = state.dm_subscriptions.write().await;
            subscriptions.insert(connection_id, thread_id);
        }
        ClientMessage::SendMessage {
            channel_id,
            content,
            attachment_media_ids,
        } => {
            handle_send_message(
                state,
                claims,
                channel_id,
                content,
                attachment_media_ids,
                out_tx,
            )
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
        ClientMessage::TypingStartDm { thread_id } => {
            let Some((user_a_id, user_b_id)) = dm_thread_participants(state, thread_id).await
            else {
                send_server_message(
                    out_tx,
                    ServerMessage::Error {
                        message: "DM thread not found".into(),
                    },
                );
                return false;
            };

            if claims.user_id != user_a_id && claims.user_id != user_b_id {
                return false;
            }

            let participant_ids = [user_a_id, user_b_id];
            let response = ServerMessage::DmTypingStart {
                thread_id,
                username: claims.username.clone(),
            };
            broadcast_dm_thread_message(
                state,
                thread_id,
                &participant_ids,
                response,
                Some(connection_id),
            )
            .await;
        }
        ClientMessage::TypingStopDm { thread_id } => {
            let Some((user_a_id, user_b_id)) = dm_thread_participants(state, thread_id).await
            else {
                send_server_message(
                    out_tx,
                    ServerMessage::Error {
                        message: "DM thread not found".into(),
                    },
                );
                return false;
            };

            if claims.user_id != user_a_id && claims.user_id != user_b_id {
                return false;
            }

            let participant_ids = [user_a_id, user_b_id];
            let response = ServerMessage::DmTypingStop {
                thread_id,
                username: claims.username.clone(),
            };
            broadcast_dm_thread_message(
                state,
                thread_id,
                &participant_ids,
                response,
                Some(connection_id),
            )
            .await;
        }
        ClientMessage::SendDmMessage { thread_id, content } => {
            handle_send_dm_message(state, claims, connection_id, thread_id, content, out_tx).await;
        }
        ClientMessage::DmRead {
            thread_id,
            last_read_message_id,
        } => {
            handle_dm_read(state, claims, thread_id, last_read_message_id, out_tx).await;
        }
        ClientMessage::JoinVoice { channel_id } => {
            handle_join_voice(state, claims, connection_id, channel_id, out_tx).await;
        }
        ClientMessage::LeaveVoice { channel_id } => {
            handle_leave_voice(state, claims, connection_id, channel_id, out_tx).await;
        }
        ClientMessage::VoiceActivity {
            channel_id,
            speaking,
        } => {
            let joined_channel = {
                let voice_members_by_connection = state.voice_members_by_connection.read().await;
                voice_members_by_connection.get(&connection_id).copied()
            };

            if joined_channel != Some(channel_id) {
                return false;
            }

            broadcast_voice_activity_to_channel(
                state,
                channel_id,
                &claims.username,
                speaking,
                None,
            )
            .await;
        }
        ClientMessage::MediaSignal {
            channel_id,
            payload,
        } => {
            let request_id = request_id_from_payload(&payload);
            let payload_size = media_signal_payload_size_bytes(&payload);
            if payload_size > MAX_MEDIA_SIGNAL_PAYLOAD_BYTES {
                tracing::warn!(
                    connection_id = %connection_id,
                    username = %claims.username,
                    channel_id = %channel_id,
                    payload_size,
                    max_payload_size = MAX_MEDIA_SIGNAL_PAYLOAD_BYTES,
                    "Rejected oversized media signaling payload"
                );
                if send_media_signal_error(
                    state,
                    connection_id,
                    &claims.username,
                    out_tx,
                    channel_id,
                    request_id.clone(),
                    "Media signaling payload is too large",
                )
                .should_disconnect()
                {
                    return true;
                }
                return false;
            }

            if !allow_media_signal_event(state, connection_id).await {
                tracing::warn!(
                    connection_id = %connection_id,
                    username = %claims.username,
                    channel_id = %channel_id,
                    "Rate-limited media signaling request"
                );
                if send_media_signal_error(
                    state,
                    connection_id,
                    &claims.username,
                    out_tx,
                    channel_id,
                    request_id,
                    "Too many media signaling requests, please retry shortly",
                )
                .should_disconnect()
                {
                    return true;
                }
                return false;
            }

            if handle_media_signal_message(
                state,
                connection_id,
                &claims.username,
                channel_id,
                payload,
                out_tx,
            )
            .await
            {
                return true;
            }
        }
        ClientMessage::Heartbeat => {}
        ClientMessage::PresenceActivity => {}
        ClientMessage::Authenticate { .. } => {
            send_server_message(
                out_tx,
                ServerMessage::Error {
                    message: "Already authenticated".into(),
                },
            );
        }
    }

    false
}

async fn dm_thread_participants(state: &AppState, thread_id: Uuid) -> Option<(Uuid, Uuid)> {
    sqlx::query_as::<_, (Uuid, Uuid)>("SELECT user_a_id, user_b_id FROM dm_threads WHERE id = $1")
        .bind(thread_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
}

async fn is_dm_thread_participant(state: &AppState, thread_id: Uuid, user_id: Uuid) -> bool {
    dm_thread_participants(state, thread_id)
        .await
        .is_some_and(|(user_a_id, user_b_id)| user_id == user_a_id || user_id == user_b_id)
}

async fn dm_unread_count_for_user(
    state: &AppState,
    thread_id: Uuid,
    user_id: Uuid,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM dm_messages m
         LEFT JOIN dm_read_state rs
           ON rs.thread_id = m.thread_id
          AND rs.user_id = $2
         LEFT JOIN dm_messages lr
           ON lr.id = rs.last_read_message_id
         WHERE m.thread_id = $1
           AND m.author_id <> $2
           AND (
             rs.last_read_message_id IS NULL
             OR (m.created_at, m.id) > (lr.created_at, lr.id)
           )",
    )
    .bind(thread_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await
}

async fn current_dm_read_marker_for_user(
    state: &AppState,
    thread_id: Uuid,
    user_id: Uuid,
) -> Result<Option<(Uuid, chrono::DateTime<chrono::Utc>)>, sqlx::Error> {
    let row: Option<(Option<Uuid>, Option<chrono::DateTime<chrono::Utc>>)> = sqlx::query_as(
        "SELECT rs.last_read_message_id, m.created_at
         FROM dm_read_state rs
         LEFT JOIN dm_messages m
           ON m.id = rs.last_read_message_id
         WHERE rs.thread_id = $1
           AND rs.user_id = $2",
    )
    .bind(thread_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?;

    Ok(match row {
        Some((Some(message_id), Some(created_at))) => Some((message_id, created_at)),
        _ => None,
    })
}

async fn handle_send_dm_message(
    state: &AppState,
    claims: &crate::auth::Claims,
    connection_id: Uuid,
    thread_id: Uuid,
    content: String,
    out_tx: &mpsc::Sender<String>,
) {
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

    let Some((user_a_id, user_b_id)) = dm_thread_participants(state, thread_id).await else {
        send_server_message(
            out_tx,
            ServerMessage::Error {
                message: "DM thread not found".into(),
            },
        );
        return;
    };

    if claims.user_id != user_a_id && claims.user_id != user_b_id {
        send_server_message(
            out_tx,
            ServerMessage::Error {
                message: "DM thread not found".into(),
            },
        );
        return;
    }

    let participant_ids = [user_a_id, user_b_id];
    let message_id = Uuid::new_v4();
    let created_at = match sqlx::query_scalar::<_, chrono::DateTime<chrono::Utc>>(
        "INSERT INTO dm_messages (id, thread_id, author_id, content)
         VALUES ($1, $2, $3, $4)
         RETURNING created_at",
    )
    .bind(message_id)
    .bind(thread_id)
    .bind(claims.user_id)
    .bind(trimmed)
    .fetch_one(&state.db)
    .await
    {
        Ok(created_at) => created_at,
        Err(error) => {
            tracing::error!(thread_id = %thread_id, error = ?error, "Failed to insert DM message");
            send_server_message(
                out_tx,
                ServerMessage::Error {
                    message: "Failed to save DM message".into(),
                },
            );
            return;
        }
    };

    let _ = sqlx::query(
        "INSERT INTO dm_read_state (thread_id, user_id, last_read_message_id, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (thread_id, user_id)
         DO UPDATE SET
           last_read_message_id = EXCLUDED.last_read_message_id,
           updated_at = now()",
    )
    .bind(thread_id)
    .bind(claims.user_id)
    .bind(message_id)
    .execute(&state.db)
    .await;

    let author_display_name: String =
        sqlx::query_scalar("SELECT COALESCE(display_name, username) FROM users WHERE id = $1")
            .bind(claims.user_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| claims.username.clone());

    let preview = trimmed.chars().take(120).collect::<String>();
    let created_at_rfc3339 = created_at.to_rfc3339();

    broadcast_dm_thread_message(
        state,
        thread_id,
        &participant_ids,
        ServerMessage::NewDmMessage {
            id: message_id,
            thread_id,
            author_id: claims.user_id,
            author_username: claims.username.clone(),
            author_display_name,
            content: trimmed.to_string(),
            created_at: created_at_rfc3339.clone(),
            edited_at: None,
        },
        None,
    )
    .await;

    broadcast_user_ids_message(
        state,
        &participant_ids,
        ServerMessage::DmThreadUpdated {
            thread_id,
            last_message_id: Some(message_id),
            last_message_preview: Some(preview),
            last_message_at: Some(created_at_rfc3339),
        },
        None,
    )
    .await;

    for participant_id in participant_ids {
        if let Ok(unread_count) = dm_unread_count_for_user(state, thread_id, participant_id).await {
            broadcast_user_ids_message(
                state,
                &[participant_id],
                ServerMessage::DmUnreadUpdated {
                    thread_id,
                    unread_count,
                },
                None,
            )
            .await;
        }
    }

    broadcast_dm_thread_message(
        state,
        thread_id,
        &participant_ids,
        ServerMessage::DmTypingStop {
            thread_id,
            username: claims.username.clone(),
        },
        Some(connection_id),
    )
    .await;
}

async fn handle_dm_read(
    state: &AppState,
    claims: &crate::auth::Claims,
    thread_id: Uuid,
    last_read_message_id: Option<Uuid>,
    out_tx: &mpsc::Sender<String>,
) {
    if !is_dm_thread_participant(state, thread_id, claims.user_id).await {
        send_server_message(
            out_tx,
            ServerMessage::Error {
                message: "DM thread not found".into(),
            },
        );
        return;
    }

    let requested_marker = if let Some(message_id) = last_read_message_id {
        match sqlx::query_scalar::<_, chrono::DateTime<chrono::Utc>>(
            "SELECT created_at FROM dm_messages WHERE id = $1 AND thread_id = $2",
        )
        .bind(message_id)
        .bind(thread_id)
        .fetch_optional(&state.db)
        .await
        {
            Ok(Some(created_at)) => Some((message_id, created_at)),
            Ok(None) => {
                send_server_message(
                    out_tx,
                    ServerMessage::Error {
                        message: "DM message not found".into(),
                    },
                );
                return;
            }
            Err(error) => {
                tracing::error!(thread_id = %thread_id, user_id = %claims.user_id, error = ?error, "Failed to load requested DM read marker");
                send_server_message(
                    out_tx,
                    ServerMessage::Error {
                        message: "Failed to update read marker".into(),
                    },
                );
                return;
            }
        }
    } else {
        None
    };

    let current_marker = match current_dm_read_marker_for_user(state, thread_id, claims.user_id)
        .await
    {
        Ok(marker) => marker,
        Err(error) => {
            tracing::error!(thread_id = %thread_id, user_id = %claims.user_id, error = ?error, "Failed to load current DM read marker");
            send_server_message(
                out_tx,
                ServerMessage::Error {
                    message: "Failed to update read marker".into(),
                },
            );
            return;
        }
    };

    let next_marker = match (current_marker, requested_marker) {
        (Some((current_id, current_at)), Some((requested_id, requested_at))) => {
            if (requested_at, requested_id) >= (current_at, current_id) {
                Some(requested_id)
            } else {
                Some(current_id)
            }
        }
        (None, Some((requested_id, _))) => Some(requested_id),
        (Some((current_id, _)), None) => Some(current_id),
        (None, None) => None,
    };

    if let Err(error) = sqlx::query(
        "INSERT INTO dm_read_state (thread_id, user_id, last_read_message_id, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (thread_id, user_id)
         DO UPDATE SET
           last_read_message_id = EXCLUDED.last_read_message_id,
           updated_at = now()",
    )
    .bind(thread_id)
    .bind(claims.user_id)
    .bind(next_marker)
    .execute(&state.db)
    .await
    {
        tracing::error!(thread_id = %thread_id, user_id = %claims.user_id, error = ?error, "Failed to upsert DM read marker");
        send_server_message(
            out_tx,
            ServerMessage::Error {
                message: "Failed to update read marker".into(),
            },
        );
        return;
    }

    match dm_unread_count_for_user(state, thread_id, claims.user_id).await {
        Ok(unread_count) => {
            broadcast_user_ids_message(
                state,
                &[claims.user_id],
                ServerMessage::DmUnreadUpdated {
                    thread_id,
                    unread_count,
                },
                None,
            )
            .await;
        }
        Err(error) => {
            tracing::error!(thread_id = %thread_id, user_id = %claims.user_id, error = ?error, "Failed to compute DM unread count");
        }
    }
}

#[tracing::instrument(skip(state, claims, out_tx, content, attachment_media_ids), fields(channel_id = %channel_id, user_id = %claims.user_id))]
async fn handle_send_message(
    state: &AppState,
    claims: &crate::auth::Claims,
    channel_id: Uuid,
    content: String,
    attachment_media_ids: Vec<Uuid>,
    out_tx: &mpsc::Sender<String>,
) {
    let trimmed = content.trim();
    if trimmed.len() > 4000 {
        send_server_message(
            out_tx,
            ServerMessage::Error {
                message: "Message content must be 4000 characters or fewer".into(),
            },
        );
        return;
    }

    let user_id = claims.user_id;

    let resolved_attachments =
        match resolve_uploads_for_message(state, user_id, &attachment_media_ids).await {
            Ok(attachments) => attachments,
            Err(error) => {
                let message = match error {
                    crate::errors::AppError::BadRequest(message)
                    | crate::errors::AppError::Unauthorized(message)
                    | crate::errors::AppError::NotFound(message)
                    | crate::errors::AppError::Conflict(message)
                    | crate::errors::AppError::TooManyRequests(message)
                    | crate::errors::AppError::Internal(message) => message,
                };
                send_server_message(out_tx, ServerMessage::Error { message });
                return;
            }
        };

    if trimmed.is_empty() && resolved_attachments.is_empty() {
        send_server_message(
            out_tx,
            ServerMessage::Error {
                message: "Message content cannot be empty without attachments".into(),
            },
        );
        return;
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(
                channel_id = %channel_id,
                username = %claims.username,
                error = ?error,
                "Failed to begin transaction for message send"
            );
            send_server_message(
                out_tx,
                ServerMessage::Error {
                    message: "Failed to save message".into(),
                },
            );
            return;
        }
    };

    let message_insert_started = Instant::now();
    let message_row: Result<(Uuid, chrono::DateTime<chrono::Utc>), sqlx::Error> = sqlx::query_as(
        "INSERT INTO messages (id, channel_id, author_id, content) VALUES ($1, $2, $3, $4) RETURNING id, created_at",
    )
    .bind(Uuid::new_v4())
    .bind(channel_id)
    .bind(user_id)
    .bind(trimmed)
    .fetch_one(&mut *tx)
    .await;
    state.telemetry.observe_db_query(
        "ws.handle_send_message.insert",
        message_insert_started.elapsed(),
    );

    let (message_id, created_at) = match message_row {
        Ok(row) => row,
        Err(error) => {
            tracing::error!(
                channel_id = %channel_id,
                username = %claims.username,
                error = ?error,
                "Failed to insert message row"
            );
            send_server_message(
                out_tx,
                ServerMessage::Error {
                    message: "Failed to save message".into(),
                },
            );
            return;
        }
    };

    if let Err(error) =
        persist_message_attachments_in_tx(&mut tx, message_id, &resolved_attachments).await
    {
        tracing::error!(
            message_id = %message_id,
            channel_id = %channel_id,
            username = %claims.username,
            error = ?error,
            "Failed to persist message attachments"
        );
        send_server_message(
            out_tx,
            ServerMessage::Error {
                message: "Failed to save message attachments".into(),
            },
        );
        return;
    }

    if let Err(error) = sqlx::query(
        "INSERT INTO channel_read_state (channel_id, user_id, last_read_message_id, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (channel_id, user_id)
         DO UPDATE SET
           last_read_message_id = EXCLUDED.last_read_message_id,
           updated_at = now()",
    )
    .bind(channel_id)
    .bind(user_id)
    .bind(message_id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(
            message_id = %message_id,
            channel_id = %channel_id,
            username = %claims.username,
            error = ?error,
            "Failed to upsert channel read marker"
        );
        send_server_message(
            out_tx,
            ServerMessage::Error {
                message: "Failed to save message".into(),
            },
        );
        return;
    }

    if let Err(error) = tx.commit().await {
        tracing::error!(
            message_id = %message_id,
            channel_id = %channel_id,
            username = %claims.username,
            error = ?error,
            "Failed to commit message transaction"
        );
        send_server_message(
            out_tx,
            ServerMessage::Error {
                message: "Failed to save message".into(),
            },
        );
        return;
    }

    let attachments_load_started = Instant::now();
    let attachments = match load_message_attachments_by_message(&state.db, &[message_id]).await {
        Ok(by_message) => by_message.get(&message_id).cloned().unwrap_or_default(),
        Err(error) => {
            tracing::warn!(message_id = %message_id, error = ?error, "Failed to load message attachments for websocket payload");
            Vec::new()
        }
    };
    state.telemetry.observe_db_query(
        "ws.handle_send_message.load_attachments",
        attachments_load_started.elapsed(),
    );

    let author_display_name: String =
        sqlx::query_scalar("SELECT COALESCE(display_name, username) FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| claims.username.clone());

    let response = ServerMessage::NewMessage {
        id: message_id,
        channel_id,
        author_id: user_id,
        author_username: claims.username.clone(),
        author_display_name,
        content: trimmed.to_string(),
        created_at: created_at.to_rfc3339(),
        attachments,
    };

    broadcast_channel_message(state, channel_id, response, None).await;
    broadcast_global_message(state, ServerMessage::ChannelActivity { channel_id }, None).await;
}

async fn handle_join_voice(
    state: &AppState,
    claims: &crate::auth::Claims,
    connection_id: Uuid,
    channel_id: Uuid,
    out_tx: &mpsc::Sender<String>,
) {
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

    let user_id = claims.user_id;

    let previous_channel_id = {
        let mut voice_members_by_connection = state.voice_members_by_connection.write().await;
        voice_members_by_connection.insert(connection_id, channel_id)
    };

    let joined_new_channel = {
        let mut voice_members_by_channel = state.voice_members_by_channel.write().await;

        if let Some(previous_channel_id) = previous_channel_id {
            if previous_channel_id != channel_id {
                if let Some(usernames) = voice_members_by_channel.get_mut(&previous_channel_id) {
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
            broadcast_voice_activity_to_channel(
                state,
                previous_channel_id,
                &claims.username,
                false,
                None,
            )
            .await;
            let closed_producers = state.media.cleanup_connection_media(connection_id).await;
            broadcast_closed_producers(state, &closed_producers, Some(connection_id)).await;
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

async fn handle_leave_voice(
    state: &AppState,
    claims: &crate::auth::Claims,
    connection_id: Uuid,
    channel_id: Uuid,
    out_tx: &mpsc::Sender<String>,
) {
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

        broadcast_voice_activity_to_channel(
            state,
            left_channel_id_value,
            &claims.username,
            false,
            None,
        )
        .await;

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

    let closed_producers = state.media.cleanup_connection_media(connection_id).await;
    broadcast_closed_producers(state, &closed_producers, Some(connection_id)).await;

    send_server_message(
        out_tx,
        ServerMessage::VoiceLeft {
            channel_id: left_channel_id.unwrap_or(channel_id),
            user_id: claims.user_id,
        },
    );
}
