use axum::{extract::State, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::create_token;
use crate::errors::AppError;
use crate::AppState;

#[derive(Deserialize)]
pub struct ConnectRequest {
    pub password: String,
    pub username: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub username: String,
}

pub fn router() -> Router<AppState> {
    Router::new().route("/connect", post(connect))
}

async fn connect(
    State(state): State<AppState>,
    Json(body): Json<ConnectRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    if body.username.len() < 3 || body.username.len() > 32 {
        return Err(AppError::BadRequest(
            "Username must be between 3 and 32 characters".into(),
        ));
    }

    if body.password != state.config.server.password {
        return Err(AppError::Unauthorized("Invalid server password".into()));
    }

    {
        let active_usernames = state.active_usernames.read().await;
        if active_usernames.contains(&body.username) {
            return Err(AppError::Conflict("Username already connected".into()));
        }
    }

    sqlx::query(
        "INSERT INTO users (id, username) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING",
    )
    .bind(Uuid::new_v4())
    .bind(&body.username)
    .execute(&state.db)
    .await?;

    let token = create_token(
        &body.username,
        &state.config.jwt.secret,
        state.config.jwt.expiration_hours,
    )?;

    Ok(Json(AuthResponse {
        token,
        username: body.username,
    }))
}
