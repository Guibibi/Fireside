use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::validate_token;
use crate::errors::AppError;
use crate::models::{Channel, ChannelKind, Message};
use crate::AppState;

#[derive(Deserialize)]
pub struct CreateChannelRequest {
    pub name: String,
    pub kind: ChannelKind,
}

#[derive(Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
}

#[derive(Deserialize)]
pub struct MessageQuery {
    pub before: Option<Uuid>,
    pub limit: Option<i64>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/channels/{channel_id}",
            get(get_channel).delete(delete_channel),
        )
        .route(
            "/channels/{channel_id}/messages",
            get(get_messages).post(send_message),
        )
        .route("/servers/{server_id}/channels", post(create_channel))
}

fn extract_user_id(headers: &axum::http::HeaderMap, secret: &str) -> Result<String, AppError> {
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
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateChannelRequest>,
) -> Result<Json<Channel>, AppError> {
    let _user_id = extract_user_id(&headers, &state.config.jwt.secret)?;

    let (max_pos,): (i32,) =
        sqlx::query_as("SELECT COALESCE(MAX(position), -1) FROM channels WHERE server_id = $1")
            .bind(server_id)
            .fetch_one(&state.db)
            .await?;
    let position = max_pos + 1;

    let kind_str = match body.kind {
        ChannelKind::Text => "text",
        ChannelKind::Voice => "voice",
    };

    let channel: Channel = sqlx::query_as(
        "INSERT INTO channels (id, server_id, name, kind, position) VALUES ($1, $2, $3, $4::channel_kind, $5) RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(server_id)
    .bind(&body.name)
    .bind(kind_str)
    .bind(position)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(channel))
}

async fn get_channel(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<Channel>, AppError> {
    let _user_id = extract_user_id(&headers, &state.config.jwt.secret)?;

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
    let _user_id = extract_user_id(&headers, &state.config.jwt.secret)?;

    sqlx::query("DELETE FROM channels WHERE id = $1")
        .bind(channel_id)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "deleted": true })))
}

async fn get_messages(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(channel_id): Path<Uuid>,
    Query(query): Query<MessageQuery>,
) -> Result<Json<Vec<Message>>, AppError> {
    let _user_id = extract_user_id(&headers, &state.config.jwt.secret)?;
    let limit = query.limit.unwrap_or(50).min(100);

    let messages: Vec<Message> = if let Some(before) = query.before {
        sqlx::query_as(
            "SELECT * FROM messages WHERE channel_id = $1 AND created_at < (SELECT created_at FROM messages WHERE id = $2)
             ORDER BY created_at DESC LIMIT $3",
        )
        .bind(channel_id)
        .bind(before)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as(
            "SELECT * FROM messages WHERE channel_id = $1 ORDER BY created_at DESC LIMIT $2",
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
    let username = extract_user_id(&headers, &state.config.jwt.secret)?;
    let user_id = lookup_user_id(&state, &username).await?;

    if body.content.is_empty() || body.content.len() > 4000 {
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
    .bind(&body.content)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(message))
}
