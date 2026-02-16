use axum::{
    extract::Multipart,
    extract::Path,
    extract::State,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::{create_token, extract_claims};
use crate::errors::AppError;
use crate::ws::broadcast::broadcast_global_message;
use crate::ws::messages::ServerMessage;
use crate::AppState;

type UserProfileRow = (
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
);

#[derive(Deserialize)]
pub struct UpdateCurrentUserRequest {
    pub display_name: String,
    pub profile_description: Option<String>,
    pub profile_status: Option<String>,
}

#[derive(Serialize)]
pub struct UpdateCurrentUserResponse {
    pub token: String,
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub avatar_url: Option<String>,
    pub profile_description: Option<String>,
    pub profile_status: Option<String>,
}

#[derive(Serialize)]
pub struct UsersResponse {
    pub usernames: Vec<String>,
    pub users: Vec<UserSummary>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct UserSummary {
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub profile_description: Option<String>,
    pub profile_status: Option<String>,
}

#[derive(Serialize)]
pub struct CurrentUserResponse {
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub profile_description: Option<String>,
    pub profile_status: Option<String>,
}

#[derive(Serialize)]
pub struct UserProfileResponse {
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub profile_description: Option<String>,
    pub profile_status: Option<String>,
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
        .route("/users/{username}", get(get_user_profile))
        .route("/users/me/avatar", post(upload_current_user_avatar))
}

fn normalize_optional_profile_field(
    value: Option<&str>,
    max_len: usize,
    label: &str,
) -> Result<Option<String>, AppError> {
    let Some(raw) = value else {
        return Ok(None);
    };

    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    if trimmed.chars().count() > max_len {
        return Err(AppError::BadRequest(format!(
            "{label} must be {max_len} characters or fewer"
        )));
    }

    Ok(Some(trimmed.to_string()))
}

async fn update_current_user(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<UpdateCurrentUserRequest>,
) -> Result<Json<UpdateCurrentUserResponse>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;
    let current_username = &claims.username;
    let user_id = claims.user_id;
    let next_display_name = body.display_name.trim();
    let current_avatar_url: Option<String> =
        sqlx::query_scalar("SELECT avatar_url FROM users WHERE username = $1")
            .bind(current_username)
            .fetch_optional(&state.db)
            .await?
            .flatten();

    let profile_description = normalize_optional_profile_field(
        body.profile_description.as_deref(),
        280,
        "Profile description",
    )?;
    let profile_status =
        normalize_optional_profile_field(body.profile_status.as_deref(), 80, "Profile status")?;

    if next_display_name.is_empty() || next_display_name.len() > 32 {
        return Err(AppError::BadRequest(
            "Display name must be between 1 and 32 characters".into(),
        ));
    }

    let updated = sqlx::query(
        "UPDATE users
         SET
           display_name = $1,
           profile_description = $2,
           profile_status = $3
         WHERE username = $4",
    )
    .bind(next_display_name)
    .bind(profile_description.clone())
    .bind(profile_status.clone())
    .bind(current_username)
    .execute(&state.db)
    .await?;

    if updated.rows_affected() == 0 {
        return Err(AppError::Unauthorized("User not found".into()));
    }

    broadcast_global_message(
        &state,
        ServerMessage::UserProfileUpdated {
            username: current_username.to_string(),
            display_name: next_display_name.to_string(),
            avatar_url: current_avatar_url.clone(),
            profile_description: profile_description.clone(),
            profile_status: profile_status.clone(),
        },
        None,
    )
    .await;

    let token = create_token(
        user_id,
        current_username,
        &claims.role,
        &state.config.jwt.secret,
        state.config.jwt.expiration_hours,
    )?;

    Ok(Json(UpdateCurrentUserResponse {
        token,
        user_id,
        username: current_username.to_string(),
        display_name: next_display_name.to_string(),
        role: claims.role,
        avatar_url: current_avatar_url,
        profile_description,
        profile_status,
    }))
}

async fn get_current_user(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<CurrentUserResponse>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;

    let row: Option<UserProfileRow> = sqlx::query_as(
        "SELECT
               username,
               COALESCE(display_name, username) AS display_name,
               avatar_url,
               profile_description,
               profile_status
             FROM users
             WHERE username = $1",
    )
    .bind(&claims.username)
    .fetch_optional(&state.db)
    .await?;

    let (username, display_name, avatar_url, profile_description, profile_status) =
        row.ok_or_else(|| AppError::Unauthorized("User not found".into()))?;

    Ok(Json(CurrentUserResponse {
        username,
        display_name,
        avatar_url,
        profile_description,
        profile_status,
    }))
}

async fn get_user_profile(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(username): Path<String>,
) -> Result<Json<UserProfileResponse>, AppError> {
    let _claims = extract_claims(&headers, &state.config.jwt.secret)?;

    let row: Option<UserProfileRow> = sqlx::query_as(
        "SELECT
               username,
               COALESCE(display_name, username) AS display_name,
               avatar_url,
               profile_description,
               profile_status
             FROM users
             WHERE username = $1",
    )
    .bind(username)
    .fetch_optional(&state.db)
    .await?;

    let (username, display_name, avatar_url, profile_description, profile_status) =
        row.ok_or_else(|| AppError::NotFound("User not found".into()))?;

    Ok(Json(UserProfileResponse {
        username,
        display_name,
        avatar_url,
        profile_description,
        profile_status,
    }))
}

async fn get_users(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<UsersResponse>, AppError> {
    let _claims = extract_claims(&headers, &state.config.jwt.secret)?;

    let users: Vec<UserSummary> = sqlx::query_as(
        "SELECT
               username,
               COALESCE(display_name, username) AS display_name,
               avatar_url,
               profile_description,
               profile_status
             FROM users
             ORDER BY username ASC",
    )
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
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;
    let user_id = claims.user_id;

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
