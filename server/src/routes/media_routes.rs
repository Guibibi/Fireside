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
use std::time::Instant;
use uuid::Uuid;

use crate::auth::extract_claims;
use crate::errors::AppError;
use crate::AppState;

#[derive(Debug, Serialize)]
struct UploadMediaResponse {
    id: Uuid,
    status: String,
}

type MediaFetchRow = (Uuid, Option<Uuid>, Uuid, Option<String>, String, String);

pub fn router(max_upload_bytes: usize) -> Router<AppState> {
    Router::new()
        .route("/media/upload", post(upload_media))
        .route("/media/{media_id}/{variant}", get(get_media_asset))
        .layer(DefaultBodyLimit::max(max_upload_bytes))
}

#[tracing::instrument(skip(state, headers), fields(media_id = %media_id, variant = %variant))]
async fn get_media_asset(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: axum::http::HeaderMap,
    axum::extract::Path((media_id, variant)): axum::extract::Path<(Uuid, String)>,
) -> Result<Response, AppError> {
    let record_query_started = Instant::now();
    let record: Option<MediaFetchRow> = if variant == "original" {
        sqlx::query_as(
            "SELECT id, parent_id, owner_id, derivative_kind, storage_key, mime_type
             FROM media_assets
             WHERE id = $1 AND derivative_kind IS NULL AND status = 'ready'",
        )
        .bind(media_id)
        .fetch_optional(&state.db)
        .await?
    } else {
        sqlx::query_as(
            "SELECT id, parent_id, owner_id, derivative_kind, storage_key, mime_type
             FROM media_assets
             WHERE parent_id = $1 AND derivative_kind = $2 AND status = 'ready'",
        )
        .bind(media_id)
        .bind(&variant)
        .fetch_optional(&state.db)
        .await?
    };
    state.telemetry.observe_db_query(
        "media.get_media_asset.lookup",
        record_query_started.elapsed(),
    );

    let (_asset_id, parent_id, owner_id, derivative_kind, storage_key, mime_type) =
        record.ok_or_else(|| AppError::NotFound("Media asset not found".into()))?;

    let root_media_id = parent_id.unwrap_or(media_id);
    let allow_public_derivative = matches!(
        derivative_kind.as_deref(),
        Some("avatar_64") | Some("avatar_256")
    );

    let linked_to_message: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM message_attachments WHERE media_id = $1)")
            .bind(root_media_id)
            .fetch_one(&state.db)
            .await?;

    let linked_to_emoji: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM emojis WHERE media_id = $1)")
            .bind(root_media_id)
            .fetch_one(&state.db)
            .await?;

    let requester_can_access = if allow_public_derivative || linked_to_message || linked_to_emoji {
        true
    } else {
        let claims = extract_claims(&headers, &state.config.jwt.secret)?;
        claims.user_id == owner_id
    };

    if !requester_can_access {
        state.telemetry.inc_media_denial();
        return Err(AppError::Unauthorized(
            "You do not have access to this media asset".into(),
        ));
    }

    serve_media_asset(state, storage_key, mime_type).await
}

async fn serve_media_asset(
    state: AppState,
    storage_key: String,
    mime_type: String,
) -> Result<Response, AppError> {
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
    let username = extract_claims(&headers, &state.config.jwt.secret)?.username;

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
