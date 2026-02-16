use axum::{
    extract::Multipart,
    extract::Path,
    extract::State,
    routing::{delete, get},
    Json, Router,
};
use image::GenericImageView;
use serde::Serialize;
use uuid::Uuid;

use crate::auth::extract_claims;
use crate::errors::AppError;
use crate::models::{Emoji, UserRole};
use crate::AppState;

const MAX_EMOJI_BYTES: usize = 512 * 1024;
const MAX_EMOJI_DIMENSION: u32 = 128;

#[derive(Serialize)]
pub struct CreateEmojiResponse {
    pub id: Uuid,
    pub shortcode: String,
    pub name: String,
    pub media_id: Uuid,
    pub url: String,
}

#[derive(Serialize)]
pub struct EmojiResponse {
    pub id: Uuid,
    pub shortcode: String,
    pub name: String,
    pub url: String,
    pub created_by: Uuid,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/emojis", get(list_emojis).post(create_emoji))
        .route("/emojis/{emoji_id}", delete(delete_emoji))
}

async fn list_emojis(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Vec<EmojiResponse>>, AppError> {
    let _claims = extract_claims(&headers, &state.config.jwt.secret)?;

    let emojis: Vec<Emoji> = sqlx::query_as(
        "SELECT e.id, e.shortcode, e.name, e.media_id, e.created_by, e.created_at
         FROM emojis e
         ORDER BY e.shortcode",
    )
    .fetch_all(&state.db)
    .await?;

    let response: Vec<EmojiResponse> = emojis
        .into_iter()
        .map(|e| EmojiResponse {
            id: e.id,
            shortcode: e.shortcode.clone(),
            name: e.name,
            url: format!("/api/media/{}/display", e.media_id),
            created_by: e.created_by,
        })
        .collect();

    Ok(Json(response))
}

async fn create_emoji(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<CreateEmojiResponse>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;

    let user: (Uuid, UserRole) = sqlx::query_as("SELECT id, role FROM users WHERE username = $1")
        .bind(&claims.username)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::Unauthorized("User not found".into()))?;

    let (user_id, role) = user;

    if !matches!(role, UserRole::Operator | UserRole::Admin) {
        return Err(AppError::Unauthorized(
            "Only operators and admins can create emojis".into(),
        ));
    }

    let mut shortcode: Option<String> = None;
    let mut name: Option<String> = None;
    let mut image_bytes: Option<Vec<u8>> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| AppError::BadRequest(format!("Invalid multipart payload: {error}")))?
    {
        let field_name = field.name().map(String::from);

        match field_name.as_deref() {
            Some("shortcode") => {
                let value = field.text().await.map_err(|error| {
                    AppError::BadRequest(format!("Failed to read shortcode: {error}"))
                })?;
                shortcode = Some(value);
            }
            Some("name") => {
                let value = field.text().await.map_err(|error| {
                    AppError::BadRequest(format!("Failed to read name: {error}"))
                })?;
                name = Some(value);
            }
            Some("file") => {
                let bytes = field.bytes().await.map_err(|error| {
                    AppError::BadRequest(format!("Failed to read file: {error}"))
                })?;
                image_bytes = Some(bytes.to_vec());
            }
            _ => {}
        }
    }

    let shortcode =
        shortcode.ok_or_else(|| AppError::BadRequest("Missing 'shortcode' field".into()))?;
    let name = name.ok_or_else(|| AppError::BadRequest("Missing 'name' field".into()))?;
    let image_bytes =
        image_bytes.ok_or_else(|| AppError::BadRequest("Missing 'file' field".into()))?;

    validate_shortcode(&shortcode)?;

    if name.is_empty() || name.len() > 32 {
        return Err(AppError::BadRequest(
            "Name must be between 1 and 32 characters".into(),
        ));
    }

    let mime_type = sniff_mime_type(&image_bytes)?;
    validate_emoji_mime_type(mime_type)?;

    if image_bytes.len() > MAX_EMOJI_BYTES {
        return Err(AppError::BadRequest(format!(
            "Emoji file exceeds maximum size of {} KB",
            MAX_EMOJI_BYTES / 1024
        )));
    }

    let image = image::load_from_memory(&image_bytes)
        .map_err(|error| AppError::BadRequest(format!("Invalid image file: {error}")))?;

    let (width, height) = image.dimensions();
    if width > MAX_EMOJI_DIMENSION || height > MAX_EMOJI_DIMENSION {
        return Err(AppError::BadRequest(format!(
            "Emoji dimensions must not exceed {}x{} pixels",
            MAX_EMOJI_DIMENSION, MAX_EMOJI_DIMENSION
        )));
    }

    let media_result = state
        .uploads
        .upload_emoji(user_id, mime_type, image_bytes)
        .await?;

    let emoji_id = Uuid::new_v4();

    let result = sqlx::query(
        "INSERT INTO emojis (id, shortcode, name, media_id, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (shortcode) DO NOTHING",
    )
    .bind(emoji_id)
    .bind(&shortcode)
    .bind(&name)
    .bind(media_result.id)
    .bind(user_id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "Emoji with shortcode '{}' already exists",
            shortcode
        )));
    }

    Ok(Json(CreateEmojiResponse {
        id: emoji_id,
        shortcode,
        name,
        media_id: media_result.id,
        url: format!("/api/media/{}/display", media_result.id),
    }))
}

async fn delete_emoji(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(emoji_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;

    let user: (Uuid, UserRole) = sqlx::query_as("SELECT id, role FROM users WHERE username = $1")
        .bind(&claims.username)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::Unauthorized("User not found".into()))?;

    let (_user_id, role) = user;

    if !matches!(role, UserRole::Operator | UserRole::Admin) {
        return Err(AppError::Unauthorized(
            "Only operators and admins can delete emojis".into(),
        ));
    }

    let emoji: Option<(Uuid, Uuid)> =
        sqlx::query_as("SELECT id, media_id FROM emojis WHERE id = $1")
            .bind(emoji_id)
            .fetch_optional(&state.db)
            .await?;

    let (emoji_id, media_id) = match emoji {
        Some(e) => e,
        None => return Err(AppError::NotFound("Emoji not found".into())),
    };

    sqlx::query("DELETE FROM emojis WHERE id = $1")
        .bind(emoji_id)
        .execute(&state.db)
        .await?;

    if let Err(error) = state.uploads.delete_media_family(media_id).await {
        tracing::warn!(
            emoji_id = %emoji_id,
            media_id = %media_id,
            error = ?error,
            "Failed to delete emoji media assets"
        );
    }

    Ok(Json(serde_json::json!({"deleted": true})))
}

fn validate_shortcode(shortcode: &str) -> Result<(), AppError> {
    if shortcode.is_empty() || shortcode.len() > 32 {
        return Err(AppError::BadRequest(
            "Shortcode must be between 1 and 32 characters".into(),
        ));
    }

    if !shortcode.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return Err(AppError::BadRequest(
            "Shortcode can only contain letters, numbers, and underscores".into(),
        ));
    }

    if shortcode.starts_with('_') || shortcode.ends_with('_') {
        return Err(AppError::BadRequest(
            "Shortcode cannot start or end with an underscore".into(),
        ));
    }

    Ok(())
}

fn validate_emoji_mime_type(mime_type: &str) -> Result<(), AppError> {
    match mime_type {
        "image/png" | "image/webp" | "image/gif" => Ok(()),
        _ => Err(AppError::BadRequest(
            "Unsupported emoji format. Allowed: PNG, WEBP, GIF".into(),
        )),
    }
}

fn sniff_mime_type(bytes: &[u8]) -> Result<&'static str, AppError> {
    if bytes.len() >= 8
        && bytes[0] == 0x89
        && bytes[1] == b'P'
        && bytes[2] == b'N'
        && bytes[3] == b'G'
        && bytes[4] == 0x0D
        && bytes[5] == 0x0A
        && bytes[6] == 0x1A
        && bytes[7] == 0x0A
    {
        return Ok("image/png");
    }

    if bytes.len() >= 6 && (&bytes[..6] == b"GIF87a" || &bytes[..6] == b"GIF89a") {
        return Ok("image/gif");
    }

    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Ok("image/webp");
    }

    Err(AppError::BadRequest(
        "Unsupported image format. Allowed: PNG, WEBP, GIF".into(),
    ))
}
