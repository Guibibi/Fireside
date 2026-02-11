use axum::{extract::State, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::{create_token, hash_password, verify_password};
use crate::errors::AppError;
use crate::AppState;

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
    pub display_name: Option<String>,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user_id: Uuid,
    pub username: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
}

async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    if body.username.len() < 3 || body.username.len() > 32 {
        return Err(AppError::BadRequest(
            "Username must be between 3 and 32 characters".into(),
        ));
    }
    if body.password.len() < 8 {
        return Err(AppError::BadRequest(
            "Password must be at least 8 characters".into(),
        ));
    }

    let existing: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM users WHERE username = $1")
            .bind(&body.username)
            .fetch_optional(&state.db)
            .await?;

    if existing.is_some() {
        return Err(AppError::Conflict("Username already taken".into()));
    }

    let password_hash =
        hash_password(&body.password).map_err(|e| AppError::Internal(e.to_string()))?;
    let user_id = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO users (id, username, password_hash, display_name) VALUES ($1, $2, $3, $4)",
    )
    .bind(user_id)
    .bind(&body.username)
    .bind(&password_hash)
    .bind(&body.display_name)
    .execute(&state.db)
    .await?;

    let token = create_token(
        user_id,
        &body.username,
        &state.config.jwt.secret,
        state.config.jwt.expiration_hours,
    )?;

    Ok(Json(AuthResponse {
        token,
        user_id,
        username: body.username,
    }))
}

async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let row: Option<(Uuid, String, String)> =
        sqlx::query_as("SELECT id, username, password_hash FROM users WHERE username = $1")
            .bind(&body.username)
            .fetch_optional(&state.db)
            .await?;

    let (user_id, username, password_hash) =
        row.ok_or_else(|| AppError::Unauthorized("Invalid credentials".into()))?;

    let valid =
        verify_password(&body.password, &password_hash).map_err(|e| AppError::Internal(e.to_string()))?;

    if !valid {
        return Err(AppError::Unauthorized("Invalid credentials".into()));
    }

    let token = create_token(
        user_id,
        &username,
        &state.config.jwt.secret,
        state.config.jwt.expiration_hours,
    )?;

    Ok(Json(AuthResponse {
        token,
        user_id,
        username,
    }))
}
