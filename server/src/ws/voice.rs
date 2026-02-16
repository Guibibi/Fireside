use uuid::Uuid;

use super::broadcast::{send_server_message, WsEnqueueResult};
use super::messages::ServerMessage;
use crate::media::transport::ClosedProducer;
use crate::AppState;

pub async fn broadcast_media_signal_to_voice_channel(
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
            let send_result = send_server_message(
                tx,
                ServerMessage::MediaSignal {
                    channel_id,
                    payload: payload.clone(),
                },
            );

            if send_result == WsEnqueueResult::QueueFull {
                state.telemetry.inc_ws_queue_pressure();
                tracing::warn!(
                    connection_id = %connection_id,
                    channel_id = %channel_id,
                    "Dropped media signal due to full outbound websocket queue"
                );
            }
        }
    }
}

pub async fn broadcast_voice_activity_to_channel(
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
            let send_result = send_server_message(
                tx,
                ServerMessage::VoiceUserSpeaking {
                    channel_id,
                    username: username.to_owned(),
                    speaking,
                },
            );

            if send_result == WsEnqueueResult::QueueFull {
                state.telemetry.inc_ws_queue_pressure();
                tracing::warn!(
                    connection_id = %connection_id,
                    channel_id = %channel_id,
                    "Dropped voice activity signal due to full outbound websocket queue"
                );
            }
        }
    }
}

pub async fn broadcast_closed_producers(
    state: &AppState,
    closed_producers: &[ClosedProducer],
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
