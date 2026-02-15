use async_trait::async_trait;

use crate::config::StorageConfig;
use crate::errors::AppError;

use super::StorageBackend;

#[derive(Debug, Clone)]
pub struct S3Storage {
    endpoint: Option<String>,
    region: Option<String>,
    bucket: Option<String>,
    force_path_style: bool,
}

impl S3Storage {
    pub fn new(config: StorageConfig) -> Self {
        Self {
            endpoint: config.s3.endpoint,
            region: config.s3.region,
            bucket: config.s3.bucket,
            force_path_style: config.s3.force_path_style,
        }
    }

    fn not_implemented_error(&self) -> AppError {
        AppError::Internal(format!(
            "S3 storage backend is scaffolded but not implemented (endpoint={:?}, region={:?}, bucket={:?}, force_path_style={})",
            self.endpoint, self.region, self.bucket, self.force_path_style,
        ))
    }
}

#[async_trait]
impl StorageBackend for S3Storage {
    async fn put(&self, _key: &str, _bytes: Vec<u8>, _content_type: &str) -> Result<(), AppError> {
        Err(self.not_implemented_error())
    }

    async fn read(&self, _key: &str) -> Result<Vec<u8>, AppError> {
        Err(self.not_implemented_error())
    }

    async fn delete(&self, _key: &str) -> Result<(), AppError> {
        Err(self.not_implemented_error())
    }
}
