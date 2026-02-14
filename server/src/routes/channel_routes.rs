use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::validate_token;
use crate::errors::AppError;
use crate::models::{Channel, ChannelKind, Message};
use crate::ws::broadcast::{
    broadcast_channel_message, broadcast_global_message, remove_channel_subscribers,
};
use crate::ws::messages::ServerMessage;
use crate::AppState;

#[derive(Deserialize)]
pub struct CreateChannelRequest {
    pub name: String,
    pub description: Option<String>,
    pub kind: ChannelKind,
}

#[derive(Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
}

#[derive(Deserialize)]
pub struct EditMessageRequest {
    pub content: String,
}

#[derive(Deserialize)]
pub struct MessageQuery {
    pub before: Option<Uuid>,
    pub limit: Option<i64>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct MessageWithAuthor {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub author_id: Uuid,
    pub author_username: String,
    pub content: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub edited_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/channels", get(get_channels).post(create_channel))
        .route(
            "/channels/{channel_id}",
            get(get_channel).delete(delete_channel),
        )
        .route(
            "/channels/{channel_id}/messages",
            get(get_messages).post(send_message),
        )
        .route(
            "/messages/{message_id}",
            axum::routing::patch(edit_message).delete(delete_message),
        )
}

fn extract_username(headers: &axum::http::HeaderMap, secret: &str) -> Result<String, AppError> {
    let header = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::Unauthorized("Missing authorization header".into()))?;

    let token = header
        .strip_prefix("Bearer ")
        .ok_or_else(|| AppError::Unauthorized("Invalid authorization format".into()))?;

    let claims = validate_token(token, secret)
        .map_err(|_| AppError::Unauthorized("Invalid token".into()))?;
    Ok(claims.username)
}

async fn lookup_user_id(state: &AppState, username: &str) -> Result<Uuid, AppError> {
    let row: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM users WHERE username = $1")
        .bind(username)
        .fetch_optional(&state.db)
        .await?;

    row.map(|(id,)| id)
        .ok_or_else(|| AppError::Unauthorized("User not found".into()))
}

async fn create_channel(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<CreateChannelRequest>,
) -> Result<Json<Channel>, AppError> {
    let _username = extract_username(&headers, &state.config.jwt.secret)?;

    let trimmed_name = body.name.trim();
    if trimmed_name.is_empty() || trimmed_name.len() > 100 {
        return Err(AppError::BadRequest(
            "Channel name must be between 1 and 100 characters".into(),
        ));
    }

    let trimmed_description = body.description.as_deref().map(str::trim);
    let description = match trimmed_description {
        Some(value) if !value.is_empty() => {
            if value.chars().count() > 280 {
                return Err(AppError::BadRequest(
                    "Channel description must be 280 characters or fewer".into(),
                ));
            }
            Some(value)
        }
        _ => None,
    };

    let (max_pos,): (i32,) = sqlx::query_as("SELECT COALESCE(MAX(position), -1) FROM channels")
        .fetch_one(&state.db)
        .await?;
    let position = max_pos + 1;

    let kind_str = match body.kind {
        ChannelKind::Text => "text",
        ChannelKind::Voice => "voice",
    };

    let channel: Channel = sqlx::query_as(
        "INSERT INTO channels (id, name, description, kind, position) VALUES ($1, $2, $3, $4::channel_kind, $5) RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(trimmed_name)
    .bind(description)
    .bind(kind_str)
    .bind(position)
    .fetch_one(&state.db)
    .await?;

    broadcast_global_message(
        &state,
        ServerMessage::ChannelCreated {
            channel: channel.clone(),
        },
        None,
    )
    .await;

    Ok(Json(channel))
}

async fn get_channels(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Vec<Channel>>, AppError> {
    let _username = extract_username(&headers, &state.config.jwt.secret)?;

    let channels: Vec<Channel> = sqlx::query_as("SELECT * FROM channels ORDER BY position ASC")
        .fetch_all(&state.db)
        .await?;

    Ok(Json(channels))
}

async fn get_channel(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<Channel>, AppError> {
    let _username = extract_username(&headers, &state.config.jwt.secret)?;

    let channel: Channel = sqlx::query_as("SELECT * FROM channels WHERE id = $1")
        .bind(channel_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    Ok(Json(channel))
}

async fn delete_channel(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _username = extract_username(&headers, &state.config.jwt.secret)?;

    let mut tx = state.db.begin().await?;

    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(7_231_901_i64)
        .execute(&mut *tx)
        .await?;

    let target_kind: Option<(ChannelKind,)> =
        sqlx::query_as("SELECT kind FROM channels WHERE id = $1")
            .bind(channel_id)
            .fetch_optional(&mut *tx)
            .await?;

    let Some((kind,)) = target_kind else {
        return Err(AppError::NotFound("Channel not found".into()));
    };

    let (text_count,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM channels WHERE kind = 'text'::channel_kind")
            .fetch_one(&mut *tx)
            .await?;

    if kind == ChannelKind::Text && text_count <= 1 {
        return Err(AppError::BadRequest(
            "Cannot delete the last text channel".into(),
        ));
    }

    let result = sqlx::query("DELETE FROM channels WHERE id = $1")
        .bind(channel_id)
        .execute(&mut *tx)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Channel not found".into()));
    }

    tx.commit().await?;

    if kind == ChannelKind::Voice {
        cleanup_deleted_voice_channel(&state, channel_id).await;
    }

    remove_channel_subscribers(&state, channel_id).await;
    broadcast_global_message(
        &state,
        ServerMessage::ChannelDeleted { id: channel_id },
        None,
    )
    .await;

    Ok(Json(serde_json::json!({ "deleted": true })))
}

async fn cleanup_deleted_voice_channel(state: &AppState, channel_id: Uuid) {
    let removed_usernames: Vec<String> = {
        let mut voice_members_by_channel = state.voice_members_by_channel.write().await;
        voice_members_by_channel
            .remove(&channel_id)
            .map(|usernames| usernames.into_iter().collect())
            .unwrap_or_default()
    };

    let affected_connection_ids: Vec<Uuid> = {
        let mut voice_members_by_connection = state.voice_members_by_connection.write().await;
        let ids: Vec<Uuid> = voice_members_by_connection
            .iter()
            .filter_map(|(connection_id, voice_channel_id)| {
                if *voice_channel_id == channel_id {
                    Some(*connection_id)
                } else {
                    None
                }
            })
            .collect();

        for connection_id in &ids {
            voice_members_by_connection.remove(connection_id);
        }

        ids
    };

    for connection_id in affected_connection_ids {
        let _ = state.media.cleanup_connection_media(connection_id).await;
    }

    for username in removed_usernames {
        broadcast_global_message(
            state,
            ServerMessage::VoiceUserLeft {
                channel_id,
                username,
            },
            None,
        )
        .await;
    }
}

async fn get_messages(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(channel_id): Path<Uuid>,
    Query(query): Query<MessageQuery>,
) -> Result<Json<Vec<MessageWithAuthor>>, AppError> {
    let _username = extract_username(&headers, &state.config.jwt.secret)?;
    let limit = query.limit.unwrap_or(50).min(100);

    let messages: Vec<MessageWithAuthor> = if let Some(before) = query.before {
        sqlx::query_as(
            "SELECT m.id, m.channel_id, m.author_id, u.username AS author_username, m.content, m.created_at, m.edited_at
             FROM messages m
             JOIN users u ON u.id = m.author_id
             WHERE m.channel_id = $1 AND m.created_at < (SELECT created_at FROM messages WHERE id = $2)
             ORDER BY m.created_at DESC LIMIT $3",
        )
        .bind(channel_id)
        .bind(before)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as(
            "SELECT m.id, m.channel_id, m.author_id, u.username AS author_username, m.content, m.created_at, m.edited_at
             FROM messages m
             JOIN users u ON u.id = m.author_id
             WHERE m.channel_id = $1 ORDER BY m.created_at DESC LIMIT $2",
        )
        .bind(channel_id)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    };

    Ok(Json(messages))
}

async fn send_message(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<SendMessageRequest>,
) -> Result<Json<Message>, AppError> {
    let username = extract_username(&headers, &state.config.jwt.secret)?;
    let user_id = lookup_user_id(&state, &username).await?;
    let trimmed_content = body.content.trim();

    if trimmed_content.is_empty() || trimmed_content.len() > 4000 {
        return Err(AppError::BadRequest(
            "Message content must be between 1 and 4000 characters".into(),
        ));
    }

    let message: Message = sqlx::query_as(
        "INSERT INTO messages (id, channel_id, author_id, content) VALUES ($1, $2, $3, $4) RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(channel_id)
    .bind(user_id)
    .bind(trimmed_content)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(message))
}

async fn edit_message(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(message_id): Path<Uuid>,
    Json(body): Json<EditMessageRequest>,
) -> Result<Json<Message>, AppError> {
    let username = extract_username(&headers, &state.config.jwt.secret)?;
    let user_id = lookup_user_id(&state, &username).await?;

    let trimmed_content = body.content.trim();
    if trimmed_content.is_empty() || trimmed_content.len() > 4000 {
        return Err(AppError::BadRequest(
            "Message content must be between 1 and 4000 characters".into(),
        ));
    }

    let existing: Option<(Uuid, Uuid)> =
        sqlx::query_as("SELECT channel_id, author_id FROM messages WHERE id = $1")
            .bind(message_id)
            .fetch_optional(&state.db)
            .await?;

    let Some((channel_id, author_id)) = existing else {
        return Err(AppError::NotFound("Message not found".into()));
    };

    if author_id != user_id {
        return Err(AppError::Unauthorized(
            "You can only edit your own messages".into(),
        ));
    }

    let edited: Message = sqlx::query_as(
        "UPDATE messages SET content = $1, edited_at = now() WHERE id = $2 RETURNING *",
    )
    .bind(trimmed_content)
    .bind(message_id)
    .fetch_one(&state.db)
    .await?;

    let Some(edited_at) = edited.edited_at else {
        return Err(AppError::Internal("Missing edited timestamp".into()));
    };

    broadcast_channel_message(
        &state,
        channel_id,
        ServerMessage::MessageEdited {
            id: edited.id,
            channel_id,
            content: edited.content.clone(),
            edited_at: edited_at.to_rfc3339(),
        },
        None,
    )
    .await;

    Ok(Json(edited))
}

async fn delete_message(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(message_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let username = extract_username(&headers, &state.config.jwt.secret)?;
    let user_id = lookup_user_id(&state, &username).await?;

    let existing: Option<(Uuid, Uuid)> =
        sqlx::query_as("SELECT channel_id, author_id FROM messages WHERE id = $1")
            .bind(message_id)
            .fetch_optional(&state.db)
            .await?;

    let Some((channel_id, author_id)) = existing else {
        return Err(AppError::NotFound("Message not found".into()));
    };

    if author_id != user_id {
        return Err(AppError::Unauthorized(
            "You can only delete your own messages".into(),
        ));
    }

    sqlx::query("DELETE FROM messages WHERE id = $1")
        .bind(message_id)
        .execute(&state.db)
        .await?;

    broadcast_channel_message(
        &state,
        channel_id,
        ServerMessage::MessageDeleted {
            id: message_id,
            channel_id,
        },
        None,
    )
    .await;

    Ok(Json(serde_json::json!({ "deleted": true })))
}
