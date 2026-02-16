use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::extract_claims;
use crate::errors::AppError;
use crate::ws::broadcast::{broadcast_dm_thread_message, broadcast_user_ids_message};
use crate::ws::messages::ServerMessage;
use crate::AppState;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct DmThreadSummary {
    pub thread_id: Uuid,
    pub other_username: String,
    pub other_display_name: String,
    pub other_avatar_url: Option<String>,
    pub last_message_id: Option<Uuid>,
    pub last_message_preview: Option<String>,
    pub last_message_at: Option<chrono::DateTime<chrono::Utc>>,
    pub unread_count: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct DmMessageWithAuthor {
    pub id: Uuid,
    pub thread_id: Uuid,
    pub author_id: Uuid,
    pub author_username: String,
    pub author_display_name: String,
    pub content: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub edited_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct DmMessageQuery {
    pub before: Option<Uuid>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct SendDmMessageRequest {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct EditDmMessageRequest {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateDmReadRequest {
    pub last_read_message_id: Option<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct DmThreadOpenResponse {
    pub thread: DmThreadSummary,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/dms", get(list_dm_threads))
        .route(
            "/dms/with/{username}",
            axum::routing::post(create_or_open_dm),
        )
        .route(
            "/dms/{thread_id}/messages",
            get(get_dm_messages).post(send_dm_message),
        )
        .route(
            "/dm-messages/{message_id}",
            axum::routing::patch(edit_dm_message).delete(delete_dm_message),
        )
        .route(
            "/dms/{thread_id}/read",
            axum::routing::post(update_dm_read_marker),
        )
}

async fn dm_thread_participants(
    state: &AppState,
    thread_id: Uuid,
) -> Result<(Uuid, Uuid), AppError> {
    let participants: Option<(Uuid, Uuid)> =
        sqlx::query_as("SELECT user_a_id, user_b_id FROM dm_threads WHERE id = $1")
            .bind(thread_id)
            .fetch_optional(&state.db)
            .await?;

    participants.ok_or_else(|| AppError::NotFound("DM thread not found".into()))
}

fn ensure_thread_membership(
    user_id: Uuid,
    participants: (Uuid, Uuid),
) -> Result<(Uuid, Uuid), AppError> {
    if user_id != participants.0 && user_id != participants.1 {
        return Err(AppError::NotFound("DM thread not found".into()));
    }

    Ok(participants)
}

async fn unread_count_for_user(
    state: &AppState,
    thread_id: Uuid,
    user_id: Uuid,
) -> Result<i64, AppError> {
    let unread_count = sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM dm_messages m
         LEFT JOIN dm_read_state rs
           ON rs.thread_id = m.thread_id
          AND rs.user_id = $2
         LEFT JOIN dm_messages lr
           ON lr.id = rs.last_read_message_id
         WHERE m.thread_id = $1
           AND m.author_id <> $2
           AND (
             rs.last_read_message_id IS NULL
             OR (m.created_at, m.id) > (lr.created_at, lr.id)
           )",
    )
    .bind(thread_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;

    Ok(unread_count)
}

async fn current_read_marker_for_user(
    state: &AppState,
    thread_id: Uuid,
    user_id: Uuid,
) -> Result<Option<(Uuid, chrono::DateTime<chrono::Utc>)>, AppError> {
    let row: Option<(Option<Uuid>, Option<chrono::DateTime<chrono::Utc>>)> = sqlx::query_as(
        "SELECT rs.last_read_message_id, m.created_at
         FROM dm_read_state rs
         LEFT JOIN dm_messages m
           ON m.id = rs.last_read_message_id
         WHERE rs.thread_id = $1
           AND rs.user_id = $2",
    )
    .bind(thread_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?;

    Ok(match row {
        Some((Some(message_id), Some(created_at))) => Some((message_id, created_at)),
        _ => None,
    })
}

async fn load_dm_thread_summary_for_user(
    state: &AppState,
    thread_id: Uuid,
    user_id: Uuid,
) -> Result<DmThreadSummary, AppError> {
    let summary = sqlx::query_as::<_, DmThreadSummary>(
        "SELECT
           t.id AS thread_id,
           o.username AS other_username,
           COALESCE(o.display_name, o.username) AS other_display_name,
           o.avatar_url AS other_avatar_url,
           lm.id AS last_message_id,
           lm.content AS last_message_preview,
           lm.created_at AS last_message_at,
           COALESCE(unread.unread_count, 0)::BIGINT AS unread_count
         FROM dm_threads t
         JOIN users o
           ON o.id = CASE WHEN t.user_a_id = $2 THEN t.user_b_id ELSE t.user_a_id END
         LEFT JOIN LATERAL (
           SELECT m.id, m.content, m.created_at
           FROM dm_messages m
           WHERE m.thread_id = t.id
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT 1
         ) lm ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS unread_count
           FROM dm_messages m
           LEFT JOIN dm_read_state rs
             ON rs.thread_id = t.id
            AND rs.user_id = $2
           LEFT JOIN dm_messages lr
             ON lr.id = rs.last_read_message_id
           WHERE m.thread_id = t.id
             AND m.author_id <> $2
             AND (
               rs.last_read_message_id IS NULL
               OR (m.created_at, m.id) > (lr.created_at, lr.id)
             )
         ) unread ON true
         WHERE t.id = $1
           AND (t.user_a_id = $2 OR t.user_b_id = $2)",
    )
    .bind(thread_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?;

    summary.ok_or_else(|| AppError::NotFound("DM thread not found".into()))
}

async fn list_dm_threads(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Vec<DmThreadSummary>>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;
    let user_id = claims.user_id;

    let mut threads = sqlx::query_as::<_, DmThreadSummary>(
        "SELECT
           t.id AS thread_id,
           o.username AS other_username,
           COALESCE(o.display_name, o.username) AS other_display_name,
           o.avatar_url AS other_avatar_url,
           lm.id AS last_message_id,
           lm.content AS last_message_preview,
           lm.created_at AS last_message_at,
           COALESCE(unread.unread_count, 0)::BIGINT AS unread_count
         FROM dm_threads t
         JOIN users o
           ON o.id = CASE WHEN t.user_a_id = $1 THEN t.user_b_id ELSE t.user_a_id END
         LEFT JOIN LATERAL (
           SELECT m.id, m.content, m.created_at
           FROM dm_messages m
           WHERE m.thread_id = t.id
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT 1
         ) lm ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS unread_count
           FROM dm_messages m
           LEFT JOIN dm_read_state rs
             ON rs.thread_id = t.id
            AND rs.user_id = $1
           LEFT JOIN dm_messages lr
             ON lr.id = rs.last_read_message_id
           WHERE m.thread_id = t.id
             AND m.author_id <> $1
             AND (
               rs.last_read_message_id IS NULL
               OR (m.created_at, m.id) > (lr.created_at, lr.id)
             )
         ) unread ON true
         WHERE t.user_a_id = $1 OR t.user_b_id = $1
         ORDER BY COALESCE(lm.created_at, t.created_at) DESC, t.id DESC",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;

    for thread in &mut threads {
        if let Some(last_message_preview) = &thread.last_message_preview {
            thread.last_message_preview = Some(last_message_preview.chars().take(120).collect());
        }
    }

    Ok(Json(threads))
}

async fn create_or_open_dm(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(target_username): Path<String>,
) -> Result<Json<DmThreadOpenResponse>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;
    let user_id = claims.user_id;

    if target_username == claims.username {
        return Err(AppError::BadRequest(
            "Cannot create a DM with yourself".into(),
        ));
    }

    let target_user_id: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM users WHERE username = $1")
            .bind(&target_username)
            .fetch_optional(&state.db)
            .await?;

    let target_user_id =
        target_user_id.ok_or_else(|| AppError::NotFound("User not found".into()))?;

    let user_a_id = user_id.min(target_user_id);
    let user_b_id = user_id.max(target_user_id);

    let existing_thread_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id
         FROM dm_threads
         WHERE LEAST(user_a_id, user_b_id) = $1
           AND GREATEST(user_a_id, user_b_id) = $2",
    )
    .bind(user_a_id)
    .bind(user_b_id)
    .fetch_optional(&state.db)
    .await?;

    let (thread_id, created_thread) = if let Some(thread_id) = existing_thread_id {
        (thread_id, false)
    } else {
        let thread_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO dm_threads (id, user_a_id, user_b_id)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING",
        )
        .bind(thread_id)
        .bind(user_a_id)
        .bind(user_b_id)
        .execute(&state.db)
        .await?;

        let confirmed_thread_id: Uuid = sqlx::query_scalar(
            "SELECT id
             FROM dm_threads
             WHERE LEAST(user_a_id, user_b_id) = $1
               AND GREATEST(user_a_id, user_b_id) = $2",
        )
        .bind(user_a_id)
        .bind(user_b_id)
        .fetch_one(&state.db)
        .await?;

        (confirmed_thread_id, true)
    };

    let thread = load_dm_thread_summary_for_user(&state, thread_id, user_id).await?;

    if created_thread {
        let a_summary = load_dm_thread_summary_for_user(&state, thread_id, user_a_id).await?;
        let b_summary = load_dm_thread_summary_for_user(&state, thread_id, user_b_id).await?;

        broadcast_user_ids_message(
            &state,
            &[user_a_id],
            ServerMessage::DmThreadCreated {
                thread_id,
                other_username: a_summary.other_username,
                other_display_name: a_summary.other_display_name,
                other_avatar_url: a_summary.other_avatar_url,
                last_message_id: a_summary.last_message_id,
                last_message_preview: a_summary.last_message_preview,
                last_message_at: a_summary.last_message_at.map(|value| value.to_rfc3339()),
                unread_count: a_summary.unread_count,
            },
            None,
        )
        .await;

        broadcast_user_ids_message(
            &state,
            &[user_b_id],
            ServerMessage::DmThreadCreated {
                thread_id,
                other_username: b_summary.other_username,
                other_display_name: b_summary.other_display_name,
                other_avatar_url: b_summary.other_avatar_url,
                last_message_id: b_summary.last_message_id,
                last_message_preview: b_summary.last_message_preview,
                last_message_at: b_summary.last_message_at.map(|value| value.to_rfc3339()),
                unread_count: b_summary.unread_count,
            },
            None,
        )
        .await;
    }

    Ok(Json(DmThreadOpenResponse { thread }))
}

async fn get_dm_messages(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(thread_id): Path<Uuid>,
    Query(query): Query<DmMessageQuery>,
) -> Result<Json<Vec<DmMessageWithAuthor>>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;
    let participants = dm_thread_participants(&state, thread_id).await?;
    let _ = ensure_thread_membership(claims.user_id, participants)?;

    let limit = query.limit.unwrap_or(50).clamp(1, 100);

    let messages = if let Some(before) = query.before {
        sqlx::query_as::<_, DmMessageWithAuthor>(
            "SELECT
               m.id,
               m.thread_id,
               m.author_id,
               u.username AS author_username,
               COALESCE(u.display_name, u.username) AS author_display_name,
               m.content,
               m.created_at,
               m.edited_at
             FROM dm_messages m
             JOIN users u ON u.id = m.author_id
             WHERE m.thread_id = $1
               AND (m.created_at, m.id) < (SELECT created_at, id FROM dm_messages WHERE id = $2)
             ORDER BY m.created_at DESC, m.id DESC
             LIMIT $3",
        )
        .bind(thread_id)
        .bind(before)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, DmMessageWithAuthor>(
            "SELECT
               m.id,
               m.thread_id,
               m.author_id,
               u.username AS author_username,
               COALESCE(u.display_name, u.username) AS author_display_name,
               m.content,
               m.created_at,
               m.edited_at
             FROM dm_messages m
             JOIN users u ON u.id = m.author_id
             WHERE m.thread_id = $1
             ORDER BY m.created_at DESC, m.id DESC
             LIMIT $2",
        )
        .bind(thread_id)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    };

    Ok(Json(messages))
}

async fn send_dm_message(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(thread_id): Path<Uuid>,
    Json(body): Json<SendDmMessageRequest>,
) -> Result<Json<DmMessageWithAuthor>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;
    let (user_a_id, user_b_id) = ensure_thread_membership(
        claims.user_id,
        dm_thread_participants(&state, thread_id).await?,
    )?;

    let trimmed_content = body.content.trim();
    if trimmed_content.is_empty() || trimmed_content.len() > 4000 {
        return Err(AppError::BadRequest(
            "Message content must be between 1 and 4000 characters".into(),
        ));
    }

    let message = sqlx::query_as::<_, DmMessageWithAuthor>(
        "INSERT INTO dm_messages (id, thread_id, author_id, content)
         VALUES ($1, $2, $3, $4)
         RETURNING
           id,
           thread_id,
           author_id,
           (SELECT username FROM users WHERE id = author_id) AS author_username,
           (SELECT COALESCE(display_name, username) FROM users WHERE id = author_id) AS author_display_name,
           content,
           created_at,
           edited_at",
    )
    .bind(Uuid::new_v4())
    .bind(thread_id)
    .bind(claims.user_id)
    .bind(trimmed_content)
    .fetch_one(&state.db)
    .await?;

    let _ = sqlx::query(
        "INSERT INTO dm_read_state (thread_id, user_id, last_read_message_id, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (thread_id, user_id)
         DO UPDATE SET
           last_read_message_id = EXCLUDED.last_read_message_id,
           updated_at = now()",
    )
    .bind(thread_id)
    .bind(claims.user_id)
    .bind(message.id)
    .execute(&state.db)
    .await;

    let participant_ids = [user_a_id, user_b_id];
    let preview = trimmed_content.chars().take(120).collect::<String>();

    broadcast_dm_thread_message(
        &state,
        thread_id,
        &participant_ids,
        ServerMessage::NewDmMessage {
            id: message.id,
            thread_id,
            author_id: message.author_id,
            author_username: message.author_username.clone(),
            author_display_name: message.author_display_name.clone(),
            content: message.content.clone(),
            created_at: message.created_at.to_rfc3339(),
            edited_at: message.edited_at.map(|value| value.to_rfc3339()),
        },
        None,
    )
    .await;

    broadcast_user_ids_message(
        &state,
        &participant_ids,
        ServerMessage::DmThreadUpdated {
            thread_id,
            last_message_id: Some(message.id),
            last_message_preview: Some(preview),
            last_message_at: Some(message.created_at.to_rfc3339()),
        },
        None,
    )
    .await;

    for participant_id in participant_ids {
        let unread_count = unread_count_for_user(&state, thread_id, participant_id).await?;
        broadcast_user_ids_message(
            &state,
            &[participant_id],
            ServerMessage::DmUnreadUpdated {
                thread_id,
                unread_count,
            },
            None,
        )
        .await;
    }

    Ok(Json(message))
}

async fn edit_dm_message(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(message_id): Path<Uuid>,
    Json(body): Json<EditDmMessageRequest>,
) -> Result<Json<DmMessageWithAuthor>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;
    let trimmed_content = body.content.trim();

    if trimmed_content.is_empty() || trimmed_content.len() > 4000 {
        return Err(AppError::BadRequest(
            "Message content must be between 1 and 4000 characters".into(),
        ));
    }

    let row: Option<(Uuid, Uuid, Uuid, Uuid)> = sqlx::query_as(
        "SELECT m.thread_id, m.author_id, t.user_a_id, t.user_b_id
         FROM dm_messages m
         JOIN dm_threads t ON t.id = m.thread_id
         WHERE m.id = $1",
    )
    .bind(message_id)
    .fetch_optional(&state.db)
    .await?;

    let (thread_id, author_id, user_a_id, user_b_id) =
        row.ok_or_else(|| AppError::NotFound("DM message not found".into()))?;

    if author_id != claims.user_id {
        return Err(AppError::Unauthorized(
            "You can only edit your own DM messages".into(),
        ));
    }

    let edited = sqlx::query_as::<_, DmMessageWithAuthor>(
        "UPDATE dm_messages
         SET content = $1,
             edited_at = now()
         WHERE id = $2
         RETURNING
           id,
           thread_id,
           author_id,
           (SELECT username FROM users WHERE id = author_id) AS author_username,
           (SELECT COALESCE(display_name, username) FROM users WHERE id = author_id) AS author_display_name,
           content,
           created_at,
           edited_at",
    )
    .bind(trimmed_content)
    .bind(message_id)
    .fetch_one(&state.db)
    .await?;

    let Some(edited_at) = edited.edited_at else {
        return Err(AppError::Internal("Missing edited timestamp".into()));
    };

    let participant_ids = [user_a_id, user_b_id];
    broadcast_dm_thread_message(
        &state,
        thread_id,
        &participant_ids,
        ServerMessage::DmMessageEdited {
            id: message_id,
            thread_id,
            content: edited.content.clone(),
            edited_at: edited_at.to_rfc3339(),
        },
        None,
    )
    .await;

    Ok(Json(edited))
}

async fn delete_dm_message(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(message_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;

    let row: Option<(Uuid, Uuid, Uuid, Uuid)> = sqlx::query_as(
        "SELECT m.thread_id, m.author_id, t.user_a_id, t.user_b_id
         FROM dm_messages m
         JOIN dm_threads t ON t.id = m.thread_id
         WHERE m.id = $1",
    )
    .bind(message_id)
    .fetch_optional(&state.db)
    .await?;

    let (thread_id, author_id, user_a_id, user_b_id) =
        row.ok_or_else(|| AppError::NotFound("DM message not found".into()))?;

    if author_id != claims.user_id {
        return Err(AppError::Unauthorized(
            "You can only delete your own DM messages".into(),
        ));
    }

    let previous_message_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id
         FROM dm_messages
         WHERE thread_id = $1
           AND (created_at, id) < (SELECT created_at, id FROM dm_messages WHERE id = $2)
         ORDER BY created_at DESC, id DESC
         LIMIT 1",
    )
    .bind(thread_id)
    .bind(message_id)
    .fetch_optional(&state.db)
    .await?;

    sqlx::query(
        "UPDATE dm_read_state
         SET last_read_message_id = $3,
             updated_at = now()
         WHERE thread_id = $1
           AND last_read_message_id = $2",
    )
    .bind(thread_id)
    .bind(message_id)
    .bind(previous_message_id)
    .execute(&state.db)
    .await?;

    sqlx::query("DELETE FROM dm_messages WHERE id = $1")
        .bind(message_id)
        .execute(&state.db)
        .await?;

    let participant_ids = [user_a_id, user_b_id];
    broadcast_dm_thread_message(
        &state,
        thread_id,
        &participant_ids,
        ServerMessage::DmMessageDeleted {
            id: message_id,
            thread_id,
        },
        None,
    )
    .await;

    let latest_message: Option<(Uuid, String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT id, content, created_at
         FROM dm_messages
         WHERE thread_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 1",
    )
    .bind(thread_id)
    .fetch_optional(&state.db)
    .await?;

    let (last_message_id, last_message_preview, last_message_at) =
        if let Some((latest_id, content, created_at)) = latest_message {
            (
                Some(latest_id),
                Some(content.chars().take(120).collect::<String>()),
                Some(created_at.to_rfc3339()),
            )
        } else {
            (None, None, None)
        };

    broadcast_user_ids_message(
        &state,
        &participant_ids,
        ServerMessage::DmThreadUpdated {
            thread_id,
            last_message_id,
            last_message_preview,
            last_message_at,
        },
        None,
    )
    .await;

    for participant_id in participant_ids {
        let unread_count = unread_count_for_user(&state, thread_id, participant_id).await?;
        broadcast_user_ids_message(
            &state,
            &[participant_id],
            ServerMessage::DmUnreadUpdated {
                thread_id,
                unread_count,
            },
            None,
        )
        .await;
    }

    Ok(Json(serde_json::json!({ "deleted": true })))
}

async fn update_dm_read_marker(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(thread_id): Path<Uuid>,
    Json(body): Json<UpdateDmReadRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let claims = extract_claims(&headers, &state.config.jwt.secret)?;
    let participants = dm_thread_participants(&state, thread_id).await?;
    let _ = ensure_thread_membership(claims.user_id, participants)?;

    let requested_marker = if let Some(message_id) = body.last_read_message_id {
        let created_at: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
            "SELECT created_at FROM dm_messages WHERE id = $1 AND thread_id = $2",
        )
        .bind(message_id)
        .bind(thread_id)
        .fetch_optional(&state.db)
        .await?;

        let created_at =
            created_at.ok_or_else(|| AppError::NotFound("DM message not found".into()))?;
        Some((message_id, created_at))
    } else {
        None
    };

    let current_marker = current_read_marker_for_user(&state, thread_id, claims.user_id).await?;
    let next_marker = match (current_marker, requested_marker) {
        (Some((current_id, current_at)), Some((requested_id, requested_at))) => {
            if (requested_at, requested_id) >= (current_at, current_id) {
                Some(requested_id)
            } else {
                Some(current_id)
            }
        }
        (None, Some((requested_id, _))) => Some(requested_id),
        (Some((current_id, _)), None) => Some(current_id),
        (None, None) => None,
    };

    sqlx::query(
        "INSERT INTO dm_read_state (thread_id, user_id, last_read_message_id, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (thread_id, user_id)
         DO UPDATE SET
           last_read_message_id = EXCLUDED.last_read_message_id,
           updated_at = now()",
    )
    .bind(thread_id)
    .bind(claims.user_id)
    .bind(next_marker)
    .execute(&state.db)
    .await?;

    let unread_count = unread_count_for_user(&state, thread_id, claims.user_id).await?;
    broadcast_user_ids_message(
        &state,
        &[claims.user_id],
        ServerMessage::DmUnreadUpdated {
            thread_id,
            unread_count,
        },
        None,
    )
    .await;

    Ok(Json(serde_json::json!({ "ok": true })))
}
