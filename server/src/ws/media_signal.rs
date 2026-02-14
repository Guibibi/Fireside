use mediasoup::prelude::{DtlsParameters, MediaKind, RtpCapabilities, RtpParameters};
use serde::Deserialize;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use uuid::Uuid;

use super::broadcast::send_server_message;
use super::messages::ServerMessage;
use super::voice::{broadcast_closed_producers, broadcast_media_signal_to_voice_channel};
use crate::media::transport::{ProducerSource, RoutingMode, TransportDirection};
use crate::AppState;

pub const MAX_MEDIA_SIGNAL_PAYLOAD_BYTES: usize = 32 * 1024;
pub const MAX_REQUEST_ID_CHARS: usize = 128;
pub const MAX_ENTITY_ID_CHARS: usize = 128;
pub const MEDIA_SIGNAL_RATE_WINDOW: Duration = Duration::from_secs(5);
pub const MAX_MEDIA_SIGNAL_EVENTS_PER_WINDOW: u32 = 80;

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum MediaSignalRequest {
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
    CreateNativeSenderSession {
        request_id: Option<String>,
        preferred_codecs: Option<Vec<String>>,
    },
    ClientDiagnostic {
        request_id: Option<String>,
        event: String,
        detail: Option<String>,
    },
}

pub fn request_id_for(request: &MediaSignalRequest) -> Option<String> {
    match request {
        MediaSignalRequest::GetRouterRtpCapabilities { request_id }
        | MediaSignalRequest::CreateWebrtcTransport { request_id, .. }
        | MediaSignalRequest::ConnectWebrtcTransport { request_id, .. }
        | MediaSignalRequest::MediaProduce { request_id, .. }
        | MediaSignalRequest::MediaConsume { request_id, .. }
        | MediaSignalRequest::MediaResumeConsumer { request_id, .. }
        | MediaSignalRequest::MediaCloseProducer { request_id, .. }
        | MediaSignalRequest::CreateNativeSenderSession { request_id, .. }
        | MediaSignalRequest::ClientDiagnostic { request_id, .. } => request_id.clone(),
    }
}

pub fn request_id_from_payload(payload: &serde_json::Value) -> Option<String> {
    let request_id = payload.get("request_id")?.as_str()?;

    if request_id.is_empty() || request_id.len() > MAX_REQUEST_ID_CHARS {
        return None;
    }

    Some(request_id.to_owned())
}

pub fn media_signal_payload_size_bytes(payload: &serde_json::Value) -> usize {
    serde_json::to_vec(payload)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX)
}

pub fn validate_request_id(request_id: Option<&str>) -> Result<(), &'static str> {
    let Some(request_id) = request_id else {
        return Ok(());
    };

    if request_id.is_empty() {
        return Err("request_id cannot be empty");
    }

    if request_id.len() > MAX_REQUEST_ID_CHARS {
        return Err("request_id is too long");
    }

    Ok(())
}

pub fn validate_media_signal_request_fields(
    request: &MediaSignalRequest,
) -> Result<(), &'static str> {
    match request {
        MediaSignalRequest::CreateWebrtcTransport { direction, .. } => {
            if direction.len() > 16 {
                return Err("direction is too long");
            }
        }
        MediaSignalRequest::ConnectWebrtcTransport { transport_id, .. } => {
            if transport_id.is_empty() || transport_id.len() > MAX_ENTITY_ID_CHARS {
                return Err("transport_id is invalid");
            }
        }
        MediaSignalRequest::MediaProduce {
            kind,
            source,
            routing_mode,
            ..
        } => {
            if kind.is_empty() || kind.len() > 16 {
                return Err("kind is invalid");
            }

            if let Some(source) = source {
                if source.is_empty() || source.len() > 32 {
                    return Err("source is invalid");
                }
            }

            if let Some(routing_mode) = routing_mode {
                if routing_mode.is_empty() || routing_mode.len() > 16 {
                    return Err("routing_mode is invalid");
                }
            }
        }
        MediaSignalRequest::MediaConsume { producer_id, .. } => {
            if producer_id.is_empty() || producer_id.len() > MAX_ENTITY_ID_CHARS {
                return Err("producer_id is invalid");
            }
        }
        MediaSignalRequest::MediaResumeConsumer { consumer_id, .. } => {
            if consumer_id.is_empty() || consumer_id.len() > MAX_ENTITY_ID_CHARS {
                return Err("consumer_id is invalid");
            }
        }
        MediaSignalRequest::MediaCloseProducer { producer_id, .. } => {
            if producer_id.is_empty() || producer_id.len() > MAX_ENTITY_ID_CHARS {
                return Err("producer_id is invalid");
            }
        }
        MediaSignalRequest::ClientDiagnostic { event, detail, .. } => {
            if event.is_empty() || event.len() > 64 {
                return Err("event is invalid");
            }

            if let Some(detail) = detail {
                if detail.is_empty() || detail.len() > 512 {
                    return Err("detail is invalid");
                }
            }
        }
        MediaSignalRequest::CreateNativeSenderSession { .. } => {}
        MediaSignalRequest::GetRouterRtpCapabilities { .. } => {}
    }

    Ok(())
}

pub async fn allow_media_signal_event(state: &AppState, connection_id: Uuid) -> bool {
    let mut media_signal_rate_by_connection = state.media_signal_rate_by_connection.write().await;
    let now = Instant::now();

    let entry = media_signal_rate_by_connection
        .entry(connection_id)
        .or_insert(crate::MediaSignalRateState {
            window_started_at: now,
            events_in_window: 0,
        });

    if now.duration_since(entry.window_started_at) >= MEDIA_SIGNAL_RATE_WINDOW {
        entry.window_started_at = now;
        entry.events_in_window = 0;
    }

    if entry.events_in_window >= MAX_MEDIA_SIGNAL_EVENTS_PER_WINDOW {
        return false;
    }

    entry.events_in_window += 1;
    true
}

pub fn resolve_producer_source(
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

pub fn resolve_routing_mode(requested: Option<&str>) -> Result<RoutingMode, String> {
    match requested {
        Some("sfu") | None => Ok(RoutingMode::Sfu),
        _ => Err("routing_mode must be 'sfu'".into()),
    }
}

pub fn send_media_signal_error(
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

pub async fn handle_media_signal_message(
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

    let request_id = request_id_for(&request);
    if let Err(message) = validate_request_id(request_id.as_deref()) {
        tracing::warn!(
            connection_id = %connection_id,
            username = %username,
            channel_id = %channel_id,
            request_id = ?request_id,
            "Rejected media signaling request due to invalid request_id"
        );
        send_media_signal_error(out_tx, channel_id, request_id, message);
        return;
    }

    if let Err(message) = validate_media_signal_request_fields(&request) {
        tracing::warn!(
            connection_id = %connection_id,
            username = %username,
            channel_id = %channel_id,
            request_id = ?request_id,
            "Rejected media signaling request due to invalid field constraints"
        );
        send_media_signal_error(out_tx, channel_id, request_id, message);
        return;
    }

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
        MediaSignalRequest::CreateNativeSenderSession {
            request_id,
            preferred_codecs,
        } => {
            match state
                .media
                .create_native_sender_session_for_connection(
                    connection_id,
                    channel_id,
                    preferred_codecs,
                )
                .await
            {
                Ok(session) => {
                    send_server_message(
                        out_tx,
                        ServerMessage::MediaSignal {
                            channel_id,
                            payload: serde_json::json!({
                                "action": "native_sender_session_created",
                                "request_id": request_id,
                                "producer_id": session.producer_id,
                                "kind": session.kind,
                                "source": session.source,
                                "routing_mode": session.routing_mode,
                                "rtp_target": session.rtp_target,
                                "payload_type": session.payload_type,
                                "ssrc": session.ssrc,
                                "mime_type": session.mime_type,
                                "clock_rate": session.clock_rate,
                                "packetization_mode": session.packetization_mode,
                                "profile_level_id": session.profile_level_id,
                                "codec": session.codec,
                                "available_codecs": session.available_codecs,
                            }),
                        },
                    );

                    broadcast_media_signal_to_voice_channel(
                        state,
                        channel_id,
                        serde_json::json!({
                            "action": "new_producer",
                            "producer_id": session.producer_id,
                            "kind": session.kind,
                            "source": session.source,
                            "routing_mode": session.routing_mode,
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
        MediaSignalRequest::ClientDiagnostic {
            request_id,
            event,
            detail,
        } => {
            tracing::warn!(
                connection_id = %connection_id,
                username = %username,
                channel_id = %channel_id,
                event = %event,
                detail = ?detail,
                "Client media diagnostic"
            );

            if request_id.is_some() {
                send_server_message(
                    out_tx,
                    ServerMessage::MediaSignal {
                        channel_id,
                        payload: serde_json::json!({
                            "action": "client_diagnostic_logged",
                            "request_id": request_id,
                            "event": event,
                        }),
                    },
                );
            }
        }
    }
}
