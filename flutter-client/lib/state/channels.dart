import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/http_client.dart';
import '../api/ws_client.dart';
import '../api/ws_messages.dart';
import '../core/models.dart';

// ---- Providers -------------------------------------------------------------

/// Currently active text/voice channel ID.
final activeChannelIdProvider = StateProvider<String?>((ref) => null);

/// Map of channelId → list of usernames currently in that voice channel.
final voiceChannelParticipantsProvider =
    StateProvider<Map<String, List<String>>>((ref) => {});

/// All channels fetched from the server.
final channelsProvider =
    AsyncNotifierProvider<ChannelsNotifier, List<Channel>>(
  ChannelsNotifier.new,
);

// ---- Notifier --------------------------------------------------------------

class ChannelsNotifier extends AsyncNotifier<List<Channel>> {
  @override
  Future<List<Channel>> build() async {
    // Listen for WS events that affect channel list
    ref.listen(wsMessageStreamProvider, (_, next) {
      next.whenData(_handleServerMessage);
    });

    return _fetch();
  }

  Future<List<Channel>> _fetch() async {
    final client = ref.read(httpClientProvider);
    final raw = await client.getChannels();
    return raw
        .cast<Map<String, dynamic>>()
        .map(Channel.fromJson)
        .toList();
  }

  void _handleServerMessage(ServerMessage msg) {
    switch (msg) {
      case ChannelCreatedMsg(:final channel):
        state = state.whenData((channels) {
          final newChannel = Channel.fromJson(channel);
          return [...channels, newChannel];
        });

      case ChannelUpdatedMsg(:final channel):
        state = state.whenData((channels) {
          final updated = Channel.fromJson(channel);
          return channels.map((c) => c.id == updated.id ? updated : c).toList();
        });

      case ChannelDeletedMsg(:final id):
        state = state.whenData((channels) {
          return channels.where((c) => c.id != id).toList();
        });

      case VoicePresenceSnapshotMsg(:final channels):
        final map = <String, List<String>>{};
        for (final ch in channels) {
          map[ch.channelId] = ch.usernames;
        }
        ref.read(voiceChannelParticipantsProvider.notifier).state = map;

      case VoiceUserJoinedMsg(:final channelId, :final username):
        final current =
            Map<String, List<String>>.from(
              ref.read(voiceChannelParticipantsProvider),
            );
        current[channelId] = [...(current[channelId] ?? []), username];
        ref.read(voiceChannelParticipantsProvider.notifier).state = current;

      case VoiceUserLeftMsg(:final channelId, :final username):
        final current =
            Map<String, List<String>>.from(
              ref.read(voiceChannelParticipantsProvider),
            );
        current[channelId] =
            (current[channelId] ?? []).where((u) => u != username).toList();
        ref.read(voiceChannelParticipantsProvider.notifier).state = current;

      default:
        break;
    }
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_fetch);
  }
}
