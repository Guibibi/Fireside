use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize, Clone)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub jwt: JwtConfig,
    pub media: MediaConfig,
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
}

impl AppConfig {
    pub fn load() -> Self {
        let config_path = std::env::var("CONFIG_PATH").unwrap_or_else(|_| "config.toml".into());

        if Path::new(&config_path).exists() {
            let contents = std::fs::read_to_string(&config_path)
                .expect("Failed to read config file");
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
                    url: std::env::var("DATABASE_URL")
                        .expect("DATABASE_URL must be set"),
                },
                jwt: JwtConfig {
                    secret: std::env::var("JWT_SECRET")
                        .expect("JWT_SECRET must be set"),
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
                },
            }
        }
    }
}
