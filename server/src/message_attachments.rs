use std::collections::{HashMap, HashSet};

use image::GenericImageView;
use serde::Serialize;
use sqlx::PgPool;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::errors::AppError;
use crate::AppState;

const MAX_ATTACHMENTS_PER_MESSAGE: usize = 10;

#[derive(Debug, Clone)]
pub struct ResolvedMessageAttachment {
    pub media_id: Uuid,
    pub mime_type: String,
    pub bytes: i64,
    pub width: Option<i32>,
    pub height: Option<i32>,
}

#[derive(Debug, Serialize, Clone)]
pub struct MessageAttachmentPayload {
    pub media_id: Uuid,
    pub mime_type: String,
    pub bytes: i64,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub status: String,
    pub thumbnail_url: Option<String>,
    pub display_url: Option<String>,
    pub original_url: String,
}

#[derive(sqlx::FromRow)]
struct CandidateMediaAsset {
    id: Uuid,
    mime_type: String,
    bytes: i64,
}

#[derive(sqlx::FromRow)]
struct StoredAttachmentRow {
    message_id: Uuid,
    media_id: Uuid,
    mime_type: String,
    bytes: i64,
    width: Option<i32>,
    height: Option<i32>,
    status: String,
}

pub async fn resolve_uploads_for_message(
    state: &AppState,
    owner_id: Uuid,
    media_ids: &[Uuid],
) -> Result<Vec<ResolvedMessageAttachment>, AppError> {
    let mut deduped = Vec::<Uuid>::new();
    let mut seen = HashSet::<Uuid>::new();
    for media_id in media_ids {
        if seen.insert(*media_id) {
            deduped.push(*media_id);
        }
    }

    if deduped.len() > MAX_ATTACHMENTS_PER_MESSAGE {
        return Err(AppError::BadRequest(format!(
            "A message can include at most {MAX_ATTACHMENTS_PER_MESSAGE} attachments",
        )));
    }

    if deduped.is_empty() {
        return Ok(Vec::new());
    }

    let records: Vec<CandidateMediaAsset> = sqlx::query_as(
        "SELECT id, mime_type, bytes
         FROM media_assets
         WHERE id = ANY($1)
           AND owner_id = $2
           AND derivative_kind IS NULL
           AND status IN ('processing', 'ready')",
    )
    .bind(&deduped)
    .bind(owner_id)
    .fetch_all(&state.db)
    .await?;

    let records_by_id: HashMap<Uuid, CandidateMediaAsset> = records
        .into_iter()
        .map(|record| (record.id, record))
        .collect();

    let mut resolved = Vec::with_capacity(deduped.len());
    for media_id in deduped {
        let record = records_by_id.get(&media_id).ok_or_else(|| {
            AppError::BadRequest("One or more attachments are unavailable for this user".into())
        })?;

        if !record.mime_type.starts_with("image/") {
            return Err(AppError::BadRequest(
                "Only image uploads can be attached to messages".into(),
            ));
        }

        let (width, height) = read_image_dimensions(state, media_id).await?;
        resolved.push(ResolvedMessageAttachment {
            media_id,
            mime_type: record.mime_type.clone(),
            bytes: record.bytes,
            width,
            height,
        });
    }

    Ok(resolved)
}

pub async fn persist_message_attachments_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    message_id: Uuid,
    attachments: &[ResolvedMessageAttachment],
) -> Result<(), AppError> {
    for attachment in attachments {
        sqlx::query(
            "INSERT INTO message_attachments (id, message_id, media_id, mime_type, bytes, width, height)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(Uuid::new_v4())
        .bind(message_id)
        .bind(attachment.media_id)
        .bind(&attachment.mime_type)
        .bind(attachment.bytes)
        .bind(attachment.width)
        .bind(attachment.height)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

pub async fn load_message_attachments_by_message(
    db: &PgPool,
    message_ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<MessageAttachmentPayload>>, AppError> {
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows: Vec<StoredAttachmentRow> = sqlx::query_as(
        "SELECT ma.message_id,
                ma.media_id,
                ma.mime_type,
                ma.bytes,
                ma.width,
                ma.height,
                media.status
         FROM message_attachments ma
         JOIN media_assets media ON media.id = ma.media_id
         WHERE ma.message_id = ANY($1)
         ORDER BY ma.created_at ASC",
    )
    .bind(message_ids)
    .fetch_all(db)
    .await?;

    let mut by_message = HashMap::<Uuid, Vec<MessageAttachmentPayload>>::new();
    for row in rows {
        let (thumbnail_url, display_url) = if row.status == "ready" {
            (
                Some(format!("/api/media/{}/thumbnail", row.media_id)),
                Some(format!("/api/media/{}/display", row.media_id)),
            )
        } else {
            (None, None)
        };

        by_message
            .entry(row.message_id)
            .or_default()
            .push(MessageAttachmentPayload {
                media_id: row.media_id,
                mime_type: row.mime_type,
                bytes: row.bytes,
                width: row.width,
                height: row.height,
                status: row.status,
                thumbnail_url,
                display_url,
                original_url: format!("/api/media/{}/original", row.media_id),
            });
    }

    Ok(by_message)
}

async fn read_image_dimensions(
    state: &AppState,
    media_id: Uuid,
) -> Result<(Option<i32>, Option<i32>), AppError> {
    let storage_key: Option<String> = sqlx::query_scalar(
        "SELECT storage_key
         FROM media_assets
         WHERE id = $1
           AND derivative_kind IS NULL",
    )
    .bind(media_id)
    .fetch_optional(&state.db)
    .await?;

    let Some(storage_key) = storage_key else {
        return Ok((None, None));
    };

    let bytes = state.storage.read(&storage_key).await?;
    let image = image::load_from_memory(&bytes).map_err(|error| {
        AppError::BadRequest(format!("Attachment is not a valid image payload: {error}"))
    })?;
    let (width, height) = image.dimensions();

    Ok((Some(width as i32), Some(height as i32)))
}
