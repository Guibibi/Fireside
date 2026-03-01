/// WebSocket message types matching server/src/ws/messages.rs.
/// The server uses tagged JSON with a "type" discriminator field.
library;

import 'dart:convert';

// ---- Client → Server messages ----------------------------------------------

sealed class ClientMessage {
  Map<String, dynamic> toJson();

  String toJsonString() => jsonEncode(toJson());
}

class AuthenticateMessage extends ClientMessage {
  AuthenticateMessage({required this.token});
  final String token;

  @override
  Map<String, dynamic> toJson() => {'type': 'authenticate', 'token': token};
}

class SendMessageClientMsg extends ClientMessage {
  SendMessageClientMsg({
    required this.channelId,
    required this.content,
    this.attachmentMediaIds = const [],
  });
  final String channelId;
  final String content;
  final List<String> attachmentMediaIds;

  @override
  Map<String, dynamic> toJson() => {
        'type': 'send_message',
        'channel_id': channelId,
        'content': content,
        'attachment_media_ids': attachmentMediaIds,
      };
}

class SubscribeChannelMessage extends ClientMessage {
  SubscribeChannelMessage({required this.channelId});
  final String channelId;

  @override
  Map<String, dynamic> toJson() =>
      {'type': 'subscribe_channel', 'channel_id': channelId};
}

class SubscribeDmMessage extends ClientMessage {
  SubscribeDmMessage({required this.threadId});
  final String threadId;

  @override
  Map<String, dynamic> toJson() =>
      {'type': 'subscribe_dm', 'thread_id': threadId};
}

class TypingStartMessage extends ClientMessage {
  TypingStartMessage({required this.channelId});
  final String channelId;

  @override
  Map<String, dynamic> toJson() =>
      {'type': 'typing_start', 'channel_id': channelId};
}

class TypingStopMessage extends ClientMessage {
  TypingStopMessage({required this.channelId});
  final String channelId;

  @override
  Map<String, dynamic> toJson() =>
      {'type': 'typing_stop', 'channel_id': channelId};
}

class TypingStartDmMessage extends ClientMessage {
  TypingStartDmMessage({required this.threadId});
  final String threadId;

  @override
  Map<String, dynamic> toJson() =>
      {'type': 'typing_start_dm', 'thread_id': threadId};
}

class TypingStopDmMessage extends ClientMessage {
  TypingStopDmMessage({required this.threadId});
  final String threadId;

  @override
  Map<String, dynamic> toJson() =>
      {'type': 'typing_stop_dm', 'thread_id': threadId};
}

class SendDmMessageClientMsg extends ClientMessage {
  SendDmMessageClientMsg({required this.threadId, required this.content});
  final String threadId;
  final String content;

  @override
  Map<String, dynamic> toJson() =>
      {'type': 'send_dm_message', 'thread_id': threadId, 'content': content};
}

class DmReadMessage extends ClientMessage {
  DmReadMessage({required this.threadId, this.lastReadMessageId});
  final String threadId;
  final String? lastReadMessageId;

  @override
  Map<String, dynamic> toJson() => {
        'type': 'dm_read',
        'thread_id': threadId,
        'last_read_message_id': lastReadMessageId,
      };
}

class JoinVoiceMessage extends ClientMessage {
  JoinVoiceMessage({required this.channelId});
  final String channelId;

  @override
  Map<String, dynamic> toJson() =>
      {'type': 'join_voice', 'channel_id': channelId};
}

class LeaveVoiceMessage extends ClientMessage {
  LeaveVoiceMessage({required this.channelId});
  final String channelId;

  @override
  Map<String, dynamic> toJson() =>
      {'type': 'leave_voice', 'channel_id': channelId};
}

class VoiceActivityMessage extends ClientMessage {
  VoiceActivityMessage({required this.channelId, required this.speaking});
  final String channelId;
  final bool speaking;

  @override
  Map<String, dynamic> toJson() => {
        'type': 'voice_activity',
        'channel_id': channelId,
        'speaking': speaking,
      };
}

class VoiceMuteStateMessage extends ClientMessage {
  VoiceMuteStateMessage({
    required this.channelId,
    required this.micMuted,
    required this.speakerMuted,
  });
  final String channelId;
  final bool micMuted;
  final bool speakerMuted;

  @override
  Map<String, dynamic> toJson() => {
        'type': 'voice_mute_state',
        'channel_id': channelId,
        'mic_muted': micMuted,
        'speaker_muted': speakerMuted,
      };
}

class HeartbeatMessage extends ClientMessage {
  @override
  Map<String, dynamic> toJson() => {'type': 'heartbeat'};
}

class PresenceActivityMessage extends ClientMessage {
  @override
  Map<String, dynamic> toJson() => {'type': 'presence_activity'};
}

class MediaSignalClientMsg extends ClientMessage {
  MediaSignalClientMsg({required this.channelId, required this.payload});
  final String channelId;
  final Map<String, dynamic> payload;

  @override
  Map<String, dynamic> toJson() => {
        'type': 'media_signal',
        'channel_id': channelId,
        'payload': payload,
      };
}

// ---- Server → Client messages ----------------------------------------------

sealed class ServerMessage {
  const ServerMessage();

  static ServerMessage fromJson(Map<String, dynamic> json) {
    final type = json['type'] as String;
    return switch (type) {
      'authenticated' => AuthenticatedMsg.fromJson(json),
      'error' => ErrorMsg.fromJson(json),
      'presence_snapshot' => PresenceSnapshotMsg.fromJson(json),
      'voice_presence_snapshot' => VoicePresenceSnapshotMsg.fromJson(json),
      'user_connected' => UserConnectedMsg.fromJson(json),
      'user_status_changed' => UserStatusChangedMsg.fromJson(json),
      'user_disconnected' => UserDisconnectedMsg.fromJson(json),
      'user_profile_updated' => UserProfileUpdatedMsg.fromJson(json),
      'new_message' => NewMessageMsg.fromJson(json),
      'message_edited' => MessageEditedMsg.fromJson(json),
      'message_deleted' => MessageDeletedMsg.fromJson(json),
      'reaction_added' => ReactionAddedMsg.fromJson(json),
      'reaction_removed' => ReactionRemovedMsg.fromJson(json),
      'channel_created' => ChannelCreatedMsg.fromJson(json),
      'channel_updated' => ChannelUpdatedMsg.fromJson(json),
      'channel_deleted' => ChannelDeletedMsg.fromJson(json),
      'channel_activity' => ChannelActivityMsg.fromJson(json),
      'typing_start' => TypingStartServerMsg.fromJson(json),
      'typing_stop' => TypingStopServerMsg.fromJson(json),
      'new_dm_message' => NewDmMessageMsg.fromJson(json),
      'dm_message_edited' => DmMessageEditedMsg.fromJson(json),
      'dm_message_deleted' => DmMessageDeletedMsg.fromJson(json),
      'dm_typing_start' => DmTypingStartMsg.fromJson(json),
      'dm_typing_stop' => DmTypingStopMsg.fromJson(json),
      'dm_thread_created' => DmThreadCreatedMsg.fromJson(json),
      'dm_thread_updated' => DmThreadUpdatedMsg.fromJson(json),
      'dm_unread_updated' => DmUnreadUpdatedMsg.fromJson(json),
      'voice_joined' => VoiceJoinedMsg.fromJson(json),
      'voice_left' => VoiceLeftMsg.fromJson(json),
      'voice_user_joined' => VoiceUserJoinedMsg.fromJson(json),
      'voice_user_left' => VoiceUserLeftMsg.fromJson(json),
      'voice_user_speaking' => VoiceUserSpeakingMsg.fromJson(json),
      'voice_user_mute_state' => VoiceUserMuteStateMsg.fromJson(json),
      'media_signal' => MediaSignalServerMsg.fromJson(json),
      _ => UnknownMsg(type: type, raw: json),
    };
  }
}

class AuthenticatedMsg extends ServerMessage {
  const AuthenticatedMsg({
    required this.userId,
    required this.username,
    required this.role,
  });
  final String userId;
  final String username;
  final String role;

  factory AuthenticatedMsg.fromJson(Map<String, dynamic> j) => AuthenticatedMsg(
        userId: j['user_id'] as String,
        username: j['username'] as String,
        role: j['role'] as String,
      );
}

class ErrorMsg extends ServerMessage {
  const ErrorMsg({required this.message});
  final String message;

  factory ErrorMsg.fromJson(Map<String, dynamic> j) =>
      ErrorMsg(message: j['message'] as String);
}

class PresenceUser {
  const PresenceUser({required this.username, required this.status});
  final String username;
  final String status;

  factory PresenceUser.fromJson(Map<String, dynamic> j) =>
      PresenceUser(username: j['username'] as String, status: j['status'] as String);
}

class PresenceSnapshotMsg extends ServerMessage {
  const PresenceSnapshotMsg({required this.users});
  final List<PresenceUser> users;

  factory PresenceSnapshotMsg.fromJson(Map<String, dynamic> j) =>
      PresenceSnapshotMsg(
        users: (j['users'] as List<dynamic>)
            .map((e) => PresenceUser.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class VoicePresenceChannel {
  const VoicePresenceChannel({
    required this.channelId,
    required this.usernames,
    required this.muteStates,
  });
  final String channelId;
  final List<String> usernames;
  final Map<String, ({bool micMuted, bool speakerMuted})> muteStates;

  factory VoicePresenceChannel.fromJson(Map<String, dynamic> j) {
    final rawMutes = j['mute_states'] as Map<String, dynamic>? ?? {};
    final muteStates = rawMutes.map((k, v) {
      final vm = v as Map<String, dynamic>;
      return MapEntry(k, (
        micMuted: vm['mic_muted'] as bool,
        speakerMuted: vm['speaker_muted'] as bool,
      ));
    });
    return VoicePresenceChannel(
      channelId: j['channel_id'] as String,
      usernames: (j['usernames'] as List<dynamic>).cast<String>(),
      muteStates: muteStates,
    );
  }
}

class VoicePresenceSnapshotMsg extends ServerMessage {
  const VoicePresenceSnapshotMsg({required this.channels});
  final List<VoicePresenceChannel> channels;

  factory VoicePresenceSnapshotMsg.fromJson(Map<String, dynamic> j) =>
      VoicePresenceSnapshotMsg(
        channels: (j['channels'] as List<dynamic>)
            .map((e) => VoicePresenceChannel.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class UserConnectedMsg extends ServerMessage {
  const UserConnectedMsg({required this.username, required this.status});
  final String username;
  final String status;

  factory UserConnectedMsg.fromJson(Map<String, dynamic> j) =>
      UserConnectedMsg(username: j['username'] as String, status: j['status'] as String);
}

class UserStatusChangedMsg extends ServerMessage {
  const UserStatusChangedMsg({required this.username, required this.status});
  final String username;
  final String status;

  factory UserStatusChangedMsg.fromJson(Map<String, dynamic> j) =>
      UserStatusChangedMsg(username: j['username'] as String, status: j['status'] as String);
}

class UserDisconnectedMsg extends ServerMessage {
  const UserDisconnectedMsg({required this.username});
  final String username;

  factory UserDisconnectedMsg.fromJson(Map<String, dynamic> j) =>
      UserDisconnectedMsg(username: j['username'] as String);
}

class UserProfileUpdatedMsg extends ServerMessage {
  const UserProfileUpdatedMsg({
    required this.username,
    required this.displayName,
    this.avatarUrl,
    this.profileDescription,
    this.profileStatus,
  });
  final String username;
  final String displayName;
  final String? avatarUrl;
  final String? profileDescription;
  final String? profileStatus;

  factory UserProfileUpdatedMsg.fromJson(Map<String, dynamic> j) =>
      UserProfileUpdatedMsg(
        username: j['username'] as String,
        displayName: j['display_name'] as String,
        avatarUrl: j['avatar_url'] as String?,
        profileDescription: j['profile_description'] as String?,
        profileStatus: j['profile_status'] as String?,
      );
}

class NewMessageMsg extends ServerMessage {
  const NewMessageMsg({
    required this.id,
    required this.channelId,
    required this.authorId,
    required this.authorUsername,
    required this.authorDisplayName,
    required this.content,
    required this.createdAt,
    required this.attachments,
  });
  final String id;
  final String channelId;
  final String authorId;
  final String authorUsername;
  final String authorDisplayName;
  final String content;
  final String createdAt;
  final List<Map<String, dynamic>> attachments;

  factory NewMessageMsg.fromJson(Map<String, dynamic> j) => NewMessageMsg(
        id: j['id'] as String,
        channelId: j['channel_id'] as String,
        authorId: j['author_id'] as String,
        authorUsername: j['author_username'] as String,
        authorDisplayName: j['author_display_name'] as String,
        content: j['content'] as String,
        createdAt: j['created_at'] as String,
        attachments: (j['attachments'] as List<dynamic>? ?? [])
            .cast<Map<String, dynamic>>(),
      );
}

class MessageEditedMsg extends ServerMessage {
  const MessageEditedMsg({
    required this.id,
    required this.channelId,
    required this.content,
    required this.editedAt,
  });
  final String id;
  final String channelId;
  final String content;
  final String editedAt;

  factory MessageEditedMsg.fromJson(Map<String, dynamic> j) =>
      MessageEditedMsg(
        id: j['id'] as String,
        channelId: j['channel_id'] as String,
        content: j['content'] as String,
        editedAt: j['edited_at'] as String,
      );
}

class MessageDeletedMsg extends ServerMessage {
  const MessageDeletedMsg({required this.id, required this.channelId});
  final String id;
  final String channelId;

  factory MessageDeletedMsg.fromJson(Map<String, dynamic> j) =>
      MessageDeletedMsg(
          id: j['id'] as String, channelId: j['channel_id'] as String);
}

class ReactionAddedMsg extends ServerMessage {
  const ReactionAddedMsg({
    required this.channelId,
    required this.messageId,
    required this.userId,
    required this.count,
    this.emojiId,
    this.unicodeEmoji,
    this.shortcode,
  });
  final String channelId;
  final String messageId;
  final String userId;
  final int count;
  final String? emojiId;
  final String? unicodeEmoji;
  final String? shortcode;

  factory ReactionAddedMsg.fromJson(Map<String, dynamic> j) => ReactionAddedMsg(
        channelId: j['channel_id'] as String,
        messageId: j['message_id'] as String,
        userId: j['user_id'] as String,
        count: j['count'] as int,
        emojiId: j['emoji_id'] as String?,
        unicodeEmoji: j['unicode_emoji'] as String?,
        shortcode: j['shortcode'] as String?,
      );
}

class ReactionRemovedMsg extends ServerMessage {
  const ReactionRemovedMsg({
    required this.channelId,
    required this.messageId,
    required this.userId,
    required this.count,
    this.emojiId,
    this.unicodeEmoji,
  });
  final String channelId;
  final String messageId;
  final String userId;
  final int count;
  final String? emojiId;
  final String? unicodeEmoji;

  factory ReactionRemovedMsg.fromJson(Map<String, dynamic> j) =>
      ReactionRemovedMsg(
        channelId: j['channel_id'] as String,
        messageId: j['message_id'] as String,
        userId: j['user_id'] as String,
        count: j['count'] as int,
        emojiId: j['emoji_id'] as String?,
        unicodeEmoji: j['unicode_emoji'] as String?,
      );
}

class ChannelCreatedMsg extends ServerMessage {
  const ChannelCreatedMsg({required this.channel});
  final Map<String, dynamic> channel;

  factory ChannelCreatedMsg.fromJson(Map<String, dynamic> j) =>
      ChannelCreatedMsg(channel: j['channel'] as Map<String, dynamic>);
}

class ChannelUpdatedMsg extends ServerMessage {
  const ChannelUpdatedMsg({required this.channel});
  final Map<String, dynamic> channel;

  factory ChannelUpdatedMsg.fromJson(Map<String, dynamic> j) =>
      ChannelUpdatedMsg(channel: j['channel'] as Map<String, dynamic>);
}

class ChannelDeletedMsg extends ServerMessage {
  const ChannelDeletedMsg({required this.id});
  final String id;

  factory ChannelDeletedMsg.fromJson(Map<String, dynamic> j) =>
      ChannelDeletedMsg(id: j['id'] as String);
}

class ChannelActivityMsg extends ServerMessage {
  const ChannelActivityMsg({required this.channelId});
  final String channelId;

  factory ChannelActivityMsg.fromJson(Map<String, dynamic> j) =>
      ChannelActivityMsg(channelId: j['channel_id'] as String);
}

class TypingStartServerMsg extends ServerMessage {
  const TypingStartServerMsg({required this.channelId, required this.username});
  final String channelId;
  final String username;

  factory TypingStartServerMsg.fromJson(Map<String, dynamic> j) =>
      TypingStartServerMsg(
          channelId: j['channel_id'] as String, username: j['username'] as String);
}

class TypingStopServerMsg extends ServerMessage {
  const TypingStopServerMsg({required this.channelId, required this.username});
  final String channelId;
  final String username;

  factory TypingStopServerMsg.fromJson(Map<String, dynamic> j) =>
      TypingStopServerMsg(
          channelId: j['channel_id'] as String, username: j['username'] as String);
}

class NewDmMessageMsg extends ServerMessage {
  const NewDmMessageMsg({
    required this.id,
    required this.threadId,
    required this.authorId,
    required this.authorUsername,
    required this.authorDisplayName,
    required this.content,
    required this.createdAt,
    this.editedAt,
  });
  final String id;
  final String threadId;
  final String authorId;
  final String authorUsername;
  final String authorDisplayName;
  final String content;
  final String createdAt;
  final String? editedAt;

  factory NewDmMessageMsg.fromJson(Map<String, dynamic> j) => NewDmMessageMsg(
        id: j['id'] as String,
        threadId: j['thread_id'] as String,
        authorId: j['author_id'] as String,
        authorUsername: j['author_username'] as String,
        authorDisplayName: j['author_display_name'] as String,
        content: j['content'] as String,
        createdAt: j['created_at'] as String,
        editedAt: j['edited_at'] as String?,
      );
}

class DmMessageEditedMsg extends ServerMessage {
  const DmMessageEditedMsg({
    required this.id,
    required this.threadId,
    required this.content,
    required this.editedAt,
  });
  final String id;
  final String threadId;
  final String content;
  final String editedAt;

  factory DmMessageEditedMsg.fromJson(Map<String, dynamic> j) =>
      DmMessageEditedMsg(
        id: j['id'] as String,
        threadId: j['thread_id'] as String,
        content: j['content'] as String,
        editedAt: j['edited_at'] as String,
      );
}

class DmMessageDeletedMsg extends ServerMessage {
  const DmMessageDeletedMsg({required this.id, required this.threadId});
  final String id;
  final String threadId;

  factory DmMessageDeletedMsg.fromJson(Map<String, dynamic> j) =>
      DmMessageDeletedMsg(id: j['id'] as String, threadId: j['thread_id'] as String);
}

class DmTypingStartMsg extends ServerMessage {
  const DmTypingStartMsg({required this.threadId, required this.username});
  final String threadId;
  final String username;

  factory DmTypingStartMsg.fromJson(Map<String, dynamic> j) =>
      DmTypingStartMsg(
          threadId: j['thread_id'] as String, username: j['username'] as String);
}

class DmTypingStopMsg extends ServerMessage {
  const DmTypingStopMsg({required this.threadId, required this.username});
  final String threadId;
  final String username;

  factory DmTypingStopMsg.fromJson(Map<String, dynamic> j) =>
      DmTypingStopMsg(
          threadId: j['thread_id'] as String, username: j['username'] as String);
}

class DmThreadCreatedMsg extends ServerMessage {
  const DmThreadCreatedMsg({
    required this.threadId,
    required this.otherUsername,
    required this.otherDisplayName,
    this.otherAvatarUrl,
    this.lastMessageId,
    this.lastMessagePreview,
    this.lastMessageAt,
    required this.unreadCount,
  });
  final String threadId;
  final String otherUsername;
  final String otherDisplayName;
  final String? otherAvatarUrl;
  final String? lastMessageId;
  final String? lastMessagePreview;
  final String? lastMessageAt;
  final int unreadCount;

  factory DmThreadCreatedMsg.fromJson(Map<String, dynamic> j) =>
      DmThreadCreatedMsg(
        threadId: j['thread_id'] as String,
        otherUsername: j['other_username'] as String,
        otherDisplayName: j['other_display_name'] as String,
        otherAvatarUrl: j['other_avatar_url'] as String?,
        lastMessageId: j['last_message_id'] as String?,
        lastMessagePreview: j['last_message_preview'] as String?,
        lastMessageAt: j['last_message_at'] as String?,
        unreadCount: j['unread_count'] as int,
      );
}

class DmThreadUpdatedMsg extends ServerMessage {
  const DmThreadUpdatedMsg({
    required this.threadId,
    this.lastMessageId,
    this.lastMessagePreview,
    this.lastMessageAt,
  });
  final String threadId;
  final String? lastMessageId;
  final String? lastMessagePreview;
  final String? lastMessageAt;

  factory DmThreadUpdatedMsg.fromJson(Map<String, dynamic> j) =>
      DmThreadUpdatedMsg(
        threadId: j['thread_id'] as String,
        lastMessageId: j['last_message_id'] as String?,
        lastMessagePreview: j['last_message_preview'] as String?,
        lastMessageAt: j['last_message_at'] as String?,
      );
}

class DmUnreadUpdatedMsg extends ServerMessage {
  const DmUnreadUpdatedMsg({required this.threadId, required this.unreadCount});
  final String threadId;
  final int unreadCount;

  factory DmUnreadUpdatedMsg.fromJson(Map<String, dynamic> j) =>
      DmUnreadUpdatedMsg(
          threadId: j['thread_id'] as String, unreadCount: j['unread_count'] as int);
}

class VoiceJoinedMsg extends ServerMessage {
  const VoiceJoinedMsg({required this.channelId, required this.userId});
  final String channelId;
  final String userId;

  factory VoiceJoinedMsg.fromJson(Map<String, dynamic> j) =>
      VoiceJoinedMsg(channelId: j['channel_id'] as String, userId: j['user_id'] as String);
}

class VoiceLeftMsg extends ServerMessage {
  const VoiceLeftMsg({required this.channelId, required this.userId});
  final String channelId;
  final String userId;

  factory VoiceLeftMsg.fromJson(Map<String, dynamic> j) =>
      VoiceLeftMsg(channelId: j['channel_id'] as String, userId: j['user_id'] as String);
}

class VoiceUserJoinedMsg extends ServerMessage {
  const VoiceUserJoinedMsg({
    required this.channelId,
    required this.username,
    required this.micMuted,
    required this.speakerMuted,
  });
  final String channelId;
  final String username;
  final bool micMuted;
  final bool speakerMuted;

  factory VoiceUserJoinedMsg.fromJson(Map<String, dynamic> j) =>
      VoiceUserJoinedMsg(
        channelId: j['channel_id'] as String,
        username: j['username'] as String,
        micMuted: j['mic_muted'] as bool,
        speakerMuted: j['speaker_muted'] as bool,
      );
}

class VoiceUserLeftMsg extends ServerMessage {
  const VoiceUserLeftMsg({required this.channelId, required this.username});
  final String channelId;
  final String username;

  factory VoiceUserLeftMsg.fromJson(Map<String, dynamic> j) =>
      VoiceUserLeftMsg(
          channelId: j['channel_id'] as String, username: j['username'] as String);
}

class VoiceUserSpeakingMsg extends ServerMessage {
  const VoiceUserSpeakingMsg({
    required this.channelId,
    required this.username,
    required this.speaking,
  });
  final String channelId;
  final String username;
  final bool speaking;

  factory VoiceUserSpeakingMsg.fromJson(Map<String, dynamic> j) =>
      VoiceUserSpeakingMsg(
        channelId: j['channel_id'] as String,
        username: j['username'] as String,
        speaking: j['speaking'] as bool,
      );
}

class VoiceUserMuteStateMsg extends ServerMessage {
  const VoiceUserMuteStateMsg({
    required this.channelId,
    required this.username,
    required this.micMuted,
    required this.speakerMuted,
  });
  final String channelId;
  final String username;
  final bool micMuted;
  final bool speakerMuted;

  factory VoiceUserMuteStateMsg.fromJson(Map<String, dynamic> j) =>
      VoiceUserMuteStateMsg(
        channelId: j['channel_id'] as String,
        username: j['username'] as String,
        micMuted: j['mic_muted'] as bool,
        speakerMuted: j['speaker_muted'] as bool,
      );
}

class MediaSignalServerMsg extends ServerMessage {
  const MediaSignalServerMsg({required this.channelId, required this.payload});
  final String channelId;
  final Map<String, dynamic> payload;

  factory MediaSignalServerMsg.fromJson(Map<String, dynamic> j) =>
      MediaSignalServerMsg(
        channelId: j['channel_id'] as String,
        payload: j['payload'] as Map<String, dynamic>,
      );
}

class UnknownMsg extends ServerMessage {
  const UnknownMsg({required this.type, required this.raw});
  final String type;
  final Map<String, dynamic> raw;
}
