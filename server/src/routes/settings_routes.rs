use axum::{extract::State, routing::get, Json, Router};
use serde::Serialize;

use crate::auth::{extract_claims, require_operator_or_admin};
use crate::errors::AppError;
use crate::AppState;

#[derive(Serialize)]
struct AdminSettingsAccessResponse {
    can_manage_invites: bool,
    can_manage_emojis: bool,
}

pub fn router() -> Router<AppState> {
    Router::new().route("/settings/admin", get(get_admin_settings_access))
}

async fn get_admin_settings_access(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<AdminSettingsAccessResponse>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;
    require_operator_or_admin(&claims, "access admin settings")?;

    Ok(Json(AdminSettingsAccessResponse {
        can_manage_invites: true,
        can_manage_emojis: true,
    }))
}
