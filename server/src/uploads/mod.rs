use image::GenericImageView;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::io::Cursor;
use std::sync::Arc;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::MediaAsset;
use crate::storage::StorageBackend;

#[derive(Debug, serde::Serialize)]
pub struct UploadResult {
    pub id: Uuid,
    pub status: String,
}

#[derive(Clone)]
pub struct UploadService {
    db: PgPool,
    storage: Arc<dyn StorageBackend>,
    max_upload_bytes: usize,
}

impl UploadService {
    pub fn new(db: PgPool, storage: Arc<dyn StorageBackend>, max_upload_bytes: usize) -> Self {
        Self {
            db,
            storage,
            max_upload_bytes,
        }
    }

    pub async fn upload_image(
        &self,
        owner_id: Uuid,
        _declared_mime_type: String,
        bytes: Vec<u8>,
    ) -> Result<UploadResult, AppError> {
        let mime_type = sniff_mime_type(&bytes)?;
        validate_mime_type(mime_type)?;

        if bytes.is_empty() {
            return Err(AppError::BadRequest("Upload payload is empty".into()));
        }

        if bytes.len() > self.max_upload_bytes {
            return Err(AppError::BadRequest(format!(
                "Upload exceeds limit of {} bytes",
                self.max_upload_bytes,
            )));
        }

        let media_id = Uuid::new_v4();
        let storage_key = format!("original/{media_id}.{}", extension_for_mime(mime_type));
        let checksum = sha256_hex(&bytes);

        sqlx::query(
            "INSERT INTO media_assets (id, owner_id, parent_id, derivative_kind, mime_type, bytes, checksum, storage_key, status)
             VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6, 'processing')",
        )
        .bind(media_id)
        .bind(owner_id)
        .bind(mime_type)
        .bind(bytes.len() as i64)
        .bind(&checksum)
        .bind(&storage_key)
        .execute(&self.db)
        .await?;

        if let Err(error) = self.storage.put(&storage_key, bytes, mime_type).await {
            self.mark_failed(
                media_id,
                &format!("Failed to persist original upload: {error:?}"),
            )
            .await?;
            return Err(error);
        }

        let processor = self.clone();
        tokio::spawn(async move {
            if let Err(error) = processor.process_derivatives(media_id).await {
                tracing::error!(media_id = %media_id, error = ?error, "Derivative processing failed");
                let _ = processor
                    .mark_failed(
                        media_id,
                        &format!("Derivative processing failed: {error:?}"),
                    )
                    .await;
            }
        });

        Ok(UploadResult {
            id: media_id,
            status: "processing".to_string(),
        })
    }

    pub async fn upload_avatar(
        &self,
        owner_id: Uuid,
        _declared_mime_type: String,
        bytes: Vec<u8>,
    ) -> Result<UploadResult, AppError> {
        let mime_type = sniff_mime_type(&bytes)?;
        validate_avatar_mime_type(mime_type)?;

        if bytes.is_empty() {
            return Err(AppError::BadRequest("Upload payload is empty".into()));
        }

        const AVATAR_MAX_BYTES: usize = 2 * 1024 * 1024;
        if bytes.len() > AVATAR_MAX_BYTES {
            return Err(AppError::BadRequest(
                "Avatar upload exceeds limit of 2097152 bytes".into(),
            ));
        }

        let media_id = Uuid::new_v4();
        let storage_key = format!("original/{media_id}.{}", extension_for_mime(mime_type));
        let checksum = sha256_hex(&bytes);

        sqlx::query(
            "INSERT INTO media_assets (id, owner_id, parent_id, derivative_kind, mime_type, bytes, checksum, storage_key, status)
             VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6, 'processing')",
        )
        .bind(media_id)
        .bind(owner_id)
        .bind(mime_type)
        .bind(bytes.len() as i64)
        .bind(&checksum)
        .bind(&storage_key)
        .execute(&self.db)
        .await?;

        if let Err(error) = self.storage.put(&storage_key, bytes, mime_type).await {
            self.mark_failed(
                media_id,
                &format!("Failed to persist avatar upload: {error:?}"),
            )
            .await?;
            return Err(error);
        }

        if let Err(error) = self.process_avatar_derivatives(media_id).await {
            self.mark_failed(
                media_id,
                &format!("Avatar derivative processing failed: {error:?}"),
            )
            .await?;
            return Err(error);
        }

        sqlx::query("UPDATE users SET avatar_url = $1 WHERE id = $2")
            .bind(format!("/api/media/{media_id}/avatar_64"))
            .bind(owner_id)
            .execute(&self.db)
            .await?;

        if let Err(error) = self
            .cleanup_previous_avatar_assets(owner_id, media_id)
            .await
        {
            tracing::warn!(
                owner_id = %owner_id,
                keep_media_id = %media_id,
                error = ?error,
                "Failed to cleanup previous avatar assets"
            );
        }

        Ok(UploadResult {
            id: media_id,
            status: "ready".to_string(),
        })
    }

    pub async fn cleanup_derivatives(&self, failed_retention_hours: i64) -> Result<u64, AppError> {
        let candidates: Vec<(Uuid, String)> = sqlx::query_as(
            "SELECT d.id, d.storage_key
             FROM media_assets d
             LEFT JOIN media_assets p ON p.id = d.parent_id
             WHERE d.derivative_kind IS NOT NULL
               AND (
                 p.id IS NULL
                  OR (d.status = 'failed' AND d.updated_at < now() - make_interval(hours => $1))
                  OR (p.status = 'failed' AND p.updated_at < now() - make_interval(hours => $1))
                )",
        )
        .bind(failed_retention_hours)
        .fetch_all(&self.db)
        .await?;

        let mut deleted_count = 0_u64;
        for (id, storage_key) in candidates {
            if let Err(error) = self.storage.delete(&storage_key).await {
                tracing::warn!(
                    media_id = %id,
                    storage_key = %storage_key,
                    error = ?error,
                    "Failed to delete derivative object during cleanup"
                );
                continue;
            }

            sqlx::query("DELETE FROM media_assets WHERE id = $1")
                .bind(id)
                .execute(&self.db)
                .await?;
            deleted_count += 1;
        }

        Ok(deleted_count)
    }

    pub async fn cleanup_orphan_message_uploads(
        &self,
        unattached_retention_hours: i64,
    ) -> Result<u64, AppError> {
        let parent_rows: Vec<(Uuid,)> = sqlx::query_as(
            "SELECT p.id
             FROM media_assets p
             WHERE p.derivative_kind IS NULL
               AND (
                    (
                        p.status IN ('ready', 'failed')
                        AND p.updated_at < now() - make_interval(hours => $1)
                    )
                    OR (
                        p.status = 'processing'
                        AND p.updated_at < now() - make_interval(hours => $1 * 4)
                    )
               )
               AND NOT EXISTS (
                    SELECT 1 FROM message_attachments ma WHERE ma.media_id = p.id
               )
               AND NOT EXISTS (
                    SELECT 1
                    FROM media_assets d
                    WHERE d.parent_id = p.id
                      AND d.derivative_kind IN ('avatar_64', 'avatar_256')
               )",
        )
        .bind(unattached_retention_hours)
        .fetch_all(&self.db)
        .await?;

        let mut deleted_count = 0_u64;
        for (parent_id,) in parent_rows {
            if self.delete_media_family(parent_id).await? {
                deleted_count += 1;
            }
        }

        Ok(deleted_count)
    }

    async fn process_derivatives(&self, media_id: Uuid) -> Result<(), AppError> {
        let original: MediaAsset = sqlx::query_as("SELECT * FROM media_assets WHERE id = $1")
            .bind(media_id)
            .fetch_one(&self.db)
            .await?;

        let source_bytes = self.storage.read(&original.storage_key).await?;

        let image = image::load_from_memory(&source_bytes)
            .map_err(|error| AppError::BadRequest(format!("Unsupported image payload: {error}")))?;

        self.write_derivative(
            media_id,
            original.owner_id,
            "thumbnail",
            image.thumbnail(320, 320),
        )
        .await?;

        let (width, height) = image.dimensions();
        let display = if width > 1920 || height > 1920 {
            image.resize(1920, 1920, image::imageops::FilterType::Lanczos3)
        } else {
            image
        };
        self.write_derivative(media_id, original.owner_id, "display", display)
            .await?;

        sqlx::query("UPDATE media_assets SET status = 'ready', error_message = NULL, updated_at = now() WHERE id = $1")
            .bind(media_id)
            .execute(&self.db)
            .await?;

        Ok(())
    }

    async fn process_avatar_derivatives(&self, media_id: Uuid) -> Result<(), AppError> {
        let original: MediaAsset = sqlx::query_as("SELECT * FROM media_assets WHERE id = $1")
            .bind(media_id)
            .fetch_one(&self.db)
            .await?;

        let source_bytes = self.storage.read(&original.storage_key).await?;

        let image = image::load_from_memory(&source_bytes)
            .map_err(|error| AppError::BadRequest(format!("Unsupported image payload: {error}")))?;

        let cropped = crop_square(&image);

        self.write_derivative(
            media_id,
            original.owner_id,
            "avatar_256",
            cropped.resize_exact(256, 256, image::imageops::FilterType::Lanczos3),
        )
        .await?;

        self.write_derivative(
            media_id,
            original.owner_id,
            "avatar_64",
            cropped.resize_exact(64, 64, image::imageops::FilterType::Lanczos3),
        )
        .await?;

        sqlx::query(
            "UPDATE media_assets SET status = 'ready', error_message = NULL, updated_at = now() WHERE id = $1",
        )
        .bind(media_id)
        .execute(&self.db)
        .await?;

        Ok(())
    }

    async fn write_derivative(
        &self,
        parent_id: Uuid,
        owner_id: Uuid,
        derivative_kind: &str,
        image: image::DynamicImage,
    ) -> Result<(), AppError> {
        let bytes = encode_webp(&image)?;
        let derivative_id = Uuid::new_v4();
        let storage_key = format!("derivatives/{parent_id}/{derivative_kind}.webp");
        let checksum = sha256_hex(&bytes);

        self.storage
            .put(&storage_key, bytes.clone(), "image/webp")
            .await?;

        sqlx::query(
            "INSERT INTO media_assets (id, owner_id, parent_id, derivative_kind, mime_type, bytes, checksum, storage_key, status)
             VALUES ($1, $2, $3, $4, 'image/webp', $5, $6, $7, 'ready')",
        )
        .bind(derivative_id)
        .bind(owner_id)
        .bind(parent_id)
        .bind(derivative_kind)
        .bind(bytes.len() as i64)
        .bind(checksum)
        .bind(storage_key)
        .execute(&self.db)
        .await?;

        Ok(())
    }

    async fn mark_failed(&self, media_id: Uuid, message: &str) -> Result<(), AppError> {
        sqlx::query("UPDATE media_assets SET status = 'failed', error_message = $2, updated_at = now() WHERE id = $1")
            .bind(media_id)
            .bind(message)
            .execute(&self.db)
            .await?;
        Ok(())
    }

    async fn cleanup_previous_avatar_assets(
        &self,
        owner_id: Uuid,
        keep_media_id: Uuid,
    ) -> Result<(), AppError> {
        let parent_rows: Vec<(Uuid,)> = sqlx::query_as(
            "SELECT DISTINCT p.id
             FROM media_assets p
             JOIN media_assets d ON d.parent_id = p.id
             WHERE p.owner_id = $1
               AND p.id != $2
               AND d.derivative_kind IN ('avatar_64', 'avatar_256')",
        )
        .bind(owner_id)
        .bind(keep_media_id)
        .fetch_all(&self.db)
        .await?;

        for (parent_id,) in parent_rows {
            if let Err(error) = self.delete_media_family(parent_id).await {
                tracing::warn!(
                    owner_id = %owner_id,
                    parent_id = %parent_id,
                    error = ?error,
                    "Failed to delete old avatar object"
                );
            }
        }

        Ok(())
    }

    async fn delete_media_family(&self, parent_id: Uuid) -> Result<bool, AppError> {
        let assets: Vec<(String,)> =
            sqlx::query_as("SELECT storage_key FROM media_assets WHERE id = $1 OR parent_id = $1")
                .bind(parent_id)
                .fetch_all(&self.db)
                .await?;

        if assets.is_empty() {
            return Ok(false);
        }

        for (storage_key,) in assets {
            if let Err(error) = self.storage.delete(&storage_key).await {
                tracing::warn!(
                    parent_id = %parent_id,
                    storage_key = %storage_key,
                    error = ?error,
                    "Failed to delete media object"
                );
            }
        }

        sqlx::query("DELETE FROM media_assets WHERE id = $1 OR parent_id = $1")
            .bind(parent_id)
            .execute(&self.db)
            .await?;

        Ok(true)
    }
}

fn validate_mime_type(mime_type: &str) -> Result<(), AppError> {
    match mime_type {
        "image/jpeg" | "image/png" | "image/webp" | "image/gif" => Ok(()),
        _ => Err(AppError::BadRequest(
            "Unsupported MIME type. Allowed: image/jpeg, image/png, image/webp, image/gif".into(),
        )),
    }
}

fn validate_avatar_mime_type(mime_type: &str) -> Result<(), AppError> {
    match mime_type {
        "image/jpeg" | "image/png" | "image/webp" => Ok(()),
        _ => Err(AppError::BadRequest(
            "Unsupported avatar MIME type. Allowed: image/jpeg, image/png, image/webp".into(),
        )),
    }
}

fn extension_for_mime(mime_type: &str) -> &'static str {
    match mime_type {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "bin",
    }
}

fn sniff_mime_type(bytes: &[u8]) -> Result<&'static str, AppError> {
    if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        return Ok("image/jpeg");
    }

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
        "Unsupported image payload. Allowed: JPEG, PNG, WEBP, GIF".into(),
    ))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn encode_webp(image: &image::DynamicImage) -> Result<Vec<u8>, AppError> {
    let mut cursor = Cursor::new(Vec::<u8>::new());
    image
        .write_to(&mut cursor, image::ImageFormat::WebP)
        .map_err(|error| {
            AppError::Internal(format!("Failed to encode WebP derivative: {error}"))
        })?;
    Ok(cursor.into_inner())
}

fn crop_square(image: &image::DynamicImage) -> image::DynamicImage {
    let (width, height) = image.dimensions();
    let size = width.min(height);
    let offset_x = (width - size) / 2;
    let offset_y = (height - size) / 2;
    image.crop_imm(offset_x, offset_y, size, size)
}
