use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize, Clone)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub jwt: JwtConfig,
    pub media: MediaConfig,
    #[serde(default)]
    pub storage: StorageConfig,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Deserialize, Clone)]
pub struct DatabaseConfig {
    pub url: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct JwtConfig {
    pub secret: String,
    pub expiration_hours: u64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct MediaConfig {
    pub worker_count: usize,
    pub webrtc_listen_ip: String,
    pub announced_ip: Option<String>,
    #[serde(default = "default_native_rtp_listen_ip")]
    pub native_rtp_listen_ip: String,
    #[serde(default)]
    pub native_rtp_announced_ip: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct StorageConfig {
    #[serde(default = "default_storage_backend")]
    pub backend: String,
    #[serde(default = "default_storage_local_root")]
    pub local_root: String,
    #[serde(default = "default_media_max_upload_bytes")]
    pub max_upload_bytes: usize,
    #[serde(default = "default_media_cleanup_interval_seconds")]
    pub cleanup_interval_seconds: u64,
    #[serde(default = "default_media_failed_retention_hours")]
    pub failed_retention_hours: i64,
    #[serde(default)]
    pub s3: S3Config,
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct S3Config {
    pub endpoint: Option<String>,
    pub region: Option<String>,
    pub bucket: Option<String>,
    pub access_key_id: Option<String>,
    pub secret_access_key: Option<String>,
    #[serde(default)]
    pub force_path_style: bool,
}

fn default_native_rtp_listen_ip() -> String {
    "127.0.0.1".to_string()
}

fn default_storage_backend() -> String {
    "local".to_string()
}

fn default_storage_local_root() -> String {
    "data/media".to_string()
}

fn default_media_max_upload_bytes() -> usize {
    10 * 1024 * 1024
}

fn default_media_cleanup_interval_seconds() -> u64 {
    900
}

fn default_media_failed_retention_hours() -> i64 {
    24
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            backend: default_storage_backend(),
            local_root: default_storage_local_root(),
            max_upload_bytes: default_media_max_upload_bytes(),
            cleanup_interval_seconds: default_media_cleanup_interval_seconds(),
            failed_retention_hours: default_media_failed_retention_hours(),
            s3: S3Config::default(),
        }
    }
}

impl AppConfig {
    pub fn load() -> Self {
        let config_path = std::env::var("CONFIG_PATH").unwrap_or_else(|_| "config.toml".into());

        if Path::new(&config_path).exists() {
            let contents =
                std::fs::read_to_string(&config_path).expect("Failed to read config file");
            toml::from_str(&contents).expect("Failed to parse config file")
        } else {
            // Fall back to environment variables
            AppConfig {
                server: ServerConfig {
                    host: std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into()),
                    port: std::env::var("PORT")
                        .unwrap_or_else(|_| "3000".into())
                        .parse()
                        .expect("PORT must be a number"),
                },
                database: DatabaseConfig {
                    url: std::env::var("DATABASE_URL").expect("DATABASE_URL must be set"),
                },
                jwt: JwtConfig {
                    secret: std::env::var("JWT_SECRET").expect("JWT_SECRET must be set"),
                    expiration_hours: std::env::var("JWT_EXPIRATION_HOURS")
                        .unwrap_or_else(|_| "24".into())
                        .parse()
                        .expect("JWT_EXPIRATION_HOURS must be a number"),
                },
                media: MediaConfig {
                    worker_count: std::env::var("MEDIA_WORKER_COUNT")
                        .unwrap_or_else(|_| "2".into())
                        .parse()
                        .expect("MEDIA_WORKER_COUNT must be a number"),
                    webrtc_listen_ip: std::env::var("WEBRTC_LISTEN_IP")
                        .unwrap_or_else(|_| "0.0.0.0".into()),
                    announced_ip: std::env::var("WEBRTC_ANNOUNCED_IP").ok(),
                    native_rtp_listen_ip: std::env::var("NATIVE_RTP_LISTEN_IP")
                        .or_else(|_| std::env::var("WEBRTC_LISTEN_IP"))
                        .unwrap_or_else(|_| default_native_rtp_listen_ip()),
                    native_rtp_announced_ip: std::env::var("NATIVE_RTP_ANNOUNCED_IP")
                        .ok()
                        .or_else(|| std::env::var("WEBRTC_ANNOUNCED_IP").ok()),
                },
                storage: StorageConfig {
                    backend: std::env::var("STORAGE_BACKEND")
                        .unwrap_or_else(|_| default_storage_backend()),
                    local_root: std::env::var("STORAGE_LOCAL_ROOT")
                        .unwrap_or_else(|_| default_storage_local_root()),
                    max_upload_bytes: std::env::var("MEDIA_MAX_UPLOAD_BYTES")
                        .unwrap_or_else(|_| default_media_max_upload_bytes().to_string())
                        .parse()
                        .expect("MEDIA_MAX_UPLOAD_BYTES must be a number"),
                    cleanup_interval_seconds: std::env::var("MEDIA_CLEANUP_INTERVAL_SECONDS")
                        .unwrap_or_else(|_| default_media_cleanup_interval_seconds().to_string())
                        .parse()
                        .expect("MEDIA_CLEANUP_INTERVAL_SECONDS must be a number"),
                    failed_retention_hours: std::env::var("MEDIA_FAILED_RETENTION_HOURS")
                        .unwrap_or_else(|_| default_media_failed_retention_hours().to_string())
                        .parse()
                        .expect("MEDIA_FAILED_RETENTION_HOURS must be a number"),
                    s3: S3Config {
                        endpoint: std::env::var("S3_ENDPOINT").ok(),
                        region: std::env::var("S3_REGION").ok(),
                        bucket: std::env::var("S3_BUCKET").ok(),
                        access_key_id: std::env::var("S3_ACCESS_KEY_ID").ok(),
                        secret_access_key: std::env::var("S3_SECRET_ACCESS_KEY").ok(),
                        force_path_style: std::env::var("S3_FORCE_PATH_STYLE")
                            .ok()
                            .map(|value| {
                                matches!(
                                    value.to_ascii_lowercase().as_str(),
                                    "1" | "true" | "yes" | "on"
                                )
                            })
                            .unwrap_or(false),
                    },
                },
            }
        }
    }
}
