/// Core domain models shared across the app.
/// Field names use snake_case to match server wire format.

class User {
  const User({
    required this.id,
    required this.username,
    required this.displayName,
    required this.role,
    this.avatarUrl,
    this.profileDescription,
    this.profileStatus,
  });

  final String id;
  final String username;
  final String displayName;
  final String role;
  final String? avatarUrl;
  final String? profileDescription;
  final String? profileStatus;

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'] as String,
      username: json['username'] as String,
      displayName: json['display_name'] as String? ?? json['username'] as String,
      role: json['role'] as String? ?? 'member',
      avatarUrl: json['avatar_url'] as String?,
      profileDescription: json['profile_description'] as String?,
      profileStatus: json['profile_status'] as String?,
    );
  }
}

enum ChannelKind { text, voice }

class Channel {
  const Channel({
    required this.id,
    required this.name,
    required this.kind,
    this.description,
    this.opusBitrate,
    this.opusDtx,
    this.opusFec,
    this.lastReadMessageId,
    this.unreadCount,
  });

  final String id;
  final String name;
  final ChannelKind kind;
  final String? description;
  final int? opusBitrate;
  final bool? opusDtx;
  final bool? opusFec;
  final String? lastReadMessageId;
  final int? unreadCount;

  factory Channel.fromJson(Map<String, dynamic> json) {
    return Channel(
      id: json['id'] as String,
      name: json['name'] as String,
      kind: json['kind'] == 'voice' ? ChannelKind.voice : ChannelKind.text,
      description: json['description'] as String?,
      opusBitrate: json['opus_bitrate'] as int?,
      opusDtx: json['opus_dtx'] as bool?,
      opusFec: json['opus_fec'] as bool?,
      lastReadMessageId: json['last_read_message_id'] as String?,
      unreadCount: json['unread_count'] as int?,
    );
  }
}

class MessageAttachment {
  const MessageAttachment({
    required this.id,
    required this.filename,
    required this.contentType,
    required this.url,
    this.size,
    this.width,
    this.height,
  });

  final String id;
  final String filename;
  final String contentType;
  final String url;
  final int? size;
  final int? width;
  final int? height;

  bool get isImage => contentType.startsWith('image/');
  bool get isVideo => contentType.startsWith('video/');

  factory MessageAttachment.fromJson(Map<String, dynamic> json) {
    return MessageAttachment(
      id: json['id'] as String,
      filename: json['filename'] as String,
      contentType: json['content_type'] as String,
      url: json['url'] as String,
      size: json['size'] as int?,
      width: json['width'] as int?,
      height: json['height'] as int?,
    );
  }
}

class ReactionSummary {
  const ReactionSummary({
    required this.count,
    required this.reactedByMe,
    this.emojiId,
    this.unicodeEmoji,
    this.shortcode,
    this.imageUrl,
  });

  final int count;
  final bool reactedByMe;
  final String? emojiId;
  final String? unicodeEmoji;
  final String? shortcode;
  final String? imageUrl;

  String get displayLabel => unicodeEmoji ?? shortcode ?? '?';

  factory ReactionSummary.fromJson(Map<String, dynamic> json) {
    return ReactionSummary(
      count: json['count'] as int,
      reactedByMe: json['reacted_by_me'] as bool? ?? false,
      emojiId: json['emoji_id'] as String?,
      unicodeEmoji: json['unicode_emoji'] as String?,
      shortcode: json['shortcode'] as String?,
      imageUrl: json['image_url'] as String?,
    );
  }
}

class Message {
  const Message({
    required this.id,
    required this.channelId,
    required this.authorId,
    required this.authorUsername,
    required this.authorDisplayName,
    required this.content,
    required this.createdAt,
    this.editedAt,
    this.attachments = const [],
    this.reactions = const [],
    this.authorAvatarUrl,
  });

  final String id;
  final String channelId;
  final String authorId;
  final String authorUsername;
  final String authorDisplayName;
  final String content;
  final DateTime createdAt;
  final DateTime? editedAt;
  final List<MessageAttachment> attachments;
  final List<ReactionSummary> reactions;
  final String? authorAvatarUrl;

  factory Message.fromJson(Map<String, dynamic> json) {
    return Message(
      id: json['id'] as String,
      channelId: json['channel_id'] as String,
      authorId: json['author_id'] as String,
      authorUsername: json['author_username'] as String,
      authorDisplayName: json['author_display_name'] as String,
      content: json['content'] as String,
      createdAt: DateTime.parse(json['created_at'] as String),
      editedAt: json['edited_at'] != null
          ? DateTime.parse(json['edited_at'] as String)
          : null,
      attachments: (json['attachments'] as List<dynamic>? ?? [])
          .map((e) => MessageAttachment.fromJson(e as Map<String, dynamic>))
          .toList(),
      reactions: (json['reactions'] as List<dynamic>? ?? [])
          .map((e) => ReactionSummary.fromJson(e as Map<String, dynamic>))
          .toList(),
      authorAvatarUrl: json['author_avatar_url'] as String?,
    );
  }

  Message copyWith({
    String? content,
    DateTime? editedAt,
    List<ReactionSummary>? reactions,
  }) {
    return Message(
      id: id,
      channelId: channelId,
      authorId: authorId,
      authorUsername: authorUsername,
      authorDisplayName: authorDisplayName,
      content: content ?? this.content,
      createdAt: createdAt,
      editedAt: editedAt ?? this.editedAt,
      attachments: attachments,
      reactions: reactions ?? this.reactions,
      authorAvatarUrl: authorAvatarUrl,
    );
  }
}

class DmThread {
  const DmThread({
    required this.threadId,
    required this.otherUsername,
    required this.otherDisplayName,
    this.otherAvatarUrl,
    this.lastMessageId,
    this.lastMessagePreview,
    this.lastMessageAt,
    this.unreadCount = 0,
  });

  final String threadId;
  final String otherUsername;
  final String otherDisplayName;
  final String? otherAvatarUrl;
  final String? lastMessageId;
  final String? lastMessagePreview;
  final DateTime? lastMessageAt;
  final int unreadCount;

  factory DmThread.fromJson(Map<String, dynamic> json) {
    return DmThread(
      threadId: json['thread_id'] as String,
      otherUsername: json['other_username'] as String,
      otherDisplayName: json['other_display_name'] as String,
      otherAvatarUrl: json['other_avatar_url'] as String?,
      lastMessageId: json['last_message_id'] as String?,
      lastMessagePreview: json['last_message_preview'] as String?,
      lastMessageAt: json['last_message_at'] != null
          ? DateTime.parse(json['last_message_at'] as String)
          : null,
      unreadCount: json['unread_count'] as int? ?? 0,
    );
  }

  DmThread copyWith({
    String? lastMessageId,
    String? lastMessagePreview,
    DateTime? lastMessageAt,
    int? unreadCount,
  }) {
    return DmThread(
      threadId: threadId,
      otherUsername: otherUsername,
      otherDisplayName: otherDisplayName,
      otherAvatarUrl: otherAvatarUrl,
      lastMessageId: lastMessageId ?? this.lastMessageId,
      lastMessagePreview: lastMessagePreview ?? this.lastMessagePreview,
      lastMessageAt: lastMessageAt ?? this.lastMessageAt,
      unreadCount: unreadCount ?? this.unreadCount,
    );
  }
}

class DmMessage {
  const DmMessage({
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
  final DateTime createdAt;
  final DateTime? editedAt;

  factory DmMessage.fromJson(Map<String, dynamic> json) {
    return DmMessage(
      id: json['id'] as String,
      threadId: json['thread_id'] as String,
      authorId: json['author_id'] as String,
      authorUsername: json['author_username'] as String,
      authorDisplayName: json['author_display_name'] as String,
      content: json['content'] as String,
      createdAt: DateTime.parse(json['created_at'] as String),
      editedAt: json['edited_at'] != null
          ? DateTime.parse(json['edited_at'] as String)
          : null,
    );
  }

  DmMessage copyWith({String? content, DateTime? editedAt}) {
    return DmMessage(
      id: id,
      threadId: threadId,
      authorId: authorId,
      authorUsername: authorUsername,
      authorDisplayName: authorDisplayName,
      content: content ?? this.content,
      createdAt: createdAt,
      editedAt: editedAt ?? this.editedAt,
    );
  }
}

class CustomEmoji {
  const CustomEmoji({
    required this.id,
    required this.shortcode,
    required this.imageUrl,
    required this.createdBy,
  });

  final String id;
  final String shortcode;
  final String imageUrl;
  final String createdBy;

  factory CustomEmoji.fromJson(Map<String, dynamic> json) {
    return CustomEmoji(
      id: json['id'] as String,
      shortcode: json['shortcode'] as String,
      imageUrl: json['image_url'] as String,
      createdBy: json['created_by'] as String,
    );
  }
}

class VoiceMuteState {
  const VoiceMuteState({
    required this.micMuted,
    required this.speakerMuted,
  });

  final bool micMuted;
  final bool speakerMuted;
}

class VoiceParticipant {
  const VoiceParticipant({
    required this.username,
    required this.muteState,
    this.speaking = false,
    this.displayName,
    this.avatarUrl,
  });

  final String username;
  final VoiceMuteState muteState;
  final bool speaking;
  final String? displayName;
  final String? avatarUrl;

  VoiceParticipant copyWith({
    VoiceMuteState? muteState,
    bool? speaking,
  }) {
    return VoiceParticipant(
      username: username,
      muteState: muteState ?? this.muteState,
      speaking: speaking ?? this.speaking,
      displayName: displayName,
      avatarUrl: avatarUrl,
    );
  }
}
