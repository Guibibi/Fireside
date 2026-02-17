use axum::{
    extract::{DefaultBodyLimit, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::auth::{create_token, hash_password, verify_password};
use crate::errors::AppError;
use crate::models::UserRole;
use crate::AppState;

const AUTH_RATE_LIMIT_WINDOW: Duration = Duration::from_secs(60);
const LOGIN_MAX_ATTEMPTS_PER_WINDOW: u32 = 12;
const REGISTER_MAX_ATTEMPTS_PER_WINDOW: u32 = 10;
const SETUP_MAX_ATTEMPTS_PER_WINDOW: u32 = 5;
const AUTH_MAX_REQUEST_BODY_BYTES: usize = 16 * 1024;
const USERNAME_MIN_LENGTH: usize = 3;
const USERNAME_MAX_LENGTH: usize = 32;
const DISPLAY_NAME_MAX_LENGTH: usize = 32;

#[derive(Debug, Clone)]
struct AuthRateLimitEntry {
    window_started_at: Instant,
    attempts: u32,
}

static AUTH_RATE_LIMITS: LazyLock<Mutex<HashMap<String, AuthRateLimitEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

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
    pub display_name: Option<String>,
    pub password: String,
}

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub invite_code: String,
    pub username: String,
    pub display_name: Option<String>,
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
        .layer(DefaultBodyLimit::max(AUTH_MAX_REQUEST_BODY_BYTES))
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
    headers: HeaderMap,
    Json(body): Json<SetupRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let client_ip = client_ip_from_headers(&headers);
    let rate_limit_key = format!("setup:{client_ip}");
    if !allow_auth_attempt(rate_limit_key, SETUP_MAX_ATTEMPTS_PER_WINDOW).await {
        state.telemetry.inc_auth_rate_limit_hit();
        tracing::warn!(
            event = "auth_setup_rate_limited",
            client_ip = %client_ip,
            "Blocked setup request by auth rate limiter"
        );
        return Err(AppError::TooManyRequests(
            "Too many setup attempts. Please try again later.".into(),
        ));
    }

    validate_username(&body.username)?;
    validate_password(&body.password)?;
    let display_name = normalize_display_name(body.display_name.as_deref(), &body.username)?;

    let password_hash = hash_password(&body.password)?;
    let user_id = Uuid::new_v4();
    let role = UserRole::Operator;

    // Atomic check-and-insert: only succeeds if no users exist yet
    let result = sqlx::query(
        "INSERT INTO users (id, username, display_name, password_hash, role)
         SELECT $1, $2, $3, $4, $5::user_role
         WHERE NOT EXISTS (SELECT 1 FROM users)",
    )
    .bind(user_id)
    .bind(&body.username)
    .bind(&display_name)
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
    headers: HeaderMap,
    Json(body): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let client_ip = client_ip_from_headers(&headers);
    let rate_limit_key = format!(
        "register:{client_ip}:{}",
        body.username.to_ascii_lowercase()
    );
    if !allow_auth_attempt(rate_limit_key, REGISTER_MAX_ATTEMPTS_PER_WINDOW).await {
        state.telemetry.inc_auth_rate_limit_hit();
        tracing::warn!(
            event = "auth_register_rate_limited",
            client_ip = %client_ip,
            username = %body.username,
            "Blocked registration request by auth rate limiter"
        );
        return Err(AppError::TooManyRequests(
            "Too many registration attempts. Please try again later.".into(),
        ));
    }

    validate_username(&body.username)?;
    validate_password(&body.password)?;
    let display_name = normalize_display_name(body.display_name.as_deref(), &body.username)?;

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
        "INSERT INTO users (id, username, display_name, password_hash, role) VALUES ($1, $2, $3, $4, $5::user_role)",
    )
    .bind(user_id)
    .bind(&body.username)
    .bind(&display_name)
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
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let client_ip = client_ip_from_headers(&headers);
    let rate_limit_key = format!("login:{client_ip}:{}", body.username.to_ascii_lowercase());
    if !allow_auth_attempt(rate_limit_key, LOGIN_MAX_ATTEMPTS_PER_WINDOW).await {
        state.telemetry.inc_auth_rate_limit_hit();
        tracing::warn!(
            event = "auth_login_rate_limited",
            client_ip = %client_ip,
            username = %body.username,
            "Blocked login request by auth rate limiter"
        );
        return Err(AppError::TooManyRequests(
            "Too many login attempts. Please try again later.".into(),
        ));
    }

    let row: Option<(Uuid, String, String, UserRole)> =
        sqlx::query_as("SELECT id, username, password_hash, role FROM users WHERE username = $1")
            .bind(&body.username)
            .fetch_optional(&state.db)
            .await?;

    let (user_id, username, password_hash, role) = row.ok_or_else(|| {
        state.telemetry.inc_auth_failure();
        tracing::warn!(
            event = "auth_login_failed",
            client_ip = %client_ip,
            username = %body.username,
            reason = "unknown_username",
            "Login failed"
        );
        AppError::Unauthorized("Invalid username or password".into())
    })?;

    let valid = verify_password(&body.password, &password_hash)?;
    if !valid {
        state.telemetry.inc_auth_failure();
        tracing::warn!(
            event = "auth_login_failed",
            client_ip = %client_ip,
            username = %body.username,
            reason = "invalid_password",
            "Login failed"
        );
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

fn client_ip_from_headers(headers: &HeaderMap) -> String {
    if let Some(value) = headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
    {
        if let Some(first) = value.split(',').next() {
            let first = first.trim();
            if !first.is_empty() {
                return first.to_string();
            }
        }
    }

    if let Some(value) = headers
        .get("x-real-ip")
        .and_then(|value| value.to_str().ok())
    {
        let value = value.trim();
        if !value.is_empty() {
            return value.to_string();
        }
    }

    "unknown".to_string()
}

async fn allow_auth_attempt(key: String, max_attempts_per_window: u32) -> bool {
    let now = Instant::now();
    let mut limits = AUTH_RATE_LIMITS.lock().await;

    limits.retain(|_, entry| now.duration_since(entry.window_started_at) < AUTH_RATE_LIMIT_WINDOW);

    let entry = limits.entry(key).or_insert(AuthRateLimitEntry {
        window_started_at: now,
        attempts: 0,
    });

    if now.duration_since(entry.window_started_at) >= AUTH_RATE_LIMIT_WINDOW {
        entry.window_started_at = now;
        entry.attempts = 0;
    }

    if entry.attempts >= max_attempts_per_window {
        return false;
    }

    entry.attempts += 1;
    true
}

fn validate_username(username: &str) -> Result<(), AppError> {
    if username.len() < USERNAME_MIN_LENGTH || username.len() > USERNAME_MAX_LENGTH {
        return Err(AppError::BadRequest(
            "Username must be between 3 and 32 characters".into(),
        ));
    }

    if username.chars().any(char::is_whitespace) {
        return Err(AppError::BadRequest(
            "Username cannot contain spaces".into(),
        ));
    }

    if !username
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.'))
    {
        return Err(AppError::BadRequest(
            "Username can only contain letters, numbers, ., _, and -".into(),
        ));
    }

    Ok(())
}

fn normalize_display_name(display_name: Option<&str>, username: &str) -> Result<String, AppError> {
    let candidate = display_name.unwrap_or(username).trim();

    if candidate.is_empty() || candidate.len() > DISPLAY_NAME_MAX_LENGTH {
        return Err(AppError::BadRequest(
            "Display name must be between 1 and 32 characters".into(),
        ));
    }

    Ok(candidate.to_string())
}

fn validate_password(password: &str) -> Result<(), AppError> {
    if password.len() < 8 || password.len() > 128 {
        return Err(AppError::BadRequest(
            "Password must be between 8 and 128 characters".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[tokio::test]
    async fn rate_limiter_blocks_after_limit() {
        let key = format!("test:login:block:{}", Uuid::new_v4());

        for _ in 0..LOGIN_MAX_ATTEMPTS_PER_WINDOW {
            assert!(allow_auth_attempt(key.clone(), LOGIN_MAX_ATTEMPTS_PER_WINDOW).await);
        }

        assert!(!allow_auth_attempt(key, LOGIN_MAX_ATTEMPTS_PER_WINDOW).await);
    }

    #[tokio::test]
    async fn rate_limiter_resets_after_window() {
        let key = format!("test:login:reset:{}", Uuid::new_v4());
        {
            let mut limits = AUTH_RATE_LIMITS.lock().await;
            limits.insert(
                key.clone(),
                AuthRateLimitEntry {
                    window_started_at: Instant::now()
                        - AUTH_RATE_LIMIT_WINDOW
                        - Duration::from_secs(1),
                    attempts: LOGIN_MAX_ATTEMPTS_PER_WINDOW,
                },
            );
        }

        assert!(allow_auth_attempt(key.clone(), LOGIN_MAX_ATTEMPTS_PER_WINDOW).await);

        let limits = AUTH_RATE_LIMITS.lock().await;
        let entry = limits.get(&key).expect("entry should exist");
        assert_eq!(entry.attempts, 1);
    }

    #[test]
    fn client_ip_uses_forwarded_for_first_value() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static(" 203.0.113.8 , 10.0.0.1"),
        );

        assert_eq!(client_ip_from_headers(&headers), "203.0.113.8");
    }

    #[test]
    fn client_ip_falls_back_to_x_real_ip() {
        let mut headers = HeaderMap::new();
        headers.insert("x-real-ip", HeaderValue::from_static("198.51.100.9"));

        assert_eq!(client_ip_from_headers(&headers), "198.51.100.9");
    }

    #[test]
    fn validate_username_rejects_spaces() {
        let result = validate_username("john doe");

        assert!(result.is_err());
    }

    #[test]
    fn validate_username_rejects_symbols() {
        let result = validate_username("john@doe");

        assert!(result.is_err());
    }

    #[test]
    fn normalize_display_name_accepts_spaces_and_symbols() {
        let display_name = normalize_display_name(Some("John Doe !!"), "johndoe")
            .expect("display name should be valid");

        assert_eq!(display_name, "John Doe !!");
    }
}
