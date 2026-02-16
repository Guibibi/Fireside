use axum::{
    extract::Path,
    extract::State,
    routing::{delete, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::extract_claims;
use crate::errors::AppError;
use crate::models::Reaction;
use crate::ws::messages::ServerMessage;
use crate::AppState;

type ReactionSummaryRow = (Option<Uuid>, Option<String>, Option<String>, i64);

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

#[derive(Serialize)]
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
}

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

        let existing: Option<(Uuid,)> = sqlx::query_as(
            "SELECT id FROM reactions 
             WHERE message_id = $1 AND user_id = $2 AND emoji_id = $3",
        )
        .bind(message_id)
        .bind(user_id)
        .bind(emoji_id)
        .fetch_optional(&state.db)
        .await?;

        if existing.is_some() {
            return Err(AppError::Conflict("Reaction already exists".into()));
        }
    } else if let Some(ref unicode_emoji) = body.unicode_emoji {
        if unicode_emoji.is_empty() || unicode_emoji.len() > 16 {
            return Err(AppError::BadRequest(
                "Unicode emoji must be between 1 and 16 characters".into(),
            ));
        }

        let existing: Option<(Uuid,)> = sqlx::query_as(
            "SELECT id FROM reactions 
             WHERE message_id = $1 AND user_id = $2 AND unicode_emoji = $3",
        )
        .bind(message_id)
        .bind(user_id)
        .bind(unicode_emoji)
        .fetch_optional(&state.db)
        .await?;

        if existing.is_some() {
            return Err(AppError::Conflict("Reaction already exists".into()));
        }
    }

    let reaction_id = Uuid::new_v4();

    let inserted_reaction: Reaction = sqlx::query_as(
        "INSERT INTO reactions (id, message_id, user_id, emoji_id, unicode_emoji, created_at)
         VALUES ($1, $2, $3, $4, $5, now())
         RETURNING id, message_id, user_id, emoji_id, unicode_emoji, created_at",
    )
    .bind(reaction_id)
    .bind(message_id)
    .bind(user_id)
    .bind(body.emoji_id)
    .bind(body.unicode_emoji.as_ref())
    .fetch_one(&state.db)
    .await?;

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

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM reactions 
         WHERE message_id = $1 
         AND (emoji_id = $2 OR ($2 IS NULL AND emoji_id IS NULL))
         AND (unicode_emoji = $3 OR ($3 IS NULL AND unicode_emoji IS NULL))",
    )
    .bind(message_id)
    .bind(body.emoji_id)
    .bind(body.unicode_emoji.as_ref())
    .fetch_one(&state.db)
    .await
    .unwrap_or(1);

    broadcast_server_message(
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

    broadcast_server_message(
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
    )
    .await;

    Ok(Json(serde_json::json!({"deleted": true})))
}

async fn remove_unicode_reaction(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((message_id, unicode_emoji)): Path<(Uuid, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
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

    broadcast_server_message(
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
    )
    .await;

    Ok(Json(serde_json::json!({"deleted": true})))
}

async fn broadcast_server_message(state: &AppState, channel_id: Uuid, message: ServerMessage) {
    if let Ok(json) = serde_json::to_string(&message) {
        broadcast_to_channel_subscribers(state, channel_id, json).await;
    }
}

async fn broadcast_to_channel_subscribers(state: &AppState, channel_id: Uuid, message: String) {
    let subs = state.channel_subscriptions.read().await;

    for (conn_id, sub_channel_id) in subs.iter() {
        if *sub_channel_id == channel_id {
            if let Some(tx) = state.ws_connections.read().await.get(conn_id) {
                let _ = tx.send(message.clone());
            }
        }
    }

    drop(subs);
}

pub async fn get_message_reactions(
    state: &AppState,
    message_id: Uuid,
    current_user_id: Option<Uuid>,
) -> Result<Vec<ReactionSummaryResponse>, AppError> {
    let rows: Vec<ReactionSummaryRow> = sqlx::query_as(
        "SELECT 
            r.emoji_id,
            r.unicode_emoji,
            e.shortcode,
            COUNT(*) as count
         FROM reactions r
         LEFT JOIN emojis e ON r.emoji_id = e.id
         WHERE r.message_id = $1
         GROUP BY r.emoji_id, r.unicode_emoji, e.shortcode
         ORDER BY count DESC, MIN(r.created_at) ASC",
    )
    .bind(message_id)
    .fetch_all(&state.db)
    .await?;

    let mut responses = Vec::new();
    for (emoji_id, unicode_emoji, shortcode, count) in rows {
        let user_reacted = if let Some(user_id) = current_user_id {
            let reacted: bool = sqlx::query_scalar(
                "SELECT EXISTS(
                    SELECT 1 FROM reactions 
                    WHERE message_id = $1 
                    AND user_id = $2
                    AND (emoji_id = $3 OR ($3 IS NULL AND emoji_id IS NULL))
                    AND (unicode_emoji = $4 OR ($4 IS NULL AND unicode_emoji IS NULL))
                )",
            )
            .bind(message_id)
            .bind(user_id)
            .bind(emoji_id)
            .bind(&unicode_emoji)
            .fetch_one(&state.db)
            .await?;
            reacted
        } else {
            false
        };

        responses.push(ReactionSummaryResponse {
            emoji_id,
            unicode_emoji,
            shortcode,
            count,
            user_reacted,
        });
    }

    Ok(responses)
}
