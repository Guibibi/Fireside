import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/http_client.dart';
import '../api/ws_client.dart';
import '../api/ws_messages.dart';
import '../core/models.dart';

// ---- Providers -------------------------------------------------------------

/// Map of channelId → set of usernames currently typing.
final typingUsersProvider =
    StateProvider<Map<String, Set<String>>>((ref) => {});

/// Messages for a given channel, with real-time WS updates.
final messagesProvider = AsyncNotifierProvider.family<
    MessagesNotifier, List<Message>, String>(
  MessagesNotifier.new,
);

// ---- Notifier --------------------------------------------------------------

class MessagesNotifier
    extends FamilyAsyncNotifier<List<Message>, String> {
  late String _channelId;
  bool _hasMore = true;

  @override
  Future<List<Message>> build(String arg) async {
    _channelId = arg;

    // Listen for WS events
    ref.listen(wsMessageStreamProvider, (_, next) {
      next.whenData(_handleServerMessage);
    });

    return _fetch();
  }

  Future<List<Message>> _fetch({String? before}) async {
    final client = ref.read(httpClientProvider);
    final raw = await client.getMessages(_channelId, before: before);
    final messages = raw
        .cast<Map<String, dynamic>>()
        .map(Message.fromJson)
        .toList();

    if (messages.length < 50) {
      _hasMore = false;
    }

    return messages;
  }

  /// Load older messages (pagination).
  Future<void> loadMore() async {
    if (!_hasMore) return;
    final current = state.valueOrNull;
    if (current == null || current.isEmpty) return;

    final oldest = current.last.id;
    final older = await _fetch(before: oldest);

    state = AsyncData([...current, ...older]);
  }

  void _handleServerMessage(ServerMessage msg) {
    switch (msg) {
      case NewMessageMsg(
          :final id,
          :final channelId,
          :final authorId,
          :final authorUsername,
          :final authorDisplayName,
          :final content,
          :final createdAt,
          :final attachments,
        ):
        if (channelId != _channelId) return;
        final newMessage = Message(
          id: id,
          channelId: channelId,
          authorId: authorId,
          authorUsername: authorUsername,
          authorDisplayName: authorDisplayName,
          content: content,
          createdAt: DateTime.parse(createdAt),
          attachments: attachments
              .map(MessageAttachment.fromJson)
              .toList(),
        );
        state = state.whenData((msgs) => [newMessage, ...msgs]);

      case MessageEditedMsg(
          :final id,
          :final channelId,
          :final content,
          :final editedAt,
        ):
        if (channelId != _channelId) return;
        state = state.whenData((msgs) {
          return msgs.map((m) {
            if (m.id != id) return m;
            return m.copyWith(
              content: content,
              editedAt: DateTime.parse(editedAt),
            );
          }).toList();
        });

      case MessageDeletedMsg(:final id, :final channelId):
        if (channelId != _channelId) return;
        state = state.whenData(
          (msgs) => msgs.where((m) => m.id != id).toList(),
        );

      case ReactionAddedMsg(
          :final channelId,
          :final messageId,
          :final count,
          :final emojiId,
          :final unicodeEmoji,
          :final shortcode,
          userId: _,
        ):
        if (channelId != _channelId) return;
        state = state.whenData((msgs) {
          return msgs.map((m) {
            if (m.id != messageId) return m;
            final reactions = _upsertReaction(
              m.reactions,
              emojiId: emojiId,
              unicodeEmoji: unicodeEmoji,
              shortcode: shortcode,
              count: count,
              reactedByMe: false, // will be updated on next fetch
            );
            return m.copyWith(reactions: reactions);
          }).toList();
        });

      case ReactionRemovedMsg(
          :final channelId,
          :final messageId,
          :final count,
          :final emojiId,
          :final unicodeEmoji,
        ):
        if (channelId != _channelId) return;
        state = state.whenData((msgs) {
          return msgs.map((m) {
            if (m.id != messageId) return m;
            final reactions = count == 0
                ? m.reactions
                    .where((r) => r.emojiId != emojiId && r.unicodeEmoji != unicodeEmoji)
                    .toList()
                : _upsertReaction(
                    m.reactions,
                    emojiId: emojiId,
                    unicodeEmoji: unicodeEmoji,
                    shortcode: null,
                    count: count,
                    reactedByMe: false,
                  );
            return m.copyWith(reactions: reactions);
          }).toList();
        });

      case TypingStartServerMsg(:final channelId, :final username):
        if (channelId != _channelId) return;
        final current = Map<String, Set<String>>.from(
          ref.read(typingUsersProvider),
        );
        current[channelId] = {...(current[channelId] ?? {}), username};
        ref.read(typingUsersProvider.notifier).state = current;

      case TypingStopServerMsg(:final channelId, :final username):
        if (channelId != _channelId) return;
        final current = Map<String, Set<String>>.from(
          ref.read(typingUsersProvider),
        );
        final set = Set<String>.from(current[channelId] ?? {});
        set.remove(username);
        current[channelId] = set;
        ref.read(typingUsersProvider.notifier).state = current;

      default:
        break;
    }
  }

  List<ReactionSummary> _upsertReaction(
    List<ReactionSummary> reactions, {
    String? emojiId,
    String? unicodeEmoji,
    String? shortcode,
    required int count,
    required bool reactedByMe,
  }) {
    final idx = reactions.indexWhere(
      (r) =>
          (emojiId != null && r.emojiId == emojiId) ||
          (unicodeEmoji != null && r.unicodeEmoji == unicodeEmoji),
    );
    if (idx == -1) {
      return [
        ...reactions,
        ReactionSummary(
          count: count,
          reactedByMe: reactedByMe,
          emojiId: emojiId,
          unicodeEmoji: unicodeEmoji,
          shortcode: shortcode,
        ),
      ];
    }
    final updated = reactions.toList();
    updated[idx] = ReactionSummary(
      count: count,
      reactedByMe: reactedByMe,
      emojiId: updated[idx].emojiId,
      unicodeEmoji: updated[idx].unicodeEmoji,
      shortcode: updated[idx].shortcode,
      imageUrl: updated[idx].imageUrl,
    );
    return updated;
  }
}
