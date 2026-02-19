use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::message_attachments::MessageAttachmentPayload;
use crate::models::Channel;

#[derive(Debug, Serialize)]
pub struct VoicePresenceChannel {
    pub channel_id: Uuid,
    pub usernames: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PresenceUser {
    pub username: String,
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    #[serde(rename = "authenticate")]
    Authenticate { token: String },

    #[serde(rename = "send_message")]
    SendMessage {
        channel_id: Uuid,
        content: String,
        #[serde(default)]
        attachment_media_ids: Vec<Uuid>,
    },

    #[serde(rename = "subscribe_channel")]
    SubscribeChannel { channel_id: Uuid },

    #[serde(rename = "subscribe_dm")]
    SubscribeDm { thread_id: Uuid },

    #[serde(rename = "typing_start")]
    TypingStart { channel_id: Uuid },

    #[serde(rename = "typing_stop")]
    TypingStop { channel_id: Uuid },

    #[serde(rename = "typing_start_dm")]
    TypingStartDm { thread_id: Uuid },

    #[serde(rename = "typing_stop_dm")]
    TypingStopDm { thread_id: Uuid },

    #[serde(rename = "send_dm_message")]
    SendDmMessage { thread_id: Uuid, content: String },

    #[serde(rename = "dm_read")]
    DmRead {
        thread_id: Uuid,
        last_read_message_id: Option<Uuid>,
    },

    #[serde(rename = "join_voice")]
    JoinVoice { channel_id: Uuid },

    #[serde(rename = "leave_voice")]
    LeaveVoice { channel_id: Uuid },

    #[serde(rename = "voice_activity")]
    VoiceActivity { channel_id: Uuid, speaking: bool },

    #[serde(rename = "heartbeat")]
    Heartbeat,

    #[serde(rename = "presence_activity")]
    PresenceActivity,

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
    Authenticated {
        user_id: Uuid,
        username: String,
        role: String,
    },

    #[serde(rename = "error")]
    Error { message: String },

    #[serde(rename = "presence_snapshot")]
    PresenceSnapshot { users: Vec<PresenceUser> },

    #[serde(rename = "voice_presence_snapshot")]
    VoicePresenceSnapshot { channels: Vec<VoicePresenceChannel> },

    #[serde(rename = "user_connected")]
    UserConnected { username: String, status: String },

    #[serde(rename = "user_status_changed")]
    UserStatusChanged { username: String, status: String },

    #[serde(rename = "user_disconnected")]
    UserDisconnected { username: String },

    #[serde(rename = "user_profile_updated")]
    UserProfileUpdated {
        username: String,
        display_name: String,
        avatar_url: Option<String>,
        profile_description: Option<String>,
        profile_status: Option<String>,
    },

    #[serde(rename = "new_message")]
    NewMessage {
        id: Uuid,
        channel_id: Uuid,
        author_id: Uuid,
        author_username: String,
        author_display_name: String,
        content: String,
        created_at: String,
        attachments: Vec<MessageAttachmentPayload>,
    },

    #[serde(rename = "message_edited")]
    MessageEdited {
        id: Uuid,
        channel_id: Uuid,
        content: String,
        edited_at: String,
    },

    #[serde(rename = "message_deleted")]
    MessageDeleted { id: Uuid, channel_id: Uuid },

    #[serde(rename = "reaction_added")]
    ReactionAdded {
        channel_id: Uuid,
        message_id: Uuid,
        emoji_id: Option<Uuid>,
        unicode_emoji: Option<String>,
        shortcode: Option<String>,
        user_id: Uuid,
        count: i64,
    },

    #[serde(rename = "reaction_removed")]
    ReactionRemoved {
        channel_id: Uuid,
        message_id: Uuid,
        emoji_id: Option<Uuid>,
        unicode_emoji: Option<String>,
        user_id: Uuid,
        count: i64,
    },

    #[serde(rename = "channel_created")]
    ChannelCreated { channel: Channel },

    #[serde(rename = "channel_updated")]
    ChannelUpdated { channel: Channel },

    #[serde(rename = "channel_deleted")]
    ChannelDeleted { id: Uuid },

    #[serde(rename = "channel_activity")]
    ChannelActivity { channel_id: Uuid },

    #[serde(rename = "typing_start")]
    TypingStart { channel_id: Uuid, username: String },

    #[serde(rename = "typing_stop")]
    TypingStop { channel_id: Uuid, username: String },

    #[serde(rename = "new_dm_message")]
    NewDmMessage {
        id: Uuid,
        thread_id: Uuid,
        author_id: Uuid,
        author_username: String,
        author_display_name: String,
        content: String,
        created_at: String,
        edited_at: Option<String>,
    },

    #[serde(rename = "dm_message_edited")]
    DmMessageEdited {
        id: Uuid,
        thread_id: Uuid,
        content: String,
        edited_at: String,
    },

    #[serde(rename = "dm_message_deleted")]
    DmMessageDeleted { id: Uuid, thread_id: Uuid },

    #[serde(rename = "dm_typing_start")]
    DmTypingStart { thread_id: Uuid, username: String },

    #[serde(rename = "dm_typing_stop")]
    DmTypingStop { thread_id: Uuid, username: String },

    #[serde(rename = "dm_thread_created")]
    DmThreadCreated {
        thread_id: Uuid,
        other_username: String,
        other_display_name: String,
        other_avatar_url: Option<String>,
        last_message_id: Option<Uuid>,
        last_message_preview: Option<String>,
        last_message_at: Option<String>,
        unread_count: i64,
    },

    #[serde(rename = "dm_thread_updated")]
    DmThreadUpdated {
        thread_id: Uuid,
        last_message_id: Option<Uuid>,
        last_message_preview: Option<String>,
        last_message_at: Option<String>,
    },

    #[serde(rename = "dm_unread_updated")]
    DmUnreadUpdated { thread_id: Uuid, unread_count: i64 },

    #[serde(rename = "voice_joined")]
    VoiceJoined { channel_id: Uuid, user_id: Uuid },

    #[serde(rename = "voice_left")]
    VoiceLeft { channel_id: Uuid, user_id: Uuid },

    #[serde(rename = "voice_user_joined")]
    VoiceUserJoined { channel_id: Uuid, username: String },

    #[serde(rename = "voice_user_left")]
    VoiceUserLeft { channel_id: Uuid, username: String },

    #[serde(rename = "voice_user_speaking")]
    VoiceUserSpeaking {
        channel_id: Uuid,
        username: String,
        speaking: bool,
    },

    #[serde(rename = "media_signal")]
    MediaSignal {
        channel_id: Uuid,
        payload: serde_json::Value,
    },
}
