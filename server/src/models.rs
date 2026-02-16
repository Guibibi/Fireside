use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(type_name = "user_role", rename_all = "lowercase")]
pub enum UserRole {
    Operator,
    Admin,
    Member,
}

impl UserRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            UserRole::Operator => "operator",
            UserRole::Admin => "admin",
            UserRole::Member => "member",
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Invite {
    pub id: Uuid,
    pub code: String,
    pub created_by: Uuid,
    pub single_use: bool,
    pub used_count: i32,
    pub max_uses: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub revoked: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(type_name = "channel_kind", rename_all = "lowercase")]
pub enum ChannelKind {
    Text,
    Voice,
}

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Channel {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub kind: ChannelKind,
    pub position: i32,
    pub created_at: DateTime<Utc>,
    pub opus_bitrate: Option<i32>,
    pub opus_dtx: Option<bool>,
    pub opus_fec: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Message {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub author_id: Uuid,
    pub content: String,
    pub created_at: DateTime<Utc>,
    pub edited_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct MediaAsset {
    pub id: Uuid,
    pub owner_id: Uuid,
    pub parent_id: Option<Uuid>,
    pub derivative_kind: Option<String>,
    pub mime_type: String,
    pub bytes: i64,
    pub checksum: String,
    pub storage_key: String,
    pub status: String,
    pub error_message: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Emoji {
    pub id: Uuid,
    pub shortcode: String,
    pub name: String,
    pub media_id: Uuid,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Reaction {
    pub id: Uuid,
    pub message_id: Uuid,
    pub user_id: Uuid,
    pub emoji_id: Option<Uuid>,
    pub unicode_emoji: Option<String>,
    pub created_at: DateTime<Utc>,
}
