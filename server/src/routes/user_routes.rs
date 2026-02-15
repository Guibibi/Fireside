use axum::{
    extract::Multipart,
    extract::State,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::{create_token, validate_token};
use crate::errors::AppError;
use crate::AppState;

#[derive(Deserialize)]
pub struct UpdateCurrentUserRequest {
    pub username: String,
}

#[derive(Serialize)]
pub struct UpdateCurrentUserResponse {
    pub token: String,
    pub username: String,
    pub avatar_url: Option<String>,
}

#[derive(Serialize)]
pub struct UsersResponse {
    pub usernames: Vec<String>,
    pub users: Vec<UserSummary>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct UserSummary {
    pub username: String,
    pub avatar_url: Option<String>,
}

#[derive(Serialize)]
pub struct CurrentUserResponse {
    pub username: String,
    pub avatar_url: Option<String>,
}

#[derive(Serialize)]
pub struct UploadAvatarResponse {
    pub id: Uuid,
    pub status: String,
    pub avatar_url: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users", get(get_users))
        .route(
            "/users/me",
            get(get_current_user).patch(update_current_user),
        )
        .route("/users/me/avatar", post(upload_current_user_avatar))
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

async fn update_current_user(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<UpdateCurrentUserRequest>,
) -> Result<Json<UpdateCurrentUserResponse>, AppError> {
    let current_username = extract_username(&headers, &state.config.jwt.secret)?;
    let next_username = body.username.trim();
    let current_avatar_url: Option<String> =
        sqlx::query_scalar("SELECT avatar_url FROM users WHERE username = $1")
            .bind(&current_username)
            .fetch_optional(&state.db)
            .await?
            .flatten();

    if next_username.len() < 3 || next_username.len() > 32 {
        return Err(AppError::BadRequest(
            "Username must be between 3 and 32 characters".into(),
        ));
    }

    if next_username != current_username {
        let existing: Option<(String,)> =
            sqlx::query_as("SELECT username FROM users WHERE username = $1")
                .bind(next_username)
                .fetch_optional(&state.db)
                .await?;

        if existing.is_some() {
            return Err(AppError::Conflict("Username is already taken".into()));
        }

        let updated = sqlx::query("UPDATE users SET username = $1 WHERE username = $2")
            .bind(next_username)
            .bind(&current_username)
            .execute(&state.db)
            .await?;

        if updated.rows_affected() == 0 {
            return Err(AppError::Unauthorized("User not found".into()));
        }
    }

    let token = create_token(
        next_username,
        &state.config.jwt.secret,
        state.config.jwt.expiration_hours,
    )?;

    Ok(Json(UpdateCurrentUserResponse {
        token,
        username: next_username.to_string(),
        avatar_url: current_avatar_url,
    }))
}

async fn get_current_user(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<CurrentUserResponse>, AppError> {
    let current_username = extract_username(&headers, &state.config.jwt.secret)?;

    let row: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT username, avatar_url FROM users WHERE username = $1")
            .bind(&current_username)
            .fetch_optional(&state.db)
            .await?;

    let (username, avatar_url) =
        row.ok_or_else(|| AppError::Unauthorized("User not found".into()))?;

    Ok(Json(CurrentUserResponse {
        username,
        avatar_url,
    }))
}

async fn get_users(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<UsersResponse>, AppError> {
    let _username = extract_username(&headers, &state.config.jwt.secret)?;

    let users: Vec<UserSummary> =
        sqlx::query_as("SELECT username, avatar_url FROM users ORDER BY username ASC")
            .fetch_all(&state.db)
            .await?;
    let usernames = users.iter().map(|entry| entry.username.clone()).collect();

    Ok(Json(UsersResponse { usernames, users }))
}

async fn upload_current_user_avatar(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<UploadAvatarResponse>, AppError> {
    let current_username = extract_username(&headers, &state.config.jwt.secret)?;
    let user_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE username = $1")
        .bind(&current_username)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::Unauthorized("User not found".into()))?;

    let mut uploaded = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| AppError::BadRequest(format!("Invalid multipart payload: {error}")))?
    {
        if field.name() != Some("file") {
            continue;
        }

        let mime_type = field
            .content_type()
            .ok_or_else(|| AppError::BadRequest("Missing content-type for upload".into()))?
            .to_string();
        let bytes = field.bytes().await.map_err(|error| {
            AppError::BadRequest(format!("Failed to read upload field: {error}"))
        })?;

        uploaded = Some(
            state
                .uploads
                .upload_avatar(user_id, mime_type, bytes.to_vec())
                .await?,
        );
        break;
    }

    let uploaded = uploaded
        .ok_or_else(|| AppError::BadRequest("Multipart form must include 'file'".into()))?;

    Ok(Json(UploadAvatarResponse {
        id: uploaded.id,
        status: uploaded.status,
        avatar_url: format!("/api/media/{}/avatar_64", uploaded.id),
    }))
}
