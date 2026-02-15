use async_trait::async_trait;
use std::path::{Path, PathBuf};

use crate::errors::AppError;

use super::StorageBackend;

#[derive(Debug, Clone)]
pub struct LocalStorage {
    root: PathBuf,
}

impl LocalStorage {
    pub async fn new(root: String) -> Result<Self, AppError> {
        let root_path = PathBuf::from(root);
        tokio::fs::create_dir_all(&root_path)
            .await
            .map_err(|error| {
                AppError::Internal(format!("Failed to create storage root: {error}"))
            })?;

        Ok(Self { root: root_path })
    }

    fn resolve_path(&self, key: &str) -> Result<PathBuf, AppError> {
        if key.is_empty() {
            return Err(AppError::BadRequest("Storage key cannot be empty".into()));
        }

        let candidate = self.root.join(key);
        if !is_within_root(&self.root, &candidate) {
            return Err(AppError::BadRequest("Invalid storage key path".into()));
        }

        Ok(candidate)
    }
}

fn is_within_root(root: &Path, candidate: &Path) -> bool {
    let mut normalized = PathBuf::new();

    for component in candidate.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return false;
        }
        normalized.push(component);
    }

    normalized.starts_with(root)
}

#[async_trait]
impl StorageBackend for LocalStorage {
    async fn put(&self, key: &str, bytes: Vec<u8>, _content_type: &str) -> Result<(), AppError> {
        let path = self.resolve_path(key)?;

        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|error| {
                AppError::Internal(format!("Failed to create storage directory: {error}"))
            })?;
        }

        tokio::fs::write(&path, bytes)
            .await
            .map_err(|error| AppError::Internal(format!("Failed to write storage object: {error}")))
    }

    async fn read(&self, key: &str) -> Result<Vec<u8>, AppError> {
        let path = self.resolve_path(key)?;
        tokio::fs::read(&path)
            .await
            .map_err(|error| AppError::Internal(format!("Failed to read storage object: {error}")))
    }

    async fn delete(&self, key: &str) -> Result<(), AppError> {
        let path = self.resolve_path(key)?;
        match tokio::fs::remove_file(&path).await {
            Ok(_) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(AppError::Internal(format!(
                "Failed to delete storage object: {error}",
            ))),
        }
    }
}
