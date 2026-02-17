use std::collections::HashMap;

use axum::{
    extract::Path,
    extract::State,
    routing::{delete, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::time::Instant;
use uuid::Uuid;

use crate::auth::extract_claims;
use crate::errors::AppError;
use crate::models::Reaction;
use crate::ws::broadcast::broadcast_channel_message;
use crate::ws::messages::ServerMessage;
use crate::AppState;

#[derive(Deserialize)]
pub struct AddReactionRequest {
    pub emoji_id: Option<Uuid>,
    pub unicode_emoji: Option<String>,
}

#[derive(Serialize)]
pub struct ReactionResponse {
    pub id: Uuid,
    pub message_id: Uuid,
    pub user_id: Uuid,
    pub emoji_id: Option<Uuid>,
    pub unicode_emoji: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ReactionSummaryResponse {
    pub emoji_id: Option<Uuid>,
    pub unicode_emoji: Option<String>,
    pub shortcode: Option<String>,
    pub count: i64,
    pub user_reacted: bool,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/messages/{message_id}/reactions", post(add_reaction))
        .route(
            "/messages/{message_id}/reactions/{emoji_id}",
            delete(remove_custom_reaction),
        )
        .route(
            "/messages/{message_id}/reactions/unicode/{unicode_emoji}",
            delete(remove_unicode_reaction),
        )
        .route("/dm-messages/{message_id}/reactions", post(add_dm_reaction))
        .route(
            "/dm-messages/{message_id}/reactions/{emoji_id}",
            delete(remove_dm_custom_reaction),
        )
        .route(
            "/dm-messages/{message_id}/reactions/unicode/{unicode_emoji}",
            delete(remove_dm_unicode_reaction),
        )
}

#[tracing::instrument(skip(state, headers, body), fields(message_id = %message_id))]
async fn add_reaction(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(message_id): Path<Uuid>,
    Json(body): Json<AddReactionRequest>,
) -> Result<Json<ReactionResponse>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;

    let user_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE username = $1")
        .bind(&claims.username)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::Unauthorized("User not found".into()))?;

    let message_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM messages WHERE id = $1)")
            .bind(message_id)
            .fetch_one(&state.db)
            .await?;

    if !message_exists {
        return Err(AppError::NotFound("Message not found".into()));
    }

    if body.emoji_id.is_none() && body.unicode_emoji.is_none() {
        return Err(AppError::BadRequest(
            "Either emoji_id or unicode_emoji must be provided".into(),
        ));
    }

    if body.emoji_id.is_some() && body.unicode_emoji.is_some() {
        return Err(AppError::BadRequest(
            "Only one of emoji_id or unicode_emoji can be provided".into(),
        ));
    }

    if let Some(emoji_id) = body.emoji_id {
        let emoji_exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM emojis WHERE id = $1)")
                .bind(emoji_id)
                .fetch_one(&state.db)
                .await?;

        if !emoji_exists {
            return Err(AppError::NotFound("Emoji not found".into()));
        }
    } else if let Some(ref unicode_emoji) = body.unicode_emoji {
        if unicode_emoji.is_empty() || unicode_emoji.len() > 16 {
            return Err(AppError::BadRequest(
                "Unicode emoji must be between 1 and 16 characters".into(),
            ));
        }
    }

    let reaction_id = Uuid::new_v4();

    let inserted_reaction: Option<Reaction> = sqlx::query_as(
        "INSERT INTO reactions (id, message_id, user_id, emoji_id, unicode_emoji, created_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT DO NOTHING
         RETURNING id, message_id, user_id, emoji_id, unicode_emoji, created_at",
    )
    .bind(reaction_id)
    .bind(message_id)
    .bind(user_id)
    .bind(body.emoji_id)
    .bind(body.unicode_emoji.as_ref())
    .fetch_optional(&state.db)
    .await?;

    let inserted_reaction =
        inserted_reaction.ok_or_else(|| AppError::Conflict("Reaction already exists".into()))?;

    let channel_id: Uuid = sqlx::query_scalar("SELECT channel_id FROM messages WHERE id = $1")
        .bind(message_id)
        .fetch_one(&state.db)
        .await?;

    let shortcode: Option<String> = if let Some(emoji_id) = body.emoji_id {
        sqlx::query_scalar("SELECT shortcode FROM emojis WHERE id = $1")
            .bind(emoji_id)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None)
    } else {
        None
    };

    let count_query_started = Instant::now();
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM reactions 
         WHERE message_id = $1 
         AND emoji_id IS NOT DISTINCT FROM $2
         AND unicode_emoji IS NOT DISTINCT FROM $3",
    )
    .bind(message_id)
    .bind(body.emoji_id)
    .bind(body.unicode_emoji.as_ref())
    .fetch_one(&state.db)
    .await
    .unwrap_or(1);
    state.telemetry.observe_db_query(
        "reactions.add_reaction.count",
        count_query_started.elapsed(),
    );

    broadcast_channel_message(
        &state,
        channel_id,
        ServerMessage::ReactionAdded {
            channel_id,
            message_id,
            emoji_id: body.emoji_id,
            unicode_emoji: body.unicode_emoji.clone(),
            shortcode,
            user_id,
            count,
        },
        None,
    )
    .await;

    Ok(Json(ReactionResponse {
        id: inserted_reaction.id,
        message_id: inserted_reaction.message_id,
        user_id: inserted_reaction.user_id,
        emoji_id: inserted_reaction.emoji_id,
        unicode_emoji: inserted_reaction.unicode_emoji,
    }))
}

#[tracing::instrument(skip(state, headers, body), fields(message_id = %message_id))]
async fn add_dm_reaction(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(message_id): Path<Uuid>,
    Json(body): Json<AddReactionRequest>,
) -> Result<Json<ReactionResponse>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;

    let user_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE username = $1")
        .bind(&claims.username)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::Unauthorized("User not found".into()))?;

    let dm_message_thread: Option<Uuid> = sqlx::query_scalar(
        "SELECT t.id
         FROM dm_messages m
         JOIN dm_threads t ON t.id = m.thread_id
         WHERE m.id = $1
           AND (t.user_a_id = $2 OR t.user_b_id = $2)",
    )
    .bind(message_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?;

    if dm_message_thread.is_none() {
        return Err(AppError::NotFound("Message not found".into()));
    }

    if body.emoji_id.is_none() && body.unicode_emoji.is_none() {
        return Err(AppError::BadRequest(
            "Either emoji_id or unicode_emoji must be provided".into(),
        ));
    }

    if body.emoji_id.is_some() && body.unicode_emoji.is_some() {
        return Err(AppError::BadRequest(
            "Only one of emoji_id or unicode_emoji can be provided".into(),
        ));
    }

    if let Some(emoji_id) = body.emoji_id {
        let emoji_exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM emojis WHERE id = $1)")
                .bind(emoji_id)
                .fetch_one(&state.db)
                .await?;

        if !emoji_exists {
            return Err(AppError::NotFound("Emoji not found".into()));
        }
    } else if let Some(ref unicode_emoji) = body.unicode_emoji {
        if unicode_emoji.is_empty() || unicode_emoji.len() > 16 {
            return Err(AppError::BadRequest(
                "Unicode emoji must be between 1 and 16 characters".into(),
            ));
        }
    }

    let reaction_id = Uuid::new_v4();

    let inserted_reaction: Option<Reaction> = sqlx::query_as(
        "INSERT INTO dm_reactions (id, dm_message_id, user_id, emoji_id, unicode_emoji, created_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT DO NOTHING
         RETURNING id, dm_message_id AS message_id, user_id, emoji_id, unicode_emoji, created_at",
    )
    .bind(reaction_id)
    .bind(message_id)
    .bind(user_id)
    .bind(body.emoji_id)
    .bind(body.unicode_emoji.as_ref())
    .fetch_optional(&state.db)
    .await?;

    let inserted_reaction =
        inserted_reaction.ok_or_else(|| AppError::Conflict("Reaction already exists".into()))?;

    Ok(Json(ReactionResponse {
        id: inserted_reaction.id,
        message_id: inserted_reaction.message_id,
        user_id: inserted_reaction.user_id,
        emoji_id: inserted_reaction.emoji_id,
        unicode_emoji: inserted_reaction.unicode_emoji,
    }))
}

async fn remove_custom_reaction(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((message_id, emoji_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;

    let user_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE username = $1")
        .bind(&claims.username)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::Unauthorized("User not found".into()))?;

    let result = sqlx::query(
        "DELETE FROM reactions 
         WHERE message_id = $1 AND user_id = $2 AND emoji_id = $3
         RETURNING id",
    )
    .bind(message_id)
    .bind(user_id)
    .bind(emoji_id)
    .fetch_optional(&state.db)
    .await?;

    if result.is_none() {
        return Err(AppError::NotFound("Reaction not found".into()));
    }

    let channel_id: Uuid = sqlx::query_scalar("SELECT channel_id FROM messages WHERE id = $1")
        .bind(message_id)
        .fetch_one(&state.db)
        .await?;

    let remaining: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM reactions 
         WHERE message_id = $1 AND emoji_id = $2",
    )
    .bind(message_id)
    .bind(emoji_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    broadcast_channel_message(
        &state,
        channel_id,
        ServerMessage::ReactionRemoved {
            channel_id,
            message_id,
            emoji_id: Some(emoji_id),
            unicode_emoji: None,
            user_id,
            count: remaining,
        },
        None,
    )
    .await;

    Ok(Json(serde_json::json!({"deleted": true})))
}

async fn remove_unicode_reaction(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((message_id, unicode_emoji)): Path<(Uuid, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    if unicode_emoji.is_empty() || unicode_emoji.len() > 16 {
        return Err(AppError::BadRequest(
            "Unicode emoji must be between 1 and 16 characters".into(),
        ));
    }

    let claims = extract_claims(&headers, &state.config.jwt.secret)?;

    let user_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE username = $1")
        .bind(&claims.username)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::Unauthorized("User not found".into()))?;

    let result = sqlx::query(
        "DELETE FROM reactions 
         WHERE message_id = $1 AND user_id = $2 AND unicode_emoji = $3
         RETURNING id",
    )
    .bind(message_id)
    .bind(user_id)
    .bind(&unicode_emoji)
    .fetch_optional(&state.db)
    .await?;

    if result.is_none() {
        return Err(AppError::NotFound("Reaction not found".into()));
    }

    let channel_id: Uuid = sqlx::query_scalar("SELECT channel_id FROM messages WHERE id = $1")
        .bind(message_id)
        .fetch_one(&state.db)
        .await?;

    let remaining: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM reactions 
         WHERE message_id = $1 AND unicode_emoji = $2",
    )
    .bind(message_id)
    .bind(&unicode_emoji)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    broadcast_channel_message(
        &state,
        channel_id,
        ServerMessage::ReactionRemoved {
            channel_id,
            message_id,
            emoji_id: None,
            unicode_emoji: Some(unicode_emoji),
            user_id,
            count: remaining,
        },
        None,
    )
    .await;

    Ok(Json(serde_json::json!({"deleted": true})))
}

async fn remove_dm_custom_reaction(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((message_id, emoji_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;

    let user_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE username = $1")
        .bind(&claims.username)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::Unauthorized("User not found".into()))?;

    let dm_message_thread: Option<Uuid> = sqlx::query_scalar(
        "SELECT t.id
         FROM dm_messages m
         JOIN dm_threads t ON t.id = m.thread_id
         WHERE m.id = $1
           AND (t.user_a_id = $2 OR t.user_b_id = $2)",
    )
    .bind(message_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?;

    if dm_message_thread.is_none() {
        return Err(AppError::NotFound("Message not found".into()));
    }

    let result = sqlx::query(
        "DELETE FROM dm_reactions
         WHERE dm_message_id = $1 AND user_id = $2 AND emoji_id = $3
         RETURNING id",
    )
    .bind(message_id)
    .bind(user_id)
    .bind(emoji_id)
    .fetch_optional(&state.db)
    .await?;

    if result.is_none() {
        return Err(AppError::NotFound("Reaction not found".into()));
    }

    Ok(Json(serde_json::json!({"deleted": true})))
}

async fn remove_dm_unicode_reaction(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((message_id, unicode_emoji)): Path<(Uuid, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    if unicode_emoji.is_empty() || unicode_emoji.len() > 16 {
        return Err(AppError::BadRequest(
            "Unicode emoji must be between 1 and 16 characters".into(),
        ));
    }

    let claims = extract_claims(&headers, &state.config.jwt.secret)?;

    let user_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE username = $1")
        .bind(&claims.username)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::Unauthorized("User not found".into()))?;

    let dm_message_thread: Option<Uuid> = sqlx::query_scalar(
        "SELECT t.id
         FROM dm_messages m
         JOIN dm_threads t ON t.id = m.thread_id
         WHERE m.id = $1
           AND (t.user_a_id = $2 OR t.user_b_id = $2)",
    )
    .bind(message_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?;

    if dm_message_thread.is_none() {
        return Err(AppError::NotFound("Message not found".into()));
    }

    let result = sqlx::query(
        "DELETE FROM dm_reactions
         WHERE dm_message_id = $1 AND user_id = $2 AND unicode_emoji = $3
         RETURNING id",
    )
    .bind(message_id)
    .bind(user_id)
    .bind(&unicode_emoji)
    .fetch_optional(&state.db)
    .await?;

    if result.is_none() {
        return Err(AppError::NotFound("Reaction not found".into()));
    }

    Ok(Json(serde_json::json!({"deleted": true})))
}

type BatchedReactionRow = (
    Uuid,
    Option<Uuid>,
    Option<String>,
    Option<String>,
    i64,
    bool,
);

pub async fn get_reactions_for_messages(
    state: &AppState,
    message_ids: &[Uuid],
    current_user_id: Option<Uuid>,
) -> Result<HashMap<Uuid, Vec<ReactionSummaryResponse>>, AppError> {
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let query_started = Instant::now();
    let rows: Vec<BatchedReactionRow> = sqlx::query_as(
        "SELECT
            r.message_id,
            r.emoji_id,
            r.unicode_emoji,
            e.shortcode,
            COUNT(*) AS count,
            BOOL_OR(r.user_id = $2) AS user_reacted
         FROM reactions r
         LEFT JOIN emojis e ON r.emoji_id = e.id
         WHERE r.message_id = ANY($1)
         GROUP BY r.message_id, r.emoji_id, r.unicode_emoji, e.shortcode
         ORDER BY count DESC, MIN(r.created_at) ASC",
    )
    .bind(message_ids)
    .bind(current_user_id)
    .fetch_all(&state.db)
    .await?;
    state.telemetry.observe_db_query(
        "reactions.get_reactions_for_messages",
        query_started.elapsed(),
    );

    let mut map: HashMap<Uuid, Vec<ReactionSummaryResponse>> = HashMap::new();
    for (message_id, emoji_id, unicode_emoji, shortcode, count, user_reacted) in rows {
        map.entry(message_id)
            .or_default()
            .push(ReactionSummaryResponse {
                emoji_id,
                unicode_emoji,
                shortcode,
                count,
                user_reacted,
            });
    }

    Ok(map)
}

pub async fn get_reactions_for_dm_messages(
    state: &AppState,
    message_ids: &[Uuid],
    current_user_id: Option<Uuid>,
) -> Result<HashMap<Uuid, Vec<ReactionSummaryResponse>>, AppError> {
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let query_started = Instant::now();
    let rows: Vec<BatchedReactionRow> = sqlx::query_as(
        "SELECT
            r.dm_message_id,
            r.emoji_id,
            r.unicode_emoji,
            e.shortcode,
            COUNT(*) AS count,
            BOOL_OR(r.user_id = $2) AS user_reacted
         FROM dm_reactions r
         LEFT JOIN emojis e ON r.emoji_id = e.id
         WHERE r.dm_message_id = ANY($1)
         GROUP BY r.dm_message_id, r.emoji_id, r.unicode_emoji, e.shortcode
         ORDER BY count DESC, MIN(r.created_at) ASC",
    )
    .bind(message_ids)
    .bind(current_user_id)
    .fetch_all(&state.db)
    .await?;
    state.telemetry.observe_db_query(
        "reactions.get_reactions_for_dm_messages",
        query_started.elapsed(),
    );

    let mut map: HashMap<Uuid, Vec<ReactionSummaryResponse>> = HashMap::new();
    for (message_id, emoji_id, unicode_emoji, shortcode, count, user_reacted) in rows {
        map.entry(message_id)
            .or_default()
            .push(ReactionSummaryResponse {
                emoji_id,
                unicode_emoji,
                shortcode,
                count,
                user_reacted,
            });
    }

    Ok(map)
}
