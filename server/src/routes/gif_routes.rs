use axum::{extract::Query, extract::State, routing::get, Json, Router};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Duration;
use std::time::Instant;
use tokio::sync::RwLock;

use crate::auth::extract_claims;
use crate::errors::AppError;
use crate::AppState;

const TENOR_API_BASE: &str = "https://tenor.googleapis.com/v2";
const MAX_RESULTS: usize = 50;
const GIF_SEARCH_CACHE_TTL: Duration = Duration::from_secs(60);
const GIF_SEARCH_CACHE_MAX_ENTRIES: usize = 200;

#[derive(Clone)]
struct CachedGifSearch {
    inserted_at: Instant,
    response: GifSearchResponse,
}

static GIF_SEARCH_CACHE: LazyLock<RwLock<HashMap<String, CachedGifSearch>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

#[derive(Deserialize)]
pub struct GifSearchQuery {
    pub q: String,
    #[serde(default = "default_limit")]
    pub limit: usize,
    #[serde(default)]
    pub cursor: Option<String>,
}

fn default_limit() -> usize {
    20
}

#[derive(Clone, Serialize)]
pub struct GifSearchResponse {
    pub results: Vec<GifResult>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct GifResult {
    pub id: String,
    pub url: String,
    pub preview_url: String,
    pub width: i32,
    pub height: i32,
    pub description: Option<String>,
}

pub fn router() -> Router<AppState> {
    Router::new().route("/gifs/search", get(search_gifs))
}

async fn search_gifs(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Query(query): Query<GifSearchQuery>,
) -> Result<Json<GifSearchResponse>, AppError> {
    let _claims = extract_claims(&headers, &state.config.jwt.secret)?;

    let tenor_api_key = state
        .config
        .integrations
        .tenor_api_key
        .as_ref()
        .ok_or_else(|| AppError::Internal("GIF search is not configured".into()))?;

    let limit = query.limit.clamp(1, MAX_RESULTS);
    let cache_key = format!(
        "{}|{}|{}",
        query.q.trim().to_lowercase(),
        limit,
        query.cursor.as_deref().unwrap_or_default(),
    );

    if let Some(cached) = read_cached_search(&cache_key).await {
        return Ok(Json(cached));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| AppError::Internal(format!("Failed to create HTTP client: {error}")))?;

    let mut request = client.get(format!("{}/search", TENOR_API_BASE)).query(&[
        ("key", tenor_api_key.as_str()),
        ("q", query.q.as_str()),
        ("limit", &limit.to_string()),
        ("media_filter", "gif,tinygif"),
        ("contentfilter", "medium"),
    ]);

    if let Some(cursor) = query.cursor {
        request = request.query(&[("pos", cursor.as_str())]);
    }

    let response = request
        .send()
        .await
        .map_err(|error| AppError::Internal(format!("Failed to fetch from Tenor: {error}")))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".into());
        tracing::error!(status = %status, body = %body, "Tenor API error");
        return Err(AppError::Internal("GIF search service unavailable".into()));
    }

    let tenor_response: serde_json::Value = response
        .json()
        .await
        .map_err(|error| AppError::Internal(format!("Failed to parse Tenor response: {error}")))?;

    let results = parse_tenor_results(&tenor_response)?;
    let next_cursor = tenor_response
        .get("next")
        .and_then(|v| v.as_str())
        .map(String::from);

    let response = GifSearchResponse {
        results,
        next_cursor,
    };

    cache_search_result(cache_key, response.clone()).await;

    Ok(Json(response))
}

async fn read_cached_search(cache_key: &str) -> Option<GifSearchResponse> {
    let cache = GIF_SEARCH_CACHE.read().await;
    let cached = cache.get(cache_key)?;
    if cached.inserted_at.elapsed() > GIF_SEARCH_CACHE_TTL {
        return None;
    }

    Some(cached.response.clone())
}

async fn cache_search_result(cache_key: String, response: GifSearchResponse) {
    let mut cache = GIF_SEARCH_CACHE.write().await;
    cache.insert(
        cache_key,
        CachedGifSearch {
            inserted_at: Instant::now(),
            response,
        },
    );

    cache.retain(|_, cached| cached.inserted_at.elapsed() <= GIF_SEARCH_CACHE_TTL);

    if cache.len() <= GIF_SEARCH_CACHE_MAX_ENTRIES {
        return;
    }

    let mut keys_by_age: Vec<(String, Instant)> = cache
        .iter()
        .map(|(key, value)| (key.clone(), value.inserted_at))
        .collect();
    keys_by_age.sort_by_key(|(_, inserted_at)| *inserted_at);

    let remove_count = cache.len().saturating_sub(GIF_SEARCH_CACHE_MAX_ENTRIES);
    for (key, _) in keys_by_age.into_iter().take(remove_count) {
        cache.remove(&key);
    }
}

fn parse_tenor_results(response: &serde_json::Value) -> Result<Vec<GifResult>, AppError> {
    let results = response
        .get("results")
        .and_then(|v| v.as_array())
        .ok_or_else(|| AppError::Internal("Invalid Tenor response format".into()))?;

    let mut gifs = Vec::new();

    for result in results {
        let id = result
            .get("id")
            .and_then(|v| v.as_str())
            .map(String::from)
            .ok_or_else(|| AppError::Internal("Missing GIF ID in Tenor response".into()))?;

        let media_formats = result
            .get("media_formats")
            .and_then(|v| v.as_object())
            .ok_or_else(|| AppError::Internal("Missing media formats in Tenor response".into()))?;

        let gif_format = media_formats
            .get("gif")
            .and_then(|v| v.as_object())
            .ok_or_else(|| AppError::Internal("Missing GIF format in Tenor response".into()))?;

        let url = gif_format
            .get("url")
            .and_then(|v| v.as_str())
            .map(String::from)
            .ok_or_else(|| AppError::Internal("Missing GIF URL in Tenor response".into()))?;

        let tinygif_format = media_formats.get("tinygif").and_then(|v| v.as_object());

        let preview_url = tinygif_format
            .and_then(|f| f.get("url"))
            .and_then(|v| v.as_str())
            .map(String::from)
            .unwrap_or_else(|| url.clone());

        let width = gif_format
            .get("dims")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|v| v.as_i64())
            .map(|v| v as i32)
            .unwrap_or(0);

        let height = gif_format
            .get("dims")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.get(1))
            .and_then(|v| v.as_i64())
            .map(|v| v as i32)
            .unwrap_or(0);

        let description = result
            .get("content_description")
            .and_then(|v| v.as_str())
            .map(String::from);

        gifs.push(GifResult {
            id,
            url,
            preview_url,
            width,
            height,
            description,
        });
    }

    Ok(gifs)
}
