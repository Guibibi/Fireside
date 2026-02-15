use axum::{extract::DefaultBodyLimit, extract::Multipart, routing::post, Json, Router};
use serde::Serialize;
use uuid::Uuid;

use crate::auth::validate_token;
use crate::errors::AppError;
use crate::AppState;

#[derive(Debug, Serialize)]
struct UploadMediaResponse {
    id: Uuid,
    status: String,
}

pub fn router(max_upload_bytes: usize) -> Router<AppState> {
    Router::new()
        .route("/media/upload", post(upload_media))
        .layer(DefaultBodyLimit::max(max_upload_bytes))
}

async fn upload_media(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: axum::http::HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<UploadMediaResponse>, AppError> {
    let username = extract_username(&headers, &state.config.jwt.secret)?;

    let user_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE username = $1")
        .bind(&username)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::Unauthorized("User not found".into()))?;

    let mut uploaded = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| AppError::BadRequest(format!("Invalid multipart payload: {error}")))?
    {
        let is_file_field = field.name() == Some("file");
        if !is_file_field {
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
                .upload_image(user_id, mime_type, bytes.to_vec())
                .await?,
        );
        break;
    }

    let uploaded = uploaded
        .ok_or_else(|| AppError::BadRequest("Multipart form must include 'file'".into()))?;

    Ok(Json(UploadMediaResponse {
        id: uploaded.id,
        status: uploaded.status,
    }))
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
