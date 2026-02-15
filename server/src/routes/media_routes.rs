use axum::{
    body::Body,
    extract::DefaultBodyLimit,
    extract::Multipart,
    http::{header, HeaderValue, StatusCode},
    response::Response,
    routing::{get, post},
    Json, Router,
};
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
        .route("/media/{media_id}/{variant}", get(get_media_asset))
        .layer(DefaultBodyLimit::max(max_upload_bytes))
}

async fn get_media_asset(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::extract::Path((media_id, variant)): axum::extract::Path<(Uuid, String)>,
) -> Result<Response, AppError> {
    let record: Option<(String, String)> = if variant == "original" {
        sqlx::query_as(
            "SELECT storage_key, mime_type
             FROM media_assets
             WHERE id = $1 AND derivative_kind IS NULL AND status = 'ready'",
        )
        .bind(media_id)
        .fetch_optional(&state.db)
        .await?
    } else {
        sqlx::query_as(
            "SELECT storage_key, mime_type
             FROM media_assets
             WHERE parent_id = $1 AND derivative_kind = $2 AND status = 'ready'",
        )
        .bind(media_id)
        .bind(&variant)
        .fetch_optional(&state.db)
        .await?
    };

    let (storage_key, mime_type) =
        record.ok_or_else(|| AppError::NotFound("Media asset not found".into()))?;

    let bytes = state.storage.read(&storage_key).await?;

    let mut response = Response::new(Body::from(bytes));
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&mime_type)
            .map_err(|_| AppError::Internal("Invalid content type for media response".into()))?,
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=300"),
    );

    Ok(response)
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
