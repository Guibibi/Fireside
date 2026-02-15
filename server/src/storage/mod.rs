mod local;
mod s3;

use async_trait::async_trait;
use std::sync::Arc;

use crate::config::StorageConfig;
use crate::errors::AppError;

pub use local::LocalStorage;
pub use s3::S3Storage;

#[async_trait]
pub trait StorageBackend: Send + Sync {
    async fn put(&self, key: &str, bytes: Vec<u8>, content_type: &str) -> Result<(), AppError>;
    async fn read(&self, key: &str) -> Result<Vec<u8>, AppError>;
    async fn delete(&self, key: &str) -> Result<(), AppError>;
}

pub async fn create_storage_backend(
    config: &StorageConfig,
) -> Result<Arc<dyn StorageBackend>, AppError> {
    match config.backend.to_ascii_lowercase().as_str() {
        "local" => {
            let backend = LocalStorage::new(config.local_root.clone()).await?;
            Ok(Arc::new(backend))
        }
        "s3" => Ok(Arc::new(S3Storage::new(config.clone()))),
        other => Err(AppError::BadRequest(format!(
            "Unsupported STORAGE_BACKEND '{other}'. Use 'local' or 's3'",
        ))),
    }
}
