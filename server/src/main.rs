mod auth;
mod config;
mod errors;
mod media;
mod models;
mod routes;
mod ws;

use axum::Router;
use config::AppConfig;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub config: Arc<AppConfig>,
    pub media: Arc<media::MediaService>,
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

    let media_service = media::MediaService::new(config.media.worker_count).await;

    let state = AppState {
        db: pool,
        config: config.clone(),
        media: Arc::new(media_service),
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .nest("/api", routes::auth_routes::router())
        .nest("/api", routes::server_routes::router())
        .nest("/api", routes::channel_routes::router())
        .route("/ws", axum::routing::get(ws::ws_upgrade))
        .layer(cors)
        .with_state(state);

    let addr = format!("{}:{}", config.server.host, config.server.port);
    tracing::info!("Listening on {addr}");

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind");

    axum::serve(listener, app).await.expect("Server error");
}
