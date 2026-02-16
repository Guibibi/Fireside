use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::extract_claims;
use crate::errors::AppError;
use crate::message_attachments::{
    load_message_attachments_by_message, persist_message_attachments_in_tx,
    resolve_uploads_for_message, MessageAttachmentPayload,
};
use crate::models::{Channel, ChannelKind, Message};
use crate::routes::reaction_routes::{get_message_reactions, ReactionSummaryResponse};
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
    pub opus_bitrate: Option<i32>,
    pub opus_dtx: Option<bool>,
    pub opus_fec: Option<bool>,
}

#[derive(Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
    #[serde(default)]
    pub attachment_media_ids: Vec<Uuid>,
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

#[derive(sqlx::FromRow)]
pub struct MessageWithAuthorRow {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub author_id: Uuid,
    pub author_username: String,
    pub content: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub edited_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Serialize)]
pub struct MessageWithAuthor {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub author_id: Uuid,
    pub author_username: String,
    pub content: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub edited_at: Option<chrono::DateTime<chrono::Utc>>,
    pub attachments: Vec<MessageAttachmentPayload>,
    pub reactions: Vec<ReactionSummaryResponse>,
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
    let _claims = extract_claims(&headers, &state.config.jwt.secret)?;

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

    // Validate opus_bitrate range (Opus supports 6000-510000 bps)
    if let Some(bitrate) = body.opus_bitrate {
        if !(6000..=510000).contains(&bitrate) {
            return Err(AppError::BadRequest(
                "opus_bitrate must be between 6000 and 510000".into(),
            ));
        }
    }

    let (max_pos,): (i32,) = sqlx::query_as("SELECT COALESCE(MAX(position), -1) FROM channels")
        .fetch_one(&state.db)
        .await?;
    let position = max_pos + 1;

    let kind_str = match body.kind {
        ChannelKind::Text => "text",
        ChannelKind::Voice => "voice",
    };

    let channel: Channel = sqlx::query_as(
        "INSERT INTO channels (id, name, description, kind, position, opus_bitrate, opus_dtx, opus_fec) VALUES ($1, $2, $3, $4::channel_kind, $5, $6, $7, $8) RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(trimmed_name)
    .bind(description)
    .bind(kind_str)
    .bind(position)
    .bind(body.opus_bitrate)
    .bind(body.opus_dtx)
    .bind(body.opus_fec)
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
    let _claims = extract_claims(&headers, &state.config.jwt.secret)?;

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
    let _claims = extract_claims(&headers, &state.config.jwt.secret)?;

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
    let _claims = extract_claims(&headers, &state.config.jwt.secret)?;

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

    // Invalidate the cached router so it can be garbage collected
    state.media.invalidate_router(channel_id).await;

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
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;
    let current_user_id = lookup_user_id(&state, &claims.username).await?;
    let limit = query.limit.unwrap_or(50).min(100);

    let messages: Vec<MessageWithAuthorRow> = if let Some(before) = query.before {
        sqlx::query_as(
            "SELECT m.id, m.channel_id, m.author_id, u.username AS author_username, m.content, m.created_at, m.edited_at
             FROM messages m
             JOIN users u ON u.id = m.author_id
             WHERE m.channel_id = $1
               AND (m.created_at, m.id) < (SELECT created_at, id FROM messages WHERE id = $2)
             ORDER BY m.created_at DESC, m.id DESC LIMIT $3",
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
             WHERE m.channel_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT $2",
        )
        .bind(channel_id)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    };

    let message_ids: Vec<Uuid> = messages.iter().map(|message| message.id).collect();
    let attachments_by_message =
        load_message_attachments_by_message(&state.db, &message_ids).await?;

    let mut with_attachments = Vec::with_capacity(messages.len());
    for message in messages {
        let reactions = get_message_reactions(&state, message.id, Some(current_user_id)).await?;

        with_attachments.push(MessageWithAuthor {
            id: message.id,
            channel_id: message.channel_id,
            author_id: message.author_id,
            author_username: message.author_username,
            content: message.content,
            created_at: message.created_at,
            edited_at: message.edited_at,
            attachments: attachments_by_message
                .get(&message.id)
                .cloned()
                .unwrap_or_default(),
            reactions,
        });
    }

    Ok(Json(with_attachments))
}

async fn send_message(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<SendMessageRequest>,
) -> Result<Json<Message>, AppError> {
    let username = extract_claims(&headers, &state.config.jwt.secret)?.username;
    let user_id = lookup_user_id(&state, &username).await?;
    let trimmed_content = body.content.trim();
    let resolved_attachments =
        resolve_uploads_for_message(&state, user_id, &body.attachment_media_ids).await?;

    if trimmed_content.len() > 4000 {
        return Err(AppError::BadRequest(
            "Message content must be 4000 characters or fewer".into(),
        ));
    }

    if trimmed_content.is_empty() && resolved_attachments.is_empty() {
        return Err(AppError::BadRequest(
            "Message content cannot be empty without attachments".into(),
        ));
    }

    let mut tx = state.db.begin().await?;

    let message: Message = sqlx::query_as(
        "INSERT INTO messages (id, channel_id, author_id, content) VALUES ($1, $2, $3, $4) RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(channel_id)
    .bind(user_id)
    .bind(trimmed_content)
    .fetch_one(&mut *tx)
    .await?;

    persist_message_attachments_in_tx(&mut tx, message.id, &resolved_attachments).await?;
    tx.commit().await?;

    Ok(Json(message))
}

async fn edit_message(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(message_id): Path<Uuid>,
    Json(body): Json<EditMessageRequest>,
) -> Result<Json<Message>, AppError> {
    let username = extract_claims(&headers, &state.config.jwt.secret)?.username;
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
    let username = extract_claims(&headers, &state.config.jwt.secret)?.username;
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
