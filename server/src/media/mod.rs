pub mod consumer;
pub mod producer;
pub mod router;
pub mod transport;

use mediasoup::prelude::*;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

pub struct MediaService {
    workers: Vec<Worker>,
    routers: Arc<Mutex<HashMap<Uuid, Router>>>,
}

impl MediaService {
    pub async fn new(worker_count: usize) -> Self {
        let mut workers = Vec::new();

        let worker_manager = WorkerManager::new();

        for _ in 0..worker_count {
            let worker = worker_manager
                .create_worker(WorkerSettings::default())
                .await
                .expect("Failed to create mediasoup worker");
            workers.push(worker);
        }

        MediaService {
            workers,
            routers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn get_or_create_router(&self, channel_id: Uuid) -> Router {
        let mut routers = self.routers.lock().await;

        if let Some(router) = routers.get(&channel_id) {
            return router.clone();
        }

        let worker = &self.workers[channel_id.as_bytes()[0] as usize % self.workers.len()];
        let media_codecs = router::media_codecs();

        let router = worker
            .create_router(RouterOptions::new(media_codecs))
            .await
            .expect("Failed to create router");

        routers.insert(channel_id, router.clone());
        router
    }
}
