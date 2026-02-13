use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use mediasoup::prelude::{DtlsParameters, MediaKind, RtpCapabilities, RtpParameters};
use serde::Deserialize;
use tokio::sync::mpsc;
use uuid::Uuid;

use super::broadcast::{
    broadcast_channel_message, broadcast_global_message, cleanup_connection, send_server_message,
};
use super::messages::{ClientMessage, ServerMessage, VoicePresenceChannel};
use crate::auth::validate_token;
use crate::media::transport::{ProducerSource, RoutingMode, TransportDirection};
use crate::AppState;

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum MediaSignalRequest {
    GetRouterRtpCapabilities {
        request_id: Option<String>,
    },
    CreateWebrtcTransport {
        request_id: Option<String>,
        direction: String,
    },
    ConnectWebrtcTransport {
        request_id: Option<String>,
        transport_id: String,
        dtls_parameters: DtlsParameters,
    },
    MediaProduce {
        request_id: Option<String>,
        kind: String,
        source: Option<String>,
        routing_mode: Option<String>,
        rtp_parameters: RtpParameters,
    },
    MediaConsume {
        request_id: Option<String>,
        producer_id: String,
        rtp_capabilities: RtpCapabilities,
    },
    MediaResumeConsumer {
        request_id: Option<String>,
        consumer_id: String,
    },
    MediaCloseProducer {
        request_id: Option<String>,
        producer_id: String,
    },
}

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
    {
        let mut connection_usernames = state.connection_usernames.write().await;
        connection_usernames.insert(connection_id, claims.username.clone());
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
                let mut voice_members_by_connection =
                    state.voice_members_by_connection.write().await;
                voice_members_by_connection.insert(connection_id, channel_id)
            };

            let joined_new_channel = {
                let mut voice_members_by_channel = state.voice_members_by_channel.write().await;

                if let Some(previous_channel_id) = previous_channel_id {
                    if previous_channel_id != channel_id {
                        if let Some(usernames) =
                            voice_members_by_channel.get_mut(&previous_channel_id)
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
                    broadcast_voice_activity_to_channel(
                        state,
                        previous_channel_id,
                        &claims.username,
                        false,
                        None,
                    )
                    .await;
                    let closed_producers =
                        state.media.cleanup_connection_media(connection_id).await;
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
        ClientMessage::LeaveVoice { channel_id } => {
            let left_channel_id = {
                let mut voice_members_by_connection =
                    state.voice_members_by_connection.write().await;
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
        ClientMessage::VoiceActivity {
            channel_id,
            speaking,
        } => {
            let joined_channel = {
                let voice_members_by_connection = state.voice_members_by_connection.read().await;
                voice_members_by_connection.get(&connection_id).copied()
            };

            if joined_channel != Some(channel_id) {
                return;
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
            handle_media_signal_message(
                state,
                connection_id,
                &claims.username,
                channel_id,
                payload,
                out_tx,
            )
            .await;
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

async fn handle_media_signal_message(
    state: &AppState,
    connection_id: Uuid,
    username: &str,
    channel_id: Uuid,
    payload: serde_json::Value,
    out_tx: &mpsc::UnboundedSender<String>,
) {
    let request = match serde_json::from_value::<MediaSignalRequest>(payload) {
        Ok(request) => request,
        Err(error) => {
            send_server_message(
                out_tx,
                ServerMessage::MediaSignal {
                    channel_id,
                    payload: serde_json::json!({
                        "action": "signal_error",
                        "message": format!("Invalid media signal payload: {error}")
                    }),
                },
            );
            return;
        }
    };

    let joined_channel = {
        let voice_members_by_connection = state.voice_members_by_connection.read().await;
        voice_members_by_connection.get(&connection_id).copied()
    };

    if joined_channel != Some(channel_id) {
        let request_id = request_id_for(&request);
        send_media_signal_error(
            out_tx,
            channel_id,
            request_id,
            "Media signaling requires joining the voice channel first",
        );
        return;
    }

    match request {
        MediaSignalRequest::GetRouterRtpCapabilities { request_id } => {
            match state.media.router_rtp_capabilities(channel_id).await {
                Ok(rtp_capabilities) => {
                    send_server_message(
                        out_tx,
                        ServerMessage::MediaSignal {
                            channel_id,
                            payload: serde_json::json!({
                                "action": "router_rtp_capabilities",
                                "request_id": request_id,
                                "rtp_capabilities": rtp_capabilities,
                            }),
                        },
                    );
                }
                Err(error_message) => {
                    send_media_signal_error(out_tx, channel_id, request_id, &error_message);
                }
            }
        }
        MediaSignalRequest::CreateWebrtcTransport {
            request_id,
            direction,
        } => {
            let direction = match direction.as_str() {
                "send" => TransportDirection::Send,
                "recv" => TransportDirection::Recv,
                _ => {
                    send_media_signal_error(
                        out_tx,
                        channel_id,
                        request_id,
                        "direction must be 'send' or 'recv'",
                    );
                    return;
                }
            };

            match state
                .media
                .create_webrtc_transport_for_connection(connection_id, channel_id, direction)
                .await
            {
                Ok(transport) => {
                    send_server_message(
                        out_tx,
                        ServerMessage::MediaSignal {
                            channel_id,
                            payload: serde_json::json!({
                                "action": "webrtc_transport_created",
                                "request_id": request_id,
                                "direction": direction.as_str(),
                                "transport": transport,
                            }),
                        },
                    );

                    if direction == TransportDirection::Recv {
                        let existing_producers = state
                            .media
                            .list_channel_producers(channel_id, Some(connection_id))
                            .await;

                        for producer in existing_producers {
                            let username = {
                                let connection_usernames = state.connection_usernames.read().await;
                                connection_usernames
                                    .get(&producer.owner_connection_id)
                                    .cloned()
                            };

                            let Some(username) = username else {
                                tracing::warn!(
                                    producer_id = %producer.producer_id,
                                    owner_connection_id = %producer.owner_connection_id,
                                    "Skipping producer snapshot broadcast because owner username was not found"
                                );
                                continue;
                            };

                            send_server_message(
                                out_tx,
                                ServerMessage::MediaSignal {
                                    channel_id,
                                    payload: serde_json::json!({
                                        "action": "new_producer",
                                        "producer_id": producer.producer_id,
                                        "kind": producer.kind,
                                        "source": producer.source,
                                        "routing_mode": producer.routing_mode,
                                        "username": username,
                                    }),
                                },
                            );
                        }
                    }
                }
                Err(error_message) => {
                    send_media_signal_error(out_tx, channel_id, request_id, &error_message);
                }
            }
        }
        MediaSignalRequest::ConnectWebrtcTransport {
            request_id,
            transport_id,
            dtls_parameters,
        } => {
            match state
                .media
                .connect_webrtc_transport_for_connection(
                    connection_id,
                    channel_id,
                    &transport_id,
                    dtls_parameters,
                )
                .await
            {
                Ok(()) => {
                    send_server_message(
                        out_tx,
                        ServerMessage::MediaSignal {
                            channel_id,
                            payload: serde_json::json!({
                                "action": "webrtc_transport_connected",
                                "request_id": request_id,
                                "transport_id": transport_id,
                            }),
                        },
                    );
                }
                Err(error_message) => {
                    send_media_signal_error(out_tx, channel_id, request_id, &error_message);
                }
            }
        }
        MediaSignalRequest::MediaProduce {
            request_id,
            kind,
            source,
            routing_mode,
            rtp_parameters,
        } => {
            let kind = match kind.as_str() {
                "audio" => MediaKind::Audio,
                "video" => MediaKind::Video,
                _ => {
                    send_media_signal_error(
                        out_tx,
                        channel_id,
                        request_id,
                        "kind must be 'audio' or 'video'",
                    );
                    return;
                }
            };

            let source = match resolve_producer_source(kind, source.as_deref()) {
                Ok(source) => source,
                Err(message) => {
                    send_media_signal_error(out_tx, channel_id, request_id, &message);
                    return;
                }
            };

            let routing_mode = match resolve_routing_mode(routing_mode.as_deref()) {
                Ok(mode) => mode,
                Err(message) => {
                    send_media_signal_error(out_tx, channel_id, request_id, &message);
                    return;
                }
            };

            match state
                .media
                .create_producer_for_connection(
                    connection_id,
                    channel_id,
                    kind,
                    source,
                    routing_mode,
                    rtp_parameters,
                )
                .await
            {
                Ok(producer) => {
                    send_server_message(
                        out_tx,
                        ServerMessage::MediaSignal {
                            channel_id,
                            payload: serde_json::json!({
                                "action": "media_produced",
                                "request_id": request_id,
                                "producer_id": producer.producer_id,
                                "kind": producer.kind,
                                "source": producer.source,
                                "routing_mode": producer.routing_mode,
                            }),
                        },
                    );

                    broadcast_media_signal_to_voice_channel(
                        state,
                        channel_id,
                        serde_json::json!({
                            "action": "new_producer",
                            "producer_id": producer.producer_id,
                            "kind": producer.kind,
                            "source": producer.source,
                            "routing_mode": producer.routing_mode,
                            "username": username,
                        }),
                        Some(connection_id),
                    )
                    .await;
                }
                Err(error_message) => {
                    send_media_signal_error(out_tx, channel_id, request_id, &error_message);
                }
            }
        }
        MediaSignalRequest::MediaConsume {
            request_id,
            producer_id,
            rtp_capabilities,
        } => {
            match state
                .media
                .create_consumer_for_connection(
                    connection_id,
                    channel_id,
                    &producer_id,
                    rtp_capabilities,
                )
                .await
            {
                Ok(consumer) => {
                    send_server_message(
                        out_tx,
                        ServerMessage::MediaSignal {
                            channel_id,
                            payload: serde_json::json!({
                                "action": "media_consumer_created",
                                "request_id": request_id,
                                "consumer": consumer,
                            }),
                        },
                    );
                }
                Err(error_message) => {
                    send_media_signal_error(out_tx, channel_id, request_id, &error_message);
                }
            }
        }
        MediaSignalRequest::MediaResumeConsumer {
            request_id,
            consumer_id,
        } => {
            match state
                .media
                .resume_consumer_for_connection(connection_id, channel_id, &consumer_id)
                .await
            {
                Ok(()) => {
                    send_server_message(
                        out_tx,
                        ServerMessage::MediaSignal {
                            channel_id,
                            payload: serde_json::json!({
                                "action": "media_consumer_resumed",
                                "request_id": request_id,
                                "consumer_id": consumer_id,
                            }),
                        },
                    );
                }
                Err(error_message) => {
                    send_media_signal_error(out_tx, channel_id, request_id, &error_message);
                }
            }
        }
        MediaSignalRequest::MediaCloseProducer {
            request_id,
            producer_id,
        } => {
            match state
                .media
                .close_producer_for_connection(connection_id, channel_id, &producer_id)
                .await
            {
                Ok(closed_producer) => {
                    send_server_message(
                        out_tx,
                        ServerMessage::MediaSignal {
                            channel_id,
                            payload: serde_json::json!({
                                "action": "media_producer_closed",
                                "request_id": request_id,
                                "producer_id": producer_id,
                                "source": closed_producer.source,
                                "routing_mode": closed_producer.routing_mode,
                            }),
                        },
                    );

                    broadcast_closed_producers(state, &[closed_producer], Some(connection_id))
                        .await;
                }
                Err(error_message) => {
                    send_media_signal_error(out_tx, channel_id, request_id, &error_message);
                }
            }
        }
    }
}

fn request_id_for(request: &MediaSignalRequest) -> Option<String> {
    match request {
        MediaSignalRequest::GetRouterRtpCapabilities { request_id }
        | MediaSignalRequest::CreateWebrtcTransport { request_id, .. }
        | MediaSignalRequest::ConnectWebrtcTransport { request_id, .. }
        | MediaSignalRequest::MediaProduce { request_id, .. }
        | MediaSignalRequest::MediaConsume { request_id, .. }
        | MediaSignalRequest::MediaResumeConsumer { request_id, .. }
        | MediaSignalRequest::MediaCloseProducer { request_id, .. } => request_id.clone(),
    }
}

async fn broadcast_media_signal_to_voice_channel(
    state: &AppState,
    channel_id: Uuid,
    payload: serde_json::Value,
    exclude_connection_id: Option<Uuid>,
) {
    let target_connections: Vec<Uuid> = {
        let voice_members_by_connection = state.voice_members_by_connection.read().await;
        voice_members_by_connection
            .iter()
            .filter_map(|(connection_id, voice_channel_id)| {
                if *voice_channel_id == channel_id && Some(*connection_id) != exclude_connection_id
                {
                    Some(*connection_id)
                } else {
                    None
                }
            })
            .collect()
    };

    let connections = state.ws_connections.read().await;
    for connection_id in target_connections {
        if let Some(tx) = connections.get(&connection_id) {
            send_server_message(
                tx,
                ServerMessage::MediaSignal {
                    channel_id,
                    payload: payload.clone(),
                },
            );
        }
    }
}

async fn broadcast_voice_activity_to_channel(
    state: &AppState,
    channel_id: Uuid,
    username: &str,
    speaking: bool,
    exclude_connection_id: Option<Uuid>,
) {
    let target_connections: Vec<Uuid> = {
        let voice_members_by_connection = state.voice_members_by_connection.read().await;
        voice_members_by_connection
            .iter()
            .filter_map(|(connection_id, voice_channel_id)| {
                if *voice_channel_id == channel_id && Some(*connection_id) != exclude_connection_id
                {
                    Some(*connection_id)
                } else {
                    None
                }
            })
            .collect()
    };

    let connections = state.ws_connections.read().await;
    for connection_id in target_connections {
        if let Some(tx) = connections.get(&connection_id) {
            send_server_message(
                tx,
                ServerMessage::VoiceUserSpeaking {
                    channel_id,
                    username: username.to_owned(),
                    speaking,
                },
            );
        }
    }
}

async fn broadcast_closed_producers(
    state: &AppState,
    closed_producers: &[crate::media::transport::ClosedProducer],
    exclude_connection_id: Option<Uuid>,
) {
    for closed in closed_producers {
        broadcast_media_signal_to_voice_channel(
            state,
            closed.channel_id,
            serde_json::json!({
                "action": "producer_closed",
                "producer_id": closed.producer_id,
                "source": closed.source,
                "routing_mode": closed.routing_mode,
            }),
            exclude_connection_id,
        )
        .await;
    }
}

fn resolve_producer_source(
    kind: MediaKind,
    source: Option<&str>,
) -> Result<ProducerSource, String> {
    match source {
        Some("microphone") => {
            if kind != MediaKind::Audio {
                return Err("source 'microphone' requires kind 'audio'".into());
            }
            Ok(ProducerSource::Microphone)
        }
        Some("camera") => {
            if kind != MediaKind::Video {
                return Err("source 'camera' requires kind 'video'".into());
            }
            Ok(ProducerSource::Camera)
        }
        Some("screen") => {
            if kind != MediaKind::Video {
                return Err("source 'screen' requires kind 'video'".into());
            }
            Ok(ProducerSource::Screen)
        }
        Some(_) => Err("source must be 'microphone', 'camera', or 'screen'".into()),
        None => Ok(match kind {
            MediaKind::Audio => ProducerSource::Microphone,
            MediaKind::Video => ProducerSource::Camera,
        }),
    }
}

fn resolve_routing_mode(requested: Option<&str>) -> Result<RoutingMode, String> {
    match requested {
        Some("sfu") | None => Ok(RoutingMode::Sfu),
        _ => Err("routing_mode must be 'sfu'".into()),
    }
}

fn send_media_signal_error(
    out_tx: &mpsc::UnboundedSender<String>,
    channel_id: Uuid,
    request_id: Option<String>,
    message: &str,
) {
    send_server_message(
        out_tx,
        ServerMessage::MediaSignal {
            channel_id,
            payload: serde_json::json!({
                "action": "signal_error",
                "request_id": request_id,
                "message": message,
            }),
        },
    );
}
