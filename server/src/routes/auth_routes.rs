use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::{create_token, hash_password, verify_password};
use crate::errors::AppError;
use crate::models::UserRole;
use crate::AppState;

#[derive(Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user_id: Uuid,
    pub username: String,
    pub role: String,
}

#[derive(Serialize)]
pub struct SetupStatusResponse {
    pub needs_setup: bool,
}

#[derive(Deserialize)]
pub struct SetupRequest {
    pub username: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub invite_code: String,
    pub username: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/setup-status", get(setup_status))
        .route("/setup", post(setup))
        .route("/register", post(register))
        .route("/login", post(login))
}

async fn setup_status(
    State(state): State<AppState>,
) -> Result<Json<SetupStatusResponse>, AppError> {
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(&state.db)
        .await?;

    Ok(Json(SetupStatusResponse {
        needs_setup: count == 0,
    }))
}

async fn setup(
    State(state): State<AppState>,
    Json(body): Json<SetupRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    validate_username(&body.username)?;
    validate_password(&body.password)?;

    let password_hash = hash_password(&body.password)?;
    let user_id = Uuid::new_v4();
    let role = UserRole::Operator;

    // Atomic check-and-insert: only succeeds if no users exist yet
    let result = sqlx::query(
        "INSERT INTO users (id, username, password_hash, role)
         SELECT $1, $2, $3, $4::user_role
         WHERE NOT EXISTS (SELECT 1 FROM users)",
    )
    .bind(user_id)
    .bind(&body.username)
    .bind(&password_hash)
    .bind(role.as_str())
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::BadRequest(
            "Setup has already been completed".into(),
        ));
    }

    let token = create_token(
        user_id,
        &body.username,
        role.as_str(),
        &state.config.jwt.secret,
        state.config.jwt.expiration_hours,
    )?;

    Ok(Json(AuthResponse {
        token,
        user_id,
        username: body.username,
        role: role.as_str().to_string(),
    }))
}

async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    validate_username(&body.username)?;
    validate_password(&body.password)?;

    let password_hash = hash_password(&body.password)?;
    let user_id = Uuid::new_v4();
    let role = UserRole::Member;

    let mut tx = state.db.begin().await?;

    // Lock the invite row to prevent concurrent redemption
    let invite: Option<crate::models::Invite> =
        sqlx::query_as("SELECT * FROM invites WHERE code = $1 FOR UPDATE")
            .bind(&body.invite_code)
            .fetch_optional(&mut *tx)
            .await?;

    let invite = invite.ok_or_else(|| AppError::BadRequest("Invalid invite code".into()))?;

    if invite.revoked {
        return Err(AppError::BadRequest("Invite code has been revoked".into()));
    }

    if let Some(expires_at) = invite.expires_at {
        if chrono::Utc::now() > expires_at {
            return Err(AppError::BadRequest("Invite code has expired".into()));
        }
    }

    if let Some(max_uses) = invite.max_uses {
        if invite.used_count >= max_uses {
            return Err(AppError::BadRequest(
                "Invite code has been fully used".into(),
            ));
        }
    }

    let existing: Option<(String,)> =
        sqlx::query_as("SELECT username FROM users WHERE username = $1")
            .bind(&body.username)
            .fetch_optional(&mut *tx)
            .await?;

    if existing.is_some() {
        return Err(AppError::Conflict("Username is already taken".into()));
    }

    sqlx::query(
        "INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4::user_role)",
    )
    .bind(user_id)
    .bind(&body.username)
    .bind(&password_hash)
    .bind(role.as_str())
    .execute(&mut *tx)
    .await?;

    if invite.single_use {
        sqlx::query("UPDATE invites SET used_count = used_count + 1, revoked = true WHERE id = $1")
            .bind(invite.id)
            .execute(&mut *tx)
            .await?;
    } else {
        sqlx::query("UPDATE invites SET used_count = used_count + 1 WHERE id = $1")
            .bind(invite.id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;

    let token = create_token(
        user_id,
        &body.username,
        role.as_str(),
        &state.config.jwt.secret,
        state.config.jwt.expiration_hours,
    )?;

    Ok(Json(AuthResponse {
        token,
        user_id,
        username: body.username,
        role: role.as_str().to_string(),
    }))
}

async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let row: Option<(Uuid, String, String, UserRole)> =
        sqlx::query_as("SELECT id, username, password_hash, role FROM users WHERE username = $1")
            .bind(&body.username)
            .fetch_optional(&state.db)
            .await?;

    let (user_id, username, password_hash, role) =
        row.ok_or_else(|| AppError::Unauthorized("Invalid username or password".into()))?;

    let valid = verify_password(&body.password, &password_hash)?;
    if !valid {
        return Err(AppError::Unauthorized(
            "Invalid username or password".into(),
        ));
    }

    let token = create_token(
        user_id,
        &username,
        role.as_str(),
        &state.config.jwt.secret,
        state.config.jwt.expiration_hours,
    )?;

    Ok(Json(AuthResponse {
        token,
        user_id,
        username,
        role: role.as_str().to_string(),
    }))
}

fn validate_username(username: &str) -> Result<(), AppError> {
    if username.len() < 3 || username.len() > 32 {
        return Err(AppError::BadRequest(
            "Username must be between 3 and 32 characters".into(),
        ));
    }
    Ok(())
}

fn validate_password(password: &str) -> Result<(), AppError> {
    if password.len() < 8 || password.len() > 128 {
        return Err(AppError::BadRequest(
            "Password must be between 8 and 128 characters".into(),
        ));
    }
    Ok(())
}
