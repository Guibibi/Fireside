use axum::{extract::State, routing::get, Json, Router};
use serde::Serialize;

use crate::auth::{extract_claims, is_operator_or_admin_role};
use crate::errors::AppError;
use crate::AppState;

#[derive(Serialize)]
struct AdminSettingsAccessResponse {
    can_manage_invites: bool,
}

pub fn router() -> Router<AppState> {
    Router::new().route("/settings/admin", get(admin_access))
}

async fn admin_access(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<AdminSettingsAccessResponse>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;

    if !is_operator_or_admin_role(&claims.role) {
        return Err(AppError::Unauthorized(
            "Only operators and admins can access admin settings".into(),
        ));
    }

    Ok(Json(AdminSettingsAccessResponse {
        can_manage_invites: true,
    }))
}
