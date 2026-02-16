mod auth;
mod config;
mod errors;
mod media;
mod message_attachments;
mod models;
mod routes;
mod storage;
mod uploads;
mod ws;

use axum::Router;
use config::AppConfig;
use sqlx::postgres::PgPoolOptions;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{mpsc, RwLock};
use tokio::time::{interval, Duration};
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct MediaSignalRateState {
    pub window_started_at: Instant,
    pub events_in_window: u32,
}

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub config: Arc<AppConfig>,
    pub media: Arc<media::MediaService>,
    pub storage: Arc<dyn storage::StorageBackend>,
    pub uploads: Arc<uploads::UploadService>,
    pub active_usernames: Arc<RwLock<HashSet<String>>>,
    pub ws_connections: Arc<RwLock<HashMap<Uuid, mpsc::UnboundedSender<String>>>>,
    pub connection_usernames: Arc<RwLock<HashMap<Uuid, String>>>,
    pub user_presence_by_username: Arc<RwLock<HashMap<String, String>>>,
    pub channel_subscriptions: Arc<RwLock<HashMap<Uuid, Uuid>>>,
    pub voice_members_by_connection: Arc<RwLock<HashMap<Uuid, Uuid>>>,
    pub voice_members_by_channel: Arc<RwLock<HashMap<Uuid, HashSet<String>>>>,
    pub media_signal_rate_by_connection: Arc<RwLock<HashMap<Uuid, MediaSignalRateState>>>,
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "yankcord_server=debug,tower_http=debug".parse().unwrap()),
        )
        .init();

    let config = AppConfig::load();
    let config = Arc::new(config);

    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(&config.database.url)
        .await
        .expect("Failed to connect to database");

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Failed to run migrations");

    seed_default_channel(&pool)
        .await
        .expect("Failed to seed default channel");

    let media_service = media::MediaService::new(
        config.media.worker_count,
        config.media.webrtc_listen_ip.clone(),
        config.media.announced_ip.clone(),
        config.media.native_rtp_listen_ip.clone(),
        config.media.native_rtp_announced_ip.clone(),
    )
    .await;

    let storage_backend = storage::create_storage_backend(&config.storage)
        .await
        .expect("Failed to initialize storage backend");

    let upload_service = uploads::UploadService::new(
        pool.clone(),
        storage_backend.clone(),
        config.storage.max_upload_bytes,
    );

    let state = AppState {
        db: pool,
        config: config.clone(),
        media: Arc::new(media_service),
        storage: storage_backend,
        uploads: Arc::new(upload_service),
        active_usernames: Arc::new(RwLock::new(HashSet::new())),
        ws_connections: Arc::new(RwLock::new(HashMap::new())),
        connection_usernames: Arc::new(RwLock::new(HashMap::new())),
        user_presence_by_username: Arc::new(RwLock::new(HashMap::new())),
        channel_subscriptions: Arc::new(RwLock::new(HashMap::new())),
        voice_members_by_connection: Arc::new(RwLock::new(HashMap::new())),
        voice_members_by_channel: Arc::new(RwLock::new(HashMap::new())),
        media_signal_rate_by_connection: Arc::new(RwLock::new(HashMap::new())),
    };

    start_derivative_cleanup_job(state.clone());

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .nest("/api", routes::auth_routes::router())
        .nest("/api", routes::channel_routes::router())
        .nest(
            "/api",
            routes::media_routes::router(config.storage.max_upload_bytes),
        )
        .nest("/api", routes::embed_routes::router())
        .nest("/api", routes::emoji_routes::router())
        .nest("/api", routes::invite_routes::router())
        .nest("/api", routes::reaction_routes::router())
        .nest("/api", routes::user_routes::router())
        .route("/ws", axum::routing::get(ws::ws_upgrade))
        .layer(cors)
        .with_state(state);

    let addr = format!("{}:{}", config.server.host, config.server.port);
    let http_url = format!("http://{addr}");
    let ws_url = format!("ws://{addr}/ws");
    tracing::info!("Yankcord server started: API {http_url}/api | WebSocket {ws_url}");

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind");

    axum::serve(listener, app).await.expect("Server error");
}

fn start_derivative_cleanup_job(state: AppState) {
    tokio::spawn(async move {
        let mut ticker = interval(Duration::from_secs(
            state.config.storage.cleanup_interval_seconds,
        ));

        loop {
            ticker.tick().await;
            match state
                .uploads
                .cleanup_derivatives(state.config.storage.failed_retention_hours)
                .await
            {
                Ok(deleted) if deleted > 0 => {
                    tracing::info!(deleted, "Media derivative cleanup removed stale rows");
                }
                Ok(_) => {}
                Err(error) => {
                    tracing::warn!(error = ?error, "Media derivative cleanup iteration failed");
                }
            }

            match state
                .uploads
                .cleanup_orphan_message_uploads(state.config.storage.failed_retention_hours)
                .await
            {
                Ok(deleted) if deleted > 0 => {
                    tracing::info!(
                        deleted,
                        "Orphan message upload cleanup removed stale media families"
                    );
                }
                Ok(_) => {}
                Err(error) => {
                    tracing::warn!(error = ?error, "Orphan message upload cleanup iteration failed");
                }
            }
        }
    });
}

async fn seed_default_channel(pool: &sqlx::PgPool) -> Result<(), sqlx::Error> {
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM channels")
        .fetch_one(pool)
        .await?;

    if count == 0 {
        sqlx::query(
            "INSERT INTO channels (id, name, kind, position) VALUES ($1, $2, $3::channel_kind, $4)",
        )
        .bind(Uuid::new_v4())
        .bind("general")
        .bind("text")
        .bind(0)
        .execute(pool)
        .await?;
    }

    Ok(())
}
