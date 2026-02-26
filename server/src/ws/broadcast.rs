use tokio::sync::mpsc;
use tokio::sync::mpsc::error::TrySendError;
use uuid::Uuid;

use super::messages::ServerMessage;
use crate::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WsEnqueueResult {
    Enqueued,
    QueueFull,
    Closed,
    SerializeFailed,
}

pub fn send_server_message(tx: &mpsc::Sender<String>, msg: ServerMessage) -> WsEnqueueResult {
    let Ok(json) = serde_json::to_string(&msg) else {
        return WsEnqueueResult::SerializeFailed;
    };

    let result = enqueue_payload(tx, json);
    if result == WsEnqueueResult::QueueFull {
        tracing::warn!(
            "Dropped websocket message because outbound queue is full (slow-consumer policy: drop newest)"
        );
    }
    result
}

fn enqueue_payload(tx: &mpsc::Sender<String>, payload: String) -> WsEnqueueResult {
    match tx.try_send(payload) {
        Ok(()) => WsEnqueueResult::Enqueued,
        Err(TrySendError::Full(_)) => WsEnqueueResult::QueueFull,
        Err(TrySendError::Closed(_)) => WsEnqueueResult::Closed,
    }
}

pub async fn broadcast_channel_message(
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

            match enqueue_payload(tx, payload.clone()) {
                WsEnqueueResult::Enqueued => {}
                WsEnqueueResult::QueueFull => {
                    state.telemetry.inc_ws_queue_pressure();
                    tracing::warn!(
                        connection_id = %connection_id,
                        channel_id = %channel_id,
                        "Dropped websocket channel broadcast due to full outbound queue"
                    );
                }
                WsEnqueueResult::Closed => stale.push(connection_id),
                WsEnqueueResult::SerializeFailed => {}
            }
        }
    }

    if !stale.is_empty() {
        for connection_id in stale {
            cleanup_connection(state, None, Some(connection_id)).await;
            let closed_producers = state.media.cleanup_connection_media(connection_id).await;
            broadcast_closed_producers(state, &closed_producers, Some(connection_id)).await;
        }
    }
}

pub async fn broadcast_global_message(
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

            match enqueue_payload(tx, payload.clone()) {
                WsEnqueueResult::Enqueued => {}
                WsEnqueueResult::QueueFull => {
                    state.telemetry.inc_ws_queue_pressure();
                    tracing::warn!(
                        connection_id = %connection_id,
                        "Dropped global websocket broadcast due to full outbound queue"
                    );
                }
                WsEnqueueResult::Closed => stale.push(connection_id),
                WsEnqueueResult::SerializeFailed => {}
            }
        }
    }

    if !stale.is_empty() {
        for connection_id in stale {
            cleanup_connection(state, None, Some(connection_id)).await;
            let closed_producers = state.media.cleanup_connection_media(connection_id).await;
            broadcast_closed_producers(state, &closed_producers, Some(connection_id)).await;
        }
    }
}

pub async fn broadcast_dm_thread_message(
    state: &AppState,
    thread_id: Uuid,
    participant_ids: &[Uuid],
    msg: ServerMessage,
    exclude_connection_id: Option<Uuid>,
) {
    let payload = match serde_json::to_string(&msg) {
        Ok(payload) => payload,
        Err(_) => return,
    };

    let participant_set: std::collections::HashSet<Uuid> =
        participant_ids.iter().copied().collect();

    let target_connections: Vec<Uuid> = {
        let dm_subscriptions = state.dm_subscriptions.read().await;
        let connection_user_ids = state.connection_user_ids.read().await;
        dm_subscriptions
            .iter()
            .filter_map(|(connection_id, subscribed_thread_id)| {
                if *subscribed_thread_id != thread_id
                    || Some(*connection_id) == exclude_connection_id
                {
                    return None;
                }

                let user_id = connection_user_ids.get(connection_id)?;
                if participant_set.contains(user_id) {
                    Some(*connection_id)
                } else {
                    None
                }
            })
            .collect()
    };

    enqueue_broadcast_payload(state, target_connections, payload).await;
}

pub async fn broadcast_user_ids_message(
    state: &AppState,
    user_ids: &[Uuid],
    msg: ServerMessage,
    exclude_connection_id: Option<Uuid>,
) {
    let payload = match serde_json::to_string(&msg) {
        Ok(payload) => payload,
        Err(_) => return,
    };

    let user_id_set: std::collections::HashSet<Uuid> = user_ids.iter().copied().collect();
    let target_connections: Vec<Uuid> = {
        let connection_user_ids = state.connection_user_ids.read().await;
        connection_user_ids
            .iter()
            .filter_map(|(connection_id, connected_user_id)| {
                if Some(*connection_id) == exclude_connection_id {
                    return None;
                }

                if user_id_set.contains(connected_user_id) {
                    Some(*connection_id)
                } else {
                    None
                }
            })
            .collect()
    };

    enqueue_broadcast_payload(state, target_connections, payload).await;
}

async fn enqueue_broadcast_payload(
    state: &AppState,
    target_connections: Vec<Uuid>,
    payload: String,
) {
    let mut stale = Vec::new();
    {
        let connections = state.ws_connections.read().await;
        for connection_id in target_connections {
            let Some(tx) = connections.get(&connection_id) else {
                stale.push(connection_id);
                continue;
            };

            match enqueue_payload(tx, payload.clone()) {
                WsEnqueueResult::Enqueued => {}
                WsEnqueueResult::QueueFull => {
                    state.telemetry.inc_ws_queue_pressure();
                    tracing::warn!(
                        connection_id = %connection_id,
                        "Dropped targeted websocket message due to full outbound queue"
                    );
                }
                WsEnqueueResult::Closed => stale.push(connection_id),
                WsEnqueueResult::SerializeFailed => {}
            }
        }
    }

    if !stale.is_empty() {
        for connection_id in stale {
            cleanup_connection(state, None, Some(connection_id)).await;
            let closed_producers = state.media.cleanup_connection_media(connection_id).await;
            broadcast_closed_producers(state, &closed_producers, Some(connection_id)).await;
        }
    }
}

async fn broadcast_closed_producers(
    state: &AppState,
    closed_producers: &[crate::media::transport::ClosedProducer],
    exclude_connection_id: Option<Uuid>,
) {
    for closed in closed_producers {
        let target_connections: Vec<Uuid> = {
            let voice_members_by_connection = state.voice_members_by_connection.read().await;
            voice_members_by_connection
                .iter()
                .filter_map(|(connection_id, voice_channel_id)| {
                    if *voice_channel_id == closed.channel_id
                        && Some(*connection_id) != exclude_connection_id
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
                        channel_id: closed.channel_id,
                        payload: serde_json::json!({
                            "action": "producer_closed",
                            "producer_id": closed.producer_id,
                            "source": closed.source,
                            "routing_mode": closed.routing_mode,
                        }),
                    },
                );

                if send_result == WsEnqueueResult::QueueFull {
                    state.telemetry.inc_ws_queue_pressure();
                    tracing::warn!(
                        connection_id = %connection_id,
                        channel_id = %closed.channel_id,
                        "Dropped producer-closed signal due to full outbound queue"
                    );
                }
            }
        }
    }
}

pub async fn cleanup_connection(
    state: &AppState,
    username: Option<&str>,
    connection_id: Option<Uuid>,
) -> Option<Uuid> {
    let mut effective_username = username.map(ToOwned::to_owned);
    let mut removed_username_from_connection = None;
    let mut has_remaining_connection_for_removed_username = false;

    let mut removed_voice_channel = None;

    if let Some(connection_id) = connection_id {
        let mut ws_connections = state.ws_connections.write().await;
        ws_connections.remove(&connection_id);

        let mut media_signal_rate_by_connection =
            state.media_signal_rate_by_connection.write().await;
        media_signal_rate_by_connection.remove(&connection_id);

        let mut connection_usernames = state.connection_usernames.write().await;
        removed_username_from_connection = connection_usernames.remove(&connection_id);

        let mut connection_user_ids = state.connection_user_ids.write().await;
        connection_user_ids.remove(&connection_id);

        if let Some(removed_username) = removed_username_from_connection.as_deref() {
            has_remaining_connection_for_removed_username = connection_usernames
                .values()
                .any(|connected_username| connected_username == removed_username);
        }

        if effective_username.is_none() {
            effective_username = removed_username_from_connection.clone();
        }

        let mut subscriptions = state.channel_subscriptions.write().await;
        subscriptions.remove(&connection_id);

        let mut dm_subscriptions = state.dm_subscriptions.write().await;
        dm_subscriptions.remove(&connection_id);

        let mut voice_members_by_connection = state.voice_members_by_connection.write().await;
        removed_voice_channel = voice_members_by_connection.remove(&connection_id);
    }

    let username_for_presence_cleanup = if connection_id.is_some() {
        if has_remaining_connection_for_removed_username {
            None
        } else {
            removed_username_from_connection.as_deref()
        }
    } else {
        effective_username.as_deref()
    };

    if let Some(username) = username_for_presence_cleanup {
        let mut active_usernames = state.active_usernames.write().await;
        active_usernames.remove(username);

        let mut user_presence_by_username = state.user_presence_by_username.write().await;
        user_presence_by_username.remove(username);

        let mut voice_mute_state_by_username = state.voice_mute_state_by_username.write().await;
        voice_mute_state_by_username.remove(username);
    }

    if let (Some(voice_channel_id), Some(username)) =
        (removed_voice_channel, effective_username.as_deref())
    {
        let mut voice_members_by_channel = state.voice_members_by_channel.write().await;
        if let Some(usernames) = voice_members_by_channel.get_mut(&voice_channel_id) {
            usernames.remove(username);
            if usernames.is_empty() {
                voice_members_by_channel.remove(&voice_channel_id);
            }
        }
    }

    removed_voice_channel
}

pub async fn remove_channel_subscribers(state: &AppState, channel_id: Uuid) {
    let mut subscriptions = state.channel_subscriptions.write().await;
    subscriptions.retain(|_, subscribed_channel| *subscribed_channel != channel_id);
}
