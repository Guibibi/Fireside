import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/http_client.dart';
import '../api/ws_client.dart';
import '../api/ws_messages.dart';
import '../core/models.dart';

// ---- Providers -------------------------------------------------------------

final dmThreadsProvider = AsyncNotifierProvider<DmThreadsNotifier, List<DmThread>>(
  DmThreadsNotifier.new,
);

/// Active thread ID — drives which conversation is shown.
final activeDmThreadIdProvider = StateProvider<String?>((ref) => null);

/// Messages for a specific DM thread.
final dmMessagesProvider = AsyncNotifierProviderFamily<DmMessagesNotifier, List<DmMessage>, String>(
  DmMessagesNotifier.new,
);

// ---- DM Threads Notifier ---------------------------------------------------

class DmThreadsNotifier extends AsyncNotifier<List<DmThread>> {
  StreamSubscription<ServerMessage>? _wsSub;

  @override
  Future<List<DmThread>> build() async {
    _wsSub = ref.watch(wsMessageStreamProvider.stream).listen(_onWsMessage);
    ref.onDispose(_wsSub!.cancel);
    return _fetchThreads();
  }

  Future<List<DmThread>> _fetchThreads() async {
    final http = ref.read(httpClientProvider);
    final raw = await http.getDmThreads();
    final threads = raw
        .map((e) => DmThread.fromJson(e as Map<String, dynamic>))
        .toList();
    threads.sort((a, b) {
      final aTime = a.lastMessageAt;
      final bTime = b.lastMessageAt;
      if (aTime == null && bTime == null) return 0;
      if (aTime == null) return 1;
      if (bTime == null) return -1;
      return bTime.compareTo(aTime);
    });
    return threads;
  }

  Future<void> refresh() async {
    state = AsyncData(await _fetchThreads());
  }

  Future<DmThread> createThread(String targetUsername) async {
    final http = ref.read(httpClientProvider);
    final raw = await http.createDmThread(targetUsername);
    final thread = DmThread.fromJson(raw);
    final current = state.valueOrNull ?? [];
    final exists = current.any((t) => t.threadId == thread.threadId);
    if (!exists) {
      state = AsyncData([thread, ...current]);
    }
    return thread;
  }

  void _onWsMessage(ServerMessage msg) {
    final current = state.valueOrNull;
    if (current == null) return;

    switch (msg) {
      case DmThreadCreatedMsg(:final threadId, :final otherUsername, :final otherDisplayName, :final otherAvatarUrl, :final lastMessageId, :final lastMessagePreview, :final lastMessageAt, :final unreadCount):
        final exists = current.any((t) => t.threadId == threadId);
        if (!exists) {
          final thread = DmThread(
            threadId: threadId,
            otherUsername: otherUsername,
            otherDisplayName: otherDisplayName,
            otherAvatarUrl: otherAvatarUrl,
            lastMessageId: lastMessageId,
            lastMessagePreview: lastMessagePreview,
            lastMessageAt: lastMessageAt != null ? DateTime.tryParse(lastMessageAt) : null,
            unreadCount: unreadCount,
          );
          state = AsyncData([thread, ...current]);
        }

      case DmThreadUpdatedMsg(:final threadId, :final lastMessageId, :final lastMessagePreview, :final lastMessageAt):
        final updated = current.map((t) {
          if (t.threadId != threadId) return t;
          return t.copyWith(
            lastMessageId: lastMessageId,
            lastMessagePreview: lastMessagePreview,
            lastMessageAt: lastMessageAt != null ? DateTime.tryParse(lastMessageAt) : null,
          );
        }).toList();
        updated.sort((a, b) {
          final aTime = a.lastMessageAt;
          final bTime = b.lastMessageAt;
          if (aTime == null && bTime == null) return 0;
          if (aTime == null) return 1;
          if (bTime == null) return -1;
          return bTime.compareTo(aTime);
        });
        state = AsyncData(updated);

      case DmUnreadUpdatedMsg(:final threadId, :final unreadCount):
        final updated = current.map((t) {
          if (t.threadId != threadId) return t;
          return t.copyWith(unreadCount: unreadCount);
        }).toList();
        state = AsyncData(updated);

      default:
        break;
    }
  }
}

// ---- DM Messages Notifier --------------------------------------------------

class DmMessagesNotifier extends FamilyAsyncNotifier<List<DmMessage>, String> {
  String get threadId => arg;
  StreamSubscription<ServerMessage>? _wsSub;

  @override
  Future<List<DmMessage>> build(String arg) async {
    // Subscribe via WS
    ref.read(wsClientProvider).send(SubscribeDmMessage(threadId: arg));

    _wsSub = ref.watch(wsMessageStreamProvider.stream).listen(_onWsMessage);
    ref.onDispose(_wsSub!.cancel);

    return _fetchMessages();
  }

  Future<List<DmMessage>> _fetchMessages({String? before}) async {
    final http = ref.read(httpClientProvider);
    final raw = await http.getDmMessages(threadId, before: before);
    return raw
        .map((e) => DmMessage.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> loadMore() async {
    final current = state.valueOrNull ?? [];
    if (current.isEmpty) return;
    final oldest = current.first.id;
    final older = await _fetchMessages(before: oldest);
    state = AsyncData([...older, ...current]);
  }

  void _onWsMessage(ServerMessage msg) {
    final current = state.valueOrNull;
    if (current == null) return;

    switch (msg) {
      case NewDmMessageMsg(
        :final id,
        :final threadId,
        :final authorId,
        :final authorUsername,
        :final authorDisplayName,
        :final content,
        :final createdAt,
        :final editedAt,
      ):
        if (threadId != this.threadId) return;
        final message = DmMessage(
          id: id,
          threadId: threadId,
          authorId: authorId,
          authorUsername: authorUsername,
          authorDisplayName: authorDisplayName,
          content: content,
          createdAt: DateTime.parse(createdAt),
          editedAt: editedAt != null ? DateTime.tryParse(editedAt) : null,
        );
        state = AsyncData([...current, message]);

      case DmMessageEditedMsg(:final id, :final threadId, :final content, :final editedAt):
        if (threadId != this.threadId) return;
        final updated = current.map((m) {
          if (m.id != id) return m;
          return m.copyWith(
            content: content,
            editedAt: DateTime.tryParse(editedAt),
          );
        }).toList();
        state = AsyncData(updated);

      case DmMessageDeletedMsg(:final id, :final threadId):
        if (threadId != this.threadId) return;
        state = AsyncData(current.where((m) => m.id != id).toList());

      default:
        break;
    }
  }
}
