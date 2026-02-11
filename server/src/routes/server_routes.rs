use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::{validate_token, Claims};
use crate::errors::AppError;
use crate::models::{Channel, Server, ServerMember};
use crate::AppState;

#[derive(Deserialize)]
pub struct CreateServerRequest {
    pub name: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/servers", post(create_server).get(list_my_servers))
        .route("/servers/{server_id}", get(get_server).delete(delete_server))
        .route("/servers/{server_id}/join", post(join_server))
        .route("/servers/{server_id}/members", get(list_members))
        .route("/servers/{server_id}/channels", get(list_channels))
}

fn extract_claims(
    headers: &axum::http::HeaderMap,
    secret: &str,
) -> Result<Claims, AppError> {
    let header = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::Unauthorized("Missing authorization header".into()))?;

    let token = header
        .strip_prefix("Bearer ")
        .ok_or_else(|| AppError::Unauthorized("Invalid authorization format".into()))?;

    validate_token(token, secret).map_err(|_| AppError::Unauthorized("Invalid token".into()))
}

async fn create_server(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<CreateServerRequest>,
) -> Result<Json<Server>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;
    let server_id = Uuid::new_v4();

    let server: Server = sqlx::query_as(
        "INSERT INTO servers (id, name, owner_id) VALUES ($1, $2, $3) RETURNING *",
    )
    .bind(server_id)
    .bind(&body.name)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    // Auto-join owner
    sqlx::query("INSERT INTO server_members (server_id, user_id) VALUES ($1, $2)")
        .bind(server_id)
        .bind(claims.sub)
        .execute(&state.db)
        .await?;

    // Create default #general text channel
    sqlx::query(
        "INSERT INTO channels (id, server_id, name, kind, position) VALUES ($1, $2, 'general', 'text', 0)",
    )
    .bind(Uuid::new_v4())
    .bind(server_id)
    .execute(&state.db)
    .await?;

    Ok(Json(server))
}

async fn list_my_servers(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Vec<Server>>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;

    let servers: Vec<Server> = sqlx::query_as(
        "SELECT s.* FROM servers s
         INNER JOIN server_members sm ON s.id = sm.server_id
         WHERE sm.user_id = $1
         ORDER BY s.created_at",
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(servers))
}

async fn get_server(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Server>, AppError> {
    let _claims = extract_claims(&headers, &state.config.jwt.secret)?;

    let server: Server = sqlx::query_as("SELECT * FROM servers WHERE id = $1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Server not found".into()))?;

    Ok(Json(server))
}

async fn delete_server(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(server_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;

    let server: Server = sqlx::query_as("SELECT * FROM servers WHERE id = $1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Server not found".into()))?;

    if server.owner_id != claims.sub {
        return Err(AppError::Unauthorized("Only the owner can delete a server".into()));
    }

    sqlx::query("DELETE FROM servers WHERE id = $1")
        .bind(server_id)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "deleted": true })))
}

async fn join_server(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(server_id): Path<Uuid>,
) -> Result<Json<ServerMember>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;

    let exists: Option<(Uuid,)> = sqlx::query_as("SELECT server_id FROM server_members WHERE server_id = $1 AND user_id = $2")
        .bind(server_id)
        .bind(claims.sub)
        .fetch_optional(&state.db)
        .await?;

    if exists.is_some() {
        return Err(AppError::Conflict("Already a member".into()));
    }

    let member: ServerMember = sqlx::query_as(
        "INSERT INTO server_members (server_id, user_id) VALUES ($1, $2) RETURNING *",
    )
    .bind(server_id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(member))
}

async fn list_members(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<ServerMember>>, AppError> {
    let _claims = extract_claims(&headers, &state.config.jwt.secret)?;

    let members: Vec<ServerMember> =
        sqlx::query_as("SELECT * FROM server_members WHERE server_id = $1 ORDER BY joined_at")
            .bind(server_id)
            .fetch_all(&state.db)
            .await?;

    Ok(Json(members))
}

async fn list_channels(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<Channel>>, AppError> {
    let _claims = extract_claims(&headers, &state.config.jwt.secret)?;

    let channels: Vec<Channel> =
        sqlx::query_as("SELECT * FROM channels WHERE server_id = $1 ORDER BY position")
            .bind(server_id)
            .fetch_all(&state.db)
            .await?;

    Ok(Json(channels))
}
