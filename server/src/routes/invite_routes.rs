use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::{extract_claims, generate_invite_code};
use crate::errors::AppError;
use crate::AppState;

#[derive(Deserialize)]
pub struct CreateInviteRequest {
    #[serde(default = "default_single_use")]
    pub single_use: bool,
    pub max_uses: Option<i32>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

fn default_single_use() -> bool {
    true
}

#[derive(Serialize, sqlx::FromRow)]
pub struct InviteResponse {
    pub id: Uuid,
    pub code: String,
    pub created_by: Uuid,
    pub creator_username: String,
    pub single_use: bool,
    pub used_count: i32,
    pub max_uses: Option<i32>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
    pub revoked: bool,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/invites", get(list_invites).post(create_invite))
        .route("/invites/{invite_id}", axum::routing::delete(revoke_invite))
}

fn require_admin_or_operator(claims: &crate::auth::Claims) -> Result<(), AppError> {
    if claims.role != "operator" && claims.role != "admin" {
        return Err(AppError::Unauthorized(
            "Only operators and admins can manage invites".into(),
        ));
    }
    Ok(())
}

async fn create_invite(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<CreateInviteRequest>,
) -> Result<Json<InviteResponse>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;
    require_admin_or_operator(&claims)?;
    let user_id = claims.user_id;

    let code = generate_invite_code();
    let invite_id = Uuid::new_v4();

    let now = chrono::Utc::now();
    let expires_at = body.expires_at;
    if let Some(expires_at_value) = expires_at.as_ref() {
        if expires_at_value <= &now {
            return Err(AppError::BadRequest(
                "Invite expiration must be in the future".into(),
            ));
        }
    }

    let max_uses = if body.single_use {
        None
    } else {
        let value = body.max_uses.ok_or_else(|| {
            AppError::BadRequest("Max uses is required for multi-use invites".into())
        })?;

        if value < 1 {
            return Err(AppError::BadRequest("Max uses must be at least 1".into()));
        }

        Some(value)
    };

    sqlx::query(
        "INSERT INTO invites (id, code, created_by, single_use, max_uses, expires_at) VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(invite_id)
    .bind(&code)
    .bind(user_id)
    .bind(body.single_use)
    .bind(max_uses)
    .bind(expires_at)
    .execute(&state.db)
    .await?;

    Ok(Json(InviteResponse {
        id: invite_id,
        code,
        created_by: user_id,
        creator_username: claims.username,
        single_use: body.single_use,
        used_count: 0,
        max_uses,
        created_at: now,
        expires_at,
        revoked: false,
    }))
}

async fn list_invites(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Vec<InviteResponse>>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;
    require_admin_or_operator(&claims)?;

    let invites: Vec<InviteResponse> = sqlx::query_as(
        "SELECT i.id, i.code, i.created_by, u.username AS creator_username, i.single_use, i.used_count, i.max_uses, i.created_at, i.expires_at, i.revoked
         FROM invites i
         JOIN users u ON u.id = i.created_by
         ORDER BY i.created_at DESC",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(invites))
}

async fn revoke_invite(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(invite_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;
    require_admin_or_operator(&claims)?;

    let result = sqlx::query("UPDATE invites SET revoked = true WHERE id = $1 AND revoked = false")
        .bind(invite_id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(
            "Invite not found or already revoked".into(),
        ));
    }

    Ok(Json(serde_json::json!({ "revoked": true })))
}
