use axum::{
    extract::State,
    routing::{get, patch},
    Json, Router,
};
use serde::{Deserialize, Serialize};

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
}

#[derive(Serialize)]
pub struct UsersResponse {
    pub usernames: Vec<String>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users", get(get_users))
        .route("/users/me", patch(update_current_user))
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
    }))
}

async fn get_users(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<UsersResponse>, AppError> {
    let _username = extract_username(&headers, &state.config.jwt.secret)?;

    let usernames: Vec<String> =
        sqlx::query_scalar("SELECT username FROM users ORDER BY username ASC")
            .fetch_all(&state.db)
            .await?;

    Ok(Json(UsersResponse { usernames }))
}
