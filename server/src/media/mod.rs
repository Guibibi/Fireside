pub mod consumer;
pub mod producer;
pub mod router;
pub mod transport;

use mediasoup::prelude::*;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

pub struct MediaService {
    workers: Vec<Worker>,
    routers: Arc<Mutex<HashMap<Uuid, Router>>>,
    connection_media: Arc<Mutex<HashMap<Uuid, transport::ConnectionMediaState>>>,
    webrtc_listen_ip: IpAddr,
    announced_ip: Option<String>,
    native_rtp_listen_ip: IpAddr,
    native_rtp_announced_ip: Option<IpAddr>,
}

impl MediaService {
    pub async fn new(
        worker_count: usize,
        webrtc_listen_ip: String,
        announced_ip: Option<String>,
        native_rtp_listen_ip: String,
        native_rtp_announced_ip: Option<String>,
    ) -> Self {
        let mut workers = Vec::new();

        let worker_manager = WorkerManager::new();

        for _ in 0..worker_count {
            let worker = worker_manager
                .create_worker(WorkerSettings::default())
                .await
                .expect("Failed to create mediasoup worker");
            workers.push(worker);
        }

        let parsed_webrtc_listen_ip = IpAddr::from_str(&webrtc_listen_ip).unwrap_or_else(|error| {
            tracing::warn!(
                "Invalid WEBRTC_LISTEN_IP '{}': {}. Falling back to 127.0.0.1",
                webrtc_listen_ip,
                error
            );
            IpAddr::V4(Ipv4Addr::LOCALHOST)
        });

        let parsed_native_rtp_listen_ip =
            IpAddr::from_str(&native_rtp_listen_ip).unwrap_or_else(|error| {
                tracing::warn!(
                    "Invalid NATIVE_RTP_LISTEN_IP '{}': {}. Falling back to 127.0.0.1",
                    native_rtp_listen_ip,
                    error
                );
                IpAddr::V4(Ipv4Addr::LOCALHOST)
            });

        let parsed_native_rtp_announced_ip = native_rtp_announced_ip.and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return None;
            }

            match IpAddr::from_str(trimmed) {
                Ok(ip) => Some(ip),
                Err(error) => {
                    tracing::warn!(
                        "Invalid NATIVE_RTP_ANNOUNCED_IP '{}': {}. Falling back to listen IP",
                        trimmed,
                        error
                    );
                    None
                }
            }
        });

        MediaService {
            workers,
            routers: Arc::new(Mutex::new(HashMap::new())),
            connection_media: Arc::new(Mutex::new(HashMap::new())),
            webrtc_listen_ip: parsed_webrtc_listen_ip,
            announced_ip,
            native_rtp_listen_ip: parsed_native_rtp_listen_ip,
            native_rtp_announced_ip: parsed_native_rtp_announced_ip,
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

    pub(super) fn webrtc_listen_info(&self) -> ListenInfo {
        ListenInfo {
            protocol: Protocol::Udp,
            ip: self.webrtc_listen_ip,
            announced_address: self.announced_ip.clone(),
            expose_internal_ip: false,
            port: None,
            port_range: None,
            flags: None,
            send_buffer_size: None,
            recv_buffer_size: None,
        }
    }

    pub(super) fn connection_media(
        &self,
    ) -> Arc<Mutex<HashMap<Uuid, transport::ConnectionMediaState>>> {
        self.connection_media.clone()
    }

    pub(super) fn native_rtp_listen_info(&self) -> ListenInfo {
        ListenInfo {
            protocol: Protocol::Udp,
            ip: self.native_rtp_listen_ip,
            announced_address: self.native_rtp_announced_ip.map(|ip| ip.to_string()),
            expose_internal_ip: false,
            port: None,
            port_range: None,
            flags: None,
            send_buffer_size: None,
            recv_buffer_size: None,
        }
    }

    pub(super) fn native_rtp_target_for_port(&self, local_port: u16) -> String {
        let target_ip = if let Some(announced_ip) = self.native_rtp_announced_ip {
            announced_ip
        } else if self.native_rtp_listen_ip.is_unspecified() {
            IpAddr::V4(Ipv4Addr::LOCALHOST)
        } else {
            self.native_rtp_listen_ip
        };

        std::net::SocketAddr::new(target_ip, local_port).to_string()
    }
}
