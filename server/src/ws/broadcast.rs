use tokio::sync::mpsc;
use uuid::Uuid;

use super::messages::ServerMessage;
use crate::AppState;

pub fn send_server_message(tx: &mpsc::UnboundedSender<String>, msg: ServerMessage) {
    if let Ok(json) = serde_json::to_string(&msg) {
        let _ = tx.send(json);
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

            if tx.send(payload.clone()).is_err() {
                stale.push(connection_id);
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

            if tx.send(payload.clone()).is_err() {
                stale.push(connection_id);
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
                send_server_message(
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

    let mut removed_voice_channel = None;

    if let Some(connection_id) = connection_id {
        let mut ws_connections = state.ws_connections.write().await;
        ws_connections.remove(&connection_id);

        let mut connection_usernames = state.connection_usernames.write().await;
        let removed_username = connection_usernames.remove(&connection_id);

        if effective_username.is_none() {
            effective_username = removed_username;
        }

        let mut subscriptions = state.channel_subscriptions.write().await;
        subscriptions.remove(&connection_id);

        let mut voice_members_by_connection = state.voice_members_by_connection.write().await;
        removed_voice_channel = voice_members_by_connection.remove(&connection_id);
    }

    if let Some(username) = effective_username.as_deref() {
        let mut active_usernames = state.active_usernames.write().await;
        active_usernames.remove(username);
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
