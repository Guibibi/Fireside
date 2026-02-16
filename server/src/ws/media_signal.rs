use mediasoup::prelude::{DtlsParameters, MediaKind, RtpCapabilities, RtpParameters};
use serde::Deserialize;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use uuid::Uuid;

use super::broadcast::{send_server_message, WsEnqueueResult};
use super::messages::ServerMessage;
use super::voice::{broadcast_closed_producers, broadcast_media_signal_to_voice_channel};
use crate::media::router::OpusConfig;
use crate::media::transport::{ProducerSource, RoutingMode, TransportDirection};
use crate::AppState;

pub const MAX_MEDIA_SIGNAL_PAYLOAD_BYTES: usize = 32 * 1024;
pub const MAX_REQUEST_ID_CHARS: usize = 128;
pub const MAX_ENTITY_ID_CHARS: usize = 128;
pub const MEDIA_SIGNAL_RATE_WINDOW: Duration = Duration::from_secs(5);
pub const MAX_MEDIA_SIGNAL_EVENTS_PER_WINDOW: u32 = 80;

async fn get_channel_opus_config(state: &AppState, channel_id: Uuid) -> OpusConfig {
    let result =
        sqlx::query_as("SELECT opus_bitrate, opus_dtx, opus_fec FROM channels WHERE id = $1")
            .bind(channel_id)
            .fetch_optional(&state.db)
            .await;

    let row: Option<(Option<i32>, Option<bool>, Option<bool>)> = match result {
        Ok(row) => row,
        Err(e) => {
            tracing::warn!(
                "Failed to fetch opus config for channel {}: {}",
                channel_id,
                e
            );
            None
        }
    };

    row.map(|(bitrate, dtx, fec)| OpusConfig {
        bitrate: bitrate.map(|b| b as u32),
        dtx,
        fec,
    })
    .unwrap_or_default()
}

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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MediaSignalSendOutcome {
    Delivered,
    Dropped,
    Disconnect,
}

impl MediaSignalSendOutcome {
    fn is_delivered(self) -> bool {
        matches!(self, Self::Delivered)
    }

    fn should_stop_processing(self) -> bool {
        !self.is_delivered()
    }

    pub fn should_disconnect(self) -> bool {
        matches!(self, Self::Disconnect)
    }
}

fn send_media_signal_payload(
    state: &AppState,
    connection_id: Uuid,
    username: &str,
    out_tx: &mpsc::Sender<String>,
    channel_id: Uuid,
    payload: serde_json::Value,
) -> MediaSignalSendOutcome {
    match send_server_message(
        out_tx,
        ServerMessage::MediaSignal {
            channel_id,
            payload,
        },
    ) {
        WsEnqueueResult::Enqueued => MediaSignalSendOutcome::Delivered,
        WsEnqueueResult::QueueFull => {
            state.telemetry.inc_ws_queue_pressure();
            tracing::warn!(
                connection_id = %connection_id,
                username = %username,
                channel_id = %channel_id,
                "Closing websocket connection because media response queue is full"
            );
            MediaSignalSendOutcome::Disconnect
        }
        WsEnqueueResult::Closed => MediaSignalSendOutcome::Disconnect,
        WsEnqueueResult::SerializeFailed => {
            tracing::error!(
                connection_id = %connection_id,
                username = %username,
                channel_id = %channel_id,
                "Failed to serialize media signaling response"
            );
            MediaSignalSendOutcome::Dropped
        }
    }
}

pub fn send_media_signal_error(
    state: &AppState,
    connection_id: Uuid,
    username: &str,
    out_tx: &mpsc::Sender<String>,
    channel_id: Uuid,
    request_id: Option<String>,
    message: &str,
) -> MediaSignalSendOutcome {
    send_media_signal_payload(
        state,
        connection_id,
        username,
        out_tx,
        channel_id,
        serde_json::json!({
            "action": "signal_error",
            "request_id": request_id,
            "message": message,
        }),
    )
}

pub async fn handle_media_signal_message(
    state: &AppState,
    connection_id: Uuid,
    username: &str,
    channel_id: Uuid,
    payload: serde_json::Value,
    out_tx: &mpsc::Sender<String>,
) -> bool {
    let request = match serde_json::from_value::<MediaSignalRequest>(payload) {
        Ok(request) => request,
        Err(error) => {
            if send_media_signal_payload(
                state,
                connection_id,
                username,
                out_tx,
                channel_id,
                serde_json::json!({
                    "action": "signal_error",
                    "message": format!("Invalid media signal payload: {error}")
                }),
            )
            .should_disconnect()
            {
                return true;
            }
            return false;
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
        if send_media_signal_error(
            state,
            connection_id,
            username,
            out_tx,
            channel_id,
            request_id,
            message,
        )
        .should_disconnect()
        {
            return true;
        }
        return false;
    }

    if let Err(message) = validate_media_signal_request_fields(&request) {
        tracing::warn!(
            connection_id = %connection_id,
            username = %username,
            channel_id = %channel_id,
            request_id = ?request_id,
            "Rejected media signaling request due to invalid field constraints"
        );
        if send_media_signal_error(
            state,
            connection_id,
            username,
            out_tx,
            channel_id,
            request_id,
            message,
        )
        .should_disconnect()
        {
            return true;
        }
        return false;
    }

    let joined_channel = {
        let voice_members_by_connection = state.voice_members_by_connection.read().await;
        voice_members_by_connection.get(&connection_id).copied()
    };

    if joined_channel != Some(channel_id) {
        let request_id = request_id_for(&request);
        if send_media_signal_error(
            state,
            connection_id,
            username,
            out_tx,
            channel_id,
            request_id,
            "Media signaling requires joining the voice channel first",
        )
        .should_disconnect()
        {
            return true;
        }
        return false;
    }

    match request {
        MediaSignalRequest::GetRouterRtpCapabilities { request_id } => {
            let opus_config = get_channel_opus_config(state, channel_id).await;
            match state
                .media
                .router_rtp_capabilities(channel_id, opus_config)
                .await
            {
                Ok(rtp_capabilities) => {
                    if send_media_signal_payload(
                        state,
                        connection_id,
                        username,
                        out_tx,
                        channel_id,
                        serde_json::json!({
                            "action": "router_rtp_capabilities",
                            "request_id": request_id,
                            "rtp_capabilities": rtp_capabilities,
                        }),
                    )
                    .should_disconnect()
                    {
                        return true;
                    }
                }
                Err(error_message) => {
                    if send_media_signal_error(
                        state,
                        connection_id,
                        username,
                        out_tx,
                        channel_id,
                        request_id,
                        &error_message,
                    )
                    .should_disconnect()
                    {
                        return true;
                    }
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
                    if send_media_signal_error(
                        state,
                        connection_id,
                        username,
                        out_tx,
                        channel_id,
                        request_id,
                        "direction must be 'send' or 'recv'",
                    )
                    .should_disconnect()
                    {
                        return true;
                    }
                    return false;
                }
            };

            let opus_config = get_channel_opus_config(state, channel_id).await;
            match state
                .media
                .create_webrtc_transport_for_connection(
                    connection_id,
                    channel_id,
                    direction,
                    opus_config,
                )
                .await
            {
                Ok(transport) => {
                    let send_outcome = send_media_signal_payload(
                        state,
                        connection_id,
                        username,
                        out_tx,
                        channel_id,
                        serde_json::json!({
                            "action": "webrtc_transport_created",
                            "request_id": request_id,
                            "direction": direction.as_str(),
                            "transport": transport,
                        }),
                    );
                    if send_outcome.should_disconnect() {
                        return true;
                    }
                    if send_outcome.should_stop_processing() {
                        return false;
                    }

                    if direction == TransportDirection::Recv {
                        let existing_producers = state
                            .media
                            .list_channel_producers(channel_id, Some(connection_id))
                            .await;

                        for producer in existing_producers {
                            let producer_owner_username = {
                                let connection_usernames = state.connection_usernames.read().await;
                                connection_usernames
                                    .get(&producer.owner_connection_id)
                                    .cloned()
                            };

                            let Some(producer_owner_username) = producer_owner_username else {
                                tracing::warn!(
                                    producer_id = %producer.producer_id,
                                    owner_connection_id = %producer.owner_connection_id,
                                    "Skipping producer snapshot broadcast because owner username was not found"
                                );
                                continue;
                            };

                            let send_outcome = send_media_signal_payload(
                                state,
                                connection_id,
                                username,
                                out_tx,
                                channel_id,
                                serde_json::json!({
                                    "action": "new_producer",
                                    "producer_id": producer.producer_id,
                                    "kind": producer.kind,
                                    "source": producer.source,
                                    "routing_mode": producer.routing_mode,
                                    "username": producer_owner_username,
                                }),
                            );
                            if send_outcome.should_disconnect() {
                                return true;
                            }
                            if send_outcome.should_stop_processing() {
                                return false;
                            }
                        }
                    }
                }
                Err(error_message) => {
                    if send_media_signal_error(
                        state,
                        connection_id,
                        username,
                        out_tx,
                        channel_id,
                        request_id,
                        &error_message,
                    )
                    .should_disconnect()
                    {
                        return true;
                    }
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
                    if send_media_signal_payload(
                        state,
                        connection_id,
                        username,
                        out_tx,
                        channel_id,
                        serde_json::json!({
                            "action": "webrtc_transport_connected",
                            "request_id": request_id,
                            "transport_id": transport_id,
                        }),
                    )
                    .should_disconnect()
                    {
                        return true;
                    }
                }
                Err(error_message) => {
                    if send_media_signal_error(
                        state,
                        connection_id,
                        username,
                        out_tx,
                        channel_id,
                        request_id,
                        &error_message,
                    )
                    .should_disconnect()
                    {
                        return true;
                    }
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
                    if send_media_signal_error(
                        state,
                        connection_id,
                        username,
                        out_tx,
                        channel_id,
                        request_id,
                        "kind must be 'audio' or 'video'",
                    )
                    .should_disconnect()
                    {
                        return true;
                    }
                    return false;
                }
            };

            let source = match resolve_producer_source(kind, source.as_deref()) {
                Ok(source) => source,
                Err(message) => {
                    if send_media_signal_error(
                        state,
                        connection_id,
                        username,
                        out_tx,
                        channel_id,
                        request_id,
                        &message,
                    )
                    .should_disconnect()
                    {
                        return true;
                    }
                    return false;
                }
            };

            let routing_mode = match resolve_routing_mode(routing_mode.as_deref()) {
                Ok(mode) => mode,
                Err(message) => {
                    if send_media_signal_error(
                        state,
                        connection_id,
                        username,
                        out_tx,
                        channel_id,
                        request_id,
                        &message,
                    )
                    .should_disconnect()
                    {
                        return true;
                    }
                    return false;
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
                    let send_outcome = send_media_signal_payload(
                        state,
                        connection_id,
                        username,
                        out_tx,
                        channel_id,
                        serde_json::json!({
                            "action": "media_produced",
                            "request_id": request_id,
                            "producer_id": producer.producer_id,
                            "kind": producer.kind,
                            "source": producer.source,
                            "routing_mode": producer.routing_mode,
                        }),
                    );
                    if send_outcome.should_disconnect() {
                        return true;
                    }
                    if send_outcome.should_stop_processing() {
                        return false;
                    }

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
                    if send_media_signal_error(
                        state,
                        connection_id,
                        username,
                        out_tx,
                        channel_id,
                        request_id,
                        &error_message,
                    )
                    .should_disconnect()
                    {
                        return true;
                    }
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
                    if send_media_signal_payload(
                        state,
                        connection_id,
                        username,
                        out_tx,
                        channel_id,
                        serde_json::json!({
                            "action": "media_consumer_created",
                            "request_id": request_id,
                            "consumer": consumer,
                        }),
                    )
                    .should_disconnect()
                    {
                        return true;
                    }
                }
                Err(error_message) => {
                    if send_media_signal_error(
                        state,
                        connection_id,
                        username,
                        out_tx,
                        channel_id,
                        request_id,
                        &error_message,
                    )
                    .should_disconnect()
                    {
                        return true;
                    }
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
                    if send_media_signal_payload(
                        state,
                        connection_id,
                        username,
                        out_tx,
                        channel_id,
                        serde_json::json!({
                            "action": "media_consumer_resumed",
                            "request_id": request_id,
                            "consumer_id": consumer_id,
                        }),
                    )
                    .should_disconnect()
                    {
                        return true;
                    }
                }
                Err(error_message) => {
                    if send_media_signal_error(
                        state,
                        connection_id,
                        username,
                        out_tx,
                        channel_id,
                        request_id,
                        &error_message,
                    )
                    .should_disconnect()
                    {
                        return true;
                    }
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
                    let send_outcome = send_media_signal_payload(
                        state,
                        connection_id,
                        username,
                        out_tx,
                        channel_id,
                        serde_json::json!({
                            "action": "media_producer_closed",
                            "request_id": request_id,
                            "producer_id": producer_id,
                            "source": closed_producer.source,
                            "routing_mode": closed_producer.routing_mode,
                        }),
                    );
                    if send_outcome.should_disconnect() {
                        return true;
                    }
                    if send_outcome.should_stop_processing() {
                        return false;
                    }

                    broadcast_closed_producers(state, &[closed_producer], Some(connection_id))
                        .await;
                }
                Err(error_message) => {
                    if send_media_signal_error(
                        state,
                        connection_id,
                        username,
                        out_tx,
                        channel_id,
                        request_id,
                        &error_message,
                    )
                    .should_disconnect()
                    {
                        return true;
                    }
                }
            }
        }
        MediaSignalRequest::CreateNativeSenderSession {
            request_id,
            preferred_codecs,
        } => {
            let opus_config = get_channel_opus_config(state, channel_id).await;
            match state
                .media
                .create_native_sender_session_for_connection(
                    connection_id,
                    channel_id,
                    preferred_codecs,
                    opus_config,
                )
                .await
            {
                Ok(session) => {
                    let send_outcome = send_media_signal_payload(
                        state,
                        connection_id,
                        username,
                        out_tx,
                        channel_id,
                        serde_json::json!({
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
                    );
                    if send_outcome.should_disconnect() {
                        return true;
                    }
                    if send_outcome.should_stop_processing() {
                        return false;
                    }

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
                    if send_media_signal_error(
                        state,
                        connection_id,
                        username,
                        out_tx,
                        channel_id,
                        request_id,
                        &error_message,
                    )
                    .should_disconnect()
                    {
                        return true;
                    }
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
                if send_media_signal_payload(
                    state,
                    connection_id,
                    username,
                    out_tx,
                    channel_id,
                    serde_json::json!({
                        "action": "client_diagnostic_logged",
                        "request_id": request_id,
                        "event": event,
                    }),
                )
                .should_disconnect()
                {
                    return true;
                }
            }
        }
    }

    false
}
