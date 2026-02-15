use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use futures_util::StreamExt;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;
use url::Url;

use crate::auth::validate_token;
use crate::errors::AppError;
use crate::AppState;

const MAX_HTML_BYTES: usize = 256 * 1024;
const MAX_TEXT_LEN: usize = 280;
const MAX_REDIRECTS: usize = 5;

#[derive(Deserialize)]
struct EmbedQuery {
    url: String,
}

#[derive(Serialize)]
pub struct EmbedResponse {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub site_name: Option<String>,
}

#[derive(Deserialize)]
struct OEmbedPayload {
    title: Option<String>,
    provider_name: Option<String>,
    author_name: Option<String>,
    thumbnail_url: Option<String>,
}

struct ValidatedTarget {
    url: Url,
    resolved_addrs: Vec<SocketAddr>,
}

enum SafeFetchError {
    Blocked(AppError),
    Request(reqwest::Error),
    Internal(AppError),
}

pub fn router() -> Router<AppState> {
    Router::new().route("/embeds", get(fetch_embed))
}

async fn fetch_embed(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Query(query): Query<EmbedQuery>,
) -> Result<Json<EmbedResponse>, AppError> {
    let _username = extract_username(&headers, &state.config.jwt.secret)?;
    let target = validate_target_url(&query.url).await?;
    let target_url = target.url;

    let oembed = fetch_oembed(&target_url).await;

    let response = match fetch_with_validated_redirects(target_url.clone()).await {
        Ok(response) => response,
        Err(SafeFetchError::Request(error)) => {
            tracing::warn!(error = ?error, url = %target_url, "Embed fetch failed, returning fallback");
            return Ok(Json(match oembed {
                Some(embed) => merge_embeds(embed, fallback_embed(&target_url)),
                None => fallback_embed(&target_url),
            }));
        }
        Err(SafeFetchError::Blocked(error)) => return Err(error),
        Err(SafeFetchError::Internal(error)) => return Err(error),
    };

    if !response.status().is_success() {
        tracing::debug!(status = %response.status(), url = %target_url, "Embed URL returned non-success status, using fallback");
        return Ok(Json(match oembed {
            Some(embed) => merge_embeds(embed, fallback_embed(response.url())),
            None => fallback_embed(response.url()),
        }));
    }

    let final_url = response.url().clone();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();

    if !content_type.contains("text/html") {
        let basic = EmbedResponse {
            url: final_url.to_string(),
            title: sanitize_text(final_url.domain().or(final_url.host_str())),
            description: None,
            image_url: None,
            site_name: sanitize_text(final_url.domain()),
        };

        return Ok(Json(match oembed {
            Some(embed) => merge_embeds(embed, basic),
            None => basic,
        }));
    }

    let html = match read_limited_html(response).await {
        Ok(html) => html,
        Err(error) => {
            tracing::warn!(error = ?error, url = %final_url, "Embed body read failed, returning fallback");
            return Ok(Json(match oembed {
                Some(embed) => merge_embeds(embed, fallback_embed(&final_url)),
                None => fallback_embed(&final_url),
            }));
        }
    };
    let (title, description, site_name, raw_image) = {
        let document = Html::parse_document(&html);
        (
            first_non_empty(&[
                meta_content(&document, "property", "og:title"),
                meta_content(&document, "name", "twitter:title"),
                tag_text(&document, "title"),
            ]),
            first_non_empty(&[
                meta_content(&document, "property", "og:description"),
                meta_content(&document, "name", "twitter:description"),
                meta_content(&document, "name", "description"),
            ]),
            first_non_empty(&[
                meta_content(&document, "property", "og:site_name"),
                final_url.domain().map(str::to_string),
            ]),
            first_non_empty(&[
                meta_content(&document, "property", "og:image"),
                meta_content(&document, "name", "twitter:image"),
            ]),
        )
    };
    let image_url = match raw_image {
        Some(value) => validate_embed_image_url(&final_url, &value).await,
        None => None,
    };

    let html_embed = EmbedResponse {
        url: final_url.to_string(),
        title: sanitize_text(title.as_deref()),
        description: sanitize_text(description.as_deref()),
        image_url,
        site_name: sanitize_text(site_name.as_deref()),
    };

    Ok(Json(match oembed {
        Some(embed) => merge_embeds(embed, html_embed),
        None => html_embed,
    }))
}

fn merge_embeds(primary: EmbedResponse, secondary: EmbedResponse) -> EmbedResponse {
    EmbedResponse {
        url: primary.url,
        title: primary.title.or(secondary.title),
        description: primary.description.or(secondary.description),
        image_url: primary.image_url.or(secondary.image_url),
        site_name: primary.site_name.or(secondary.site_name),
    }
}

async fn fetch_oembed(target_url: &Url) -> Option<EmbedResponse> {
    let endpoint = match target_url.domain()? {
        "youtube.com" | "www.youtube.com" | "youtu.be" | "m.youtube.com" => {
            "https://www.youtube.com/oembed"
        }
        "reddit.com" | "www.reddit.com" | "old.reddit.com" => "https://www.reddit.com/oembed",
        _ => return None,
    };

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(4))
        .user_agent("YankcordBot/1.0 (+https://yankcord.local)")
        .build()
        .ok()?;

    let response = client
        .get(endpoint)
        .query(&[("url", target_url.as_str()), ("format", "json")])
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let payload = response.json::<OEmbedPayload>().await.ok()?;
    let title = first_non_empty(&[payload.title, payload.author_name]);
    let image_url = match payload.thumbnail_url {
        Some(value) => validate_embed_image_url(target_url, &value).await,
        None => None,
    };

    Some(EmbedResponse {
        url: target_url.to_string(),
        title: sanitize_text(title.as_deref()),
        description: None,
        image_url,
        site_name: sanitize_text(payload.provider_name.as_deref()),
    })
}

fn fallback_embed(url: &Url) -> EmbedResponse {
    EmbedResponse {
        url: url.to_string(),
        title: sanitize_text(url.domain().or(url.host_str())),
        description: None,
        image_url: None,
        site_name: sanitize_text(url.domain()),
    }
}

async fn read_limited_html(response: reqwest::Response) -> Result<String, AppError> {
    let mut stream = response.bytes_stream();
    let mut html_bytes = Vec::with_capacity(MAX_HTML_BYTES.min(16 * 1024));

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|error| {
            AppError::BadRequest(format!("Failed to read URL response body: {error}"))
        })?;

        let available = MAX_HTML_BYTES.saturating_sub(html_bytes.len());
        if available == 0 {
            break;
        }

        if chunk.len() > available {
            html_bytes.extend_from_slice(&chunk[..available]);
            break;
        }

        html_bytes.extend_from_slice(&chunk);
    }

    Ok(String::from_utf8_lossy(&html_bytes).into_owned())
}

fn meta_content(document: &Html, attr: &str, expected: &str) -> Option<String> {
    let selector = Selector::parse("meta").ok()?;
    for element in document.select(&selector) {
        let matches = element
            .value()
            .attr(attr)
            .map(|value| value.eq_ignore_ascii_case(expected))
            .unwrap_or(false);

        if !matches {
            continue;
        }

        if let Some(content) = element.value().attr("content") {
            let cleaned = content.trim();
            if !cleaned.is_empty() {
                return Some(cleaned.to_string());
            }
        }
    }

    None
}

fn tag_text(document: &Html, tag_name: &str) -> Option<String> {
    let selector = Selector::parse(tag_name).ok()?;
    document.select(&selector).find_map(|element| {
        let text = element.text().collect::<String>();
        let cleaned = text.trim();
        if cleaned.is_empty() {
            None
        } else {
            Some(cleaned.to_string())
        }
    })
}

fn first_non_empty(values: &[Option<String>]) -> Option<String> {
    for candidate in values.iter().flatten() {
        let trimmed = candidate.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    None
}

fn sanitize_text(value: Option<&str>) -> Option<String> {
    let value = value?;
    let collapsed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return None;
    }

    Some(truncate_chars(collapsed, MAX_TEXT_LEN))
}

fn truncate_chars(value: String, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value;
    }

    value.chars().take(max_chars).collect()
}

fn resolve_url(base: &Url, candidate: &str) -> Option<String> {
    let joined = base.join(candidate).ok()?;
    if joined.scheme() != "http" && joined.scheme() != "https" {
        return None;
    }

    Some(joined.to_string())
}

async fn validate_embed_image_url(base: &Url, candidate: &str) -> Option<String> {
    let resolved = resolve_url(base, candidate)?;
    let validated = validate_target_url(&resolved).await.ok()?;
    Some(validated.url.to_string())
}

async fn validate_target_url(candidate: &str) -> Result<ValidatedTarget, AppError> {
    let parsed = Url::parse(candidate.trim())
        .map_err(|_| AppError::BadRequest("URL must be a valid absolute http/https URL".into()))?;

    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(AppError::BadRequest(
            "Only http/https URLs are supported for embeds".into(),
        ));
    }

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AppError::BadRequest(
            "Embedded credentials in URLs are not allowed".into(),
        ));
    }

    if !is_allowed_public_url(&parsed) {
        return Err(AppError::BadRequest(
            "Local and private network URLs are not allowed".into(),
        ));
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::BadRequest("URL host is required".into()))?;
    let port = parsed.port_or_known_default().unwrap_or(80);

    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_forbidden_ip(ip) {
            return Err(AppError::BadRequest(
                "Local and private network URLs are not allowed".into(),
            ));
        }
        return Ok(ValidatedTarget {
            resolved_addrs: vec![SocketAddr::new(ip, port)],
            url: parsed,
        });
    }

    let mut has_address = false;
    let mut resolved_addrs = Vec::new();
    let addresses = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| AppError::BadRequest("Could not resolve URL host".into()))?;

    for socket in addresses {
        has_address = true;
        if is_forbidden_ip(socket.ip()) {
            return Err(AppError::BadRequest(
                "Local and private network URLs are not allowed".into(),
            ));
        }
        resolved_addrs.push(socket);
    }

    if !has_address {
        return Err(AppError::BadRequest("Could not resolve URL host".into()));
    }

    Ok(ValidatedTarget {
        url: parsed,
        resolved_addrs,
    })
}

async fn fetch_with_validated_redirects(
    initial_url: Url,
) -> Result<reqwest::Response, SafeFetchError> {
    let mut current_url = initial_url;

    for _ in 0..=MAX_REDIRECTS {
        let validated = validate_target_url(current_url.as_str())
            .await
            .map_err(SafeFetchError::Blocked)?;
        let client = build_client_for_target(&validated).map_err(SafeFetchError::Internal)?;
        let response = client
            .get(validated.url.clone())
            .send()
            .await
            .map_err(SafeFetchError::Request)?;

        let redirect_target =
            next_redirect_url(&validated.url, &response).map_err(SafeFetchError::Blocked)?;
        if let Some(next_url) = redirect_target {
            current_url = next_url;
            continue;
        }

        return Ok(response);
    }

    Err(SafeFetchError::Blocked(AppError::BadRequest(
        "Too many redirects while fetching embed URL".into(),
    )))
}

fn next_redirect_url(
    base_url: &Url,
    response: &reqwest::Response,
) -> Result<Option<Url>, AppError> {
    if !response.status().is_redirection() {
        return Ok(None);
    }

    let Some(location_header) = response.headers().get(reqwest::header::LOCATION) else {
        return Ok(None);
    };

    let location = location_header
        .to_str()
        .map_err(|_| AppError::BadRequest("Redirect target is invalid".into()))?;
    let next_url = base_url
        .join(location)
        .map_err(|_| AppError::BadRequest("Redirect target is invalid".into()))?;

    if next_url.scheme() != "http" && next_url.scheme() != "https" {
        return Err(AppError::BadRequest(
            "Only http/https URLs are supported for embeds".into(),
        ));
    }

    Ok(Some(next_url))
}

fn build_client_for_target(target: &ValidatedTarget) -> Result<reqwest::Client, AppError> {
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(6))
        .user_agent("YankcordBot/1.0 (+https://yankcord.local)");

    if let Some(host) = target.url.host_str() {
        if host.parse::<IpAddr>().is_err() {
            builder = builder.resolve_to_addrs(host, &target.resolved_addrs);
        }
    }

    builder
        .build()
        .map_err(|error| AppError::Internal(format!("Failed to initialize HTTP client: {error}")))
}

fn is_allowed_public_url(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };

    if host.eq_ignore_ascii_case("localhost") {
        return false;
    }

    if let Ok(ip) = host.parse::<IpAddr>() {
        return !is_forbidden_ip(ip);
    }

    true
}

fn is_forbidden_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => is_forbidden_ipv4(value),
        IpAddr::V6(value) => is_forbidden_ipv6(value),
    }
}

fn is_forbidden_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    let in_shared_range = octets[0] == 100 && (octets[1] & 0b1100_0000) == 0b0100_0000;
    let in_benchmark_range = octets[0] == 198 && (octets[1] == 18 || octets[1] == 19);

    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_multicast()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
        || in_shared_range
        || in_benchmark_range
}

fn is_forbidden_ipv6(ip: Ipv6Addr) -> bool {
    if let Some(mapped) = ip.to_ipv4_mapped() {
        return is_forbidden_ipv4(mapped);
    }

    let segments = ip.segments();
    let is_documentation = segments[0] == 0x2001 && segments[1] == 0x0db8;

    ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || ip.is_unique_local()
        || ip.is_unicast_link_local()
        || is_documentation
}

fn extract_username(headers: &axum::http::HeaderMap, secret: &str) -> Result<String, AppError> {
    let header = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::Unauthorized("Missing authorization header".into()))?;

    let token = header
        .strip_prefix("Bearer ")
        .ok_or_else(|| AppError::Unauthorized("Invalid authorization format".into()))?;

    let claims = validate_token(token, secret)
        .map_err(|_| AppError::Unauthorized("Invalid token".into()))?;

    Ok(claims.username)
}
