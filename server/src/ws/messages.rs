use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    #[serde(rename = "authenticate")]
    Authenticate { token: String },

    #[serde(rename = "send_message")]
    SendMessage { channel_id: Uuid, content: String },

    #[serde(rename = "subscribe_channel")]
    SubscribeChannel { channel_id: Uuid },

    #[serde(rename = "typing_start")]
    TypingStart { channel_id: Uuid },

    #[serde(rename = "typing_stop")]
    TypingStop { channel_id: Uuid },

    #[serde(rename = "join_voice")]
    JoinVoice { channel_id: Uuid },

    #[serde(rename = "leave_voice")]
    LeaveVoice { channel_id: Uuid },

    #[serde(rename = "media_signal")]
    MediaSignal {
        channel_id: Uuid,
        payload: serde_json::Value,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    #[serde(rename = "authenticated")]
    Authenticated { user_id: Uuid, username: String },

    #[serde(rename = "error")]
    Error { message: String },

    #[serde(rename = "presence_snapshot")]
    PresenceSnapshot { usernames: Vec<String> },

    #[serde(rename = "user_connected")]
    UserConnected { username: String },

    #[serde(rename = "user_disconnected")]
    UserDisconnected { username: String },

    #[serde(rename = "new_message")]
    NewMessage {
        id: Uuid,
        channel_id: Uuid,
        author_id: Uuid,
        author_username: String,
        content: String,
        created_at: String,
    },

    #[serde(rename = "typing_start")]
    TypingStart { channel_id: Uuid, username: String },

    #[serde(rename = "typing_stop")]
    TypingStop { channel_id: Uuid, username: String },

    #[serde(rename = "voice_joined")]
    VoiceJoined { channel_id: Uuid, user_id: Uuid },

    #[serde(rename = "voice_left")]
    VoiceLeft { channel_id: Uuid, user_id: Uuid },

    #[serde(rename = "media_signal")]
    MediaSignal {
        channel_id: Uuid,
        payload: serde_json::Value,
    },
}
