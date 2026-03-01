import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models.dart';
import '../../state/auth.dart';
import '../../state/channels.dart';
import '../../theme/app_theme.dart';

/// Sidebar channel list with text and voice sections, user bar at bottom.
class ChannelList extends ConsumerWidget {
  const ChannelList({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final channelsAsync = ref.watch(channelsProvider);
    final activeId = ref.watch(activeChannelIdProvider);
    final voiceParticipants = ref.watch(voiceChannelParticipantsProvider);

    return Column(
      children: [
        Expanded(
          child: channelsAsync.when(
            loading: () => const Center(
              child: CircularProgressIndicator(
                color: AppColors.accent,
                strokeWidth: 2,
              ),
            ),
            error: (err, _) => Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Text(
                'Failed to load channels',
                style: AppTextStyles.bodySm.copyWith(color: AppColors.danger),
              ),
            ),
            data: (channels) {
              final textChannels =
                  channels.where((c) => c.kind == ChannelKind.text).toList();
              final voiceChannels =
                  channels.where((c) => c.kind == ChannelKind.voice).toList();

              return ListView(
                padding: const EdgeInsets.only(top: AppSpacing.sm),
                children: [
                  if (textChannels.isNotEmpty) ...[
                    _SectionHeader(label: 'Text Channels'),
                    ...textChannels.map(
                      (c) => _ChannelRow(
                        channel: c,
                        isActive: c.id == activeId,
                        participants: const [],
                        onTap: () {
                          ref
                              .read(activeChannelIdProvider.notifier)
                              .state = c.id;
                          context.go('/chat/channel/${c.id}');
                        },
                      ),
                    ),
                  ],
                  if (voiceChannels.isNotEmpty) ...[
                    const SizedBox(height: AppSpacing.sm),
                    _SectionHeader(label: 'Voice Channels'),
                    ...voiceChannels.map(
                      (c) => _ChannelRow(
                        channel: c,
                        isActive: c.id == activeId,
                        participants: voiceParticipants[c.id] ?? [],
                        onTap: () {
                          ref
                              .read(activeChannelIdProvider.notifier)
                              .state = c.id;
                          context.go('/chat/channel/${c.id}');
                        },
                      ),
                    ),
                  ],
                ],
              );
            },
          ),
        ),
        _VoiceDock(voiceParticipants: voiceParticipants),
        _UserBar(),
      ],
    );
  }
}

// ---- Section header --------------------------------------------------------

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.xs,
        AppSpacing.md,
        AppSpacing.xs,
      ),
      child: Text(
        label.toUpperCase(),
        style: AppTextStyles.headingSm.copyWith(color: AppColors.gray9),
      ),
    );
  }
}

// ---- Channel row -----------------------------------------------------------

class _ChannelRow extends StatelessWidget {
  const _ChannelRow({
    required this.channel,
    required this.isActive,
    required this.participants,
    required this.onTap,
  });

  final Channel channel;
  final bool isActive;
  final List<String> participants;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final isVoice = channel.kind == ChannelKind.voice;
    final hasUnread = (channel.unreadCount ?? 0) > 0;

    return InkWell(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 100),
        margin: const EdgeInsets.symmetric(
          horizontal: AppSpacing.sm,
          vertical: 1,
        ),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.sm,
          vertical: AppSpacing.xs + 2,
        ),
        decoration: BoxDecoration(
          color: isActive ? AppColors.accentSubtle : Colors.transparent,
          borderRadius: BorderRadius.all(AppRadius.sm),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  isVoice
                      ? Icons.volume_up_rounded
                      : Icons.tag_rounded,
                  size: 16,
                  color: isActive ? AppColors.accent : AppColors.gray9,
                ),
                const SizedBox(width: AppSpacing.xs),
                Expanded(
                  child: Text(
                    channel.name,
                    style: AppTextStyles.bodyMd.copyWith(
                      color: isActive
                          ? AppColors.accent
                          : hasUnread
                              ? AppColors.gray12
                              : AppColors.gray10,
                      fontWeight: hasUnread
                          ? FontWeight.w600
                          : FontWeight.w400,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (hasUnread)
                  _UnreadBadge(count: channel.unreadCount!),
              ],
            ),
            if (isVoice && participants.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(
                  left: AppSpacing.lg,
                  top: AppSpacing.xs,
                ),
                child: _VoiceParticipantList(participants: participants),
              ),
          ],
        ),
      ),
    );
  }
}

class _UnreadBadge extends StatelessWidget {
  const _UnreadBadge({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.xs,
        vertical: 2,
      ),
      decoration: const BoxDecoration(
        color: AppColors.accent,
        borderRadius: BorderRadius.all(AppRadius.full),
      ),
      child: Text(
        count > 99 ? '99+' : '$count',
        style: AppTextStyles.labelSm.copyWith(
          color: AppColors.gray12,
          fontSize: 10,
        ),
      ),
    );
  }
}

class _VoiceParticipantList extends StatelessWidget {
  const _VoiceParticipantList({required this.participants});

  final List<String> participants;

  @override
  Widget build(BuildContext context) {
    final display = participants.take(3).toList();
    final overflow = participants.length - 3;
    return Text(
      overflow > 0
          ? '${display.join(', ')} +$overflow'
          : display.join(', '),
      style: AppTextStyles.bodySm.copyWith(color: AppColors.gray9),
      overflow: TextOverflow.ellipsis,
    );
  }
}

// ---- Voice dock ------------------------------------------------------------

class _VoiceDock extends ConsumerWidget {
  const _VoiceDock({required this.voiceParticipants});

  final Map<String, List<String>> voiceParticipants;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final activeId = ref.watch(activeChannelIdProvider);
    final channelsAsync = ref.watch(channelsProvider);

    if (activeId == null) return const SizedBox.shrink();

    final channels = channelsAsync.valueOrNull ?? [];
    Channel? activeChannel;
    try {
      activeChannel = channels.firstWhere(
        (c) => c.id == activeId && c.kind == ChannelKind.voice,
      );
    } catch (_) {
      activeChannel = null;
    }

    if (activeChannel == null) return const SizedBox.shrink();

    final participants = voiceParticipants[activeId] ?? [];
    if (participants.isEmpty) return const SizedBox.shrink();

    return Container(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.gray5)),
        color: AppColors.gray2,
      ),
      padding: const EdgeInsets.all(AppSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.volume_up_rounded,
                  size: 14, color: AppColors.success),
              const SizedBox(width: AppSpacing.xs),
              Expanded(
                child: Text(
                  activeChannel.name,
                  style:
                      AppTextStyles.labelSm.copyWith(color: AppColors.success),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          ...participants.map(
            (username) => Padding(
              padding: const EdgeInsets.only(
                  left: AppSpacing.sm, bottom: 2),
              child: Text(
                username,
                style: AppTextStyles.bodySm.copyWith(color: AppColors.gray10),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---- User bar --------------------------------------------------------------

class _UserBar extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authStateProvider).valueOrNull;
    final username = authState?.username ?? '';

    return Container(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.gray5)),
        color: AppColors.gray2,
      ),
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: AppSpacing.xs,
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 14,
            backgroundColor: AppColors.accentSubtle,
            child: Text(
              username.isNotEmpty ? username[0].toUpperCase() : '?',
              style:
                  AppTextStyles.labelSm.copyWith(color: AppColors.accent),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              username,
              style: AppTextStyles.labelMd.copyWith(color: AppColors.gray12),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          IconButton(
            icon: const Icon(Icons.mic_rounded, size: 18),
            color: AppColors.gray9,
            tooltip: 'Toggle mute',
            onPressed: () {
              // Mute toggling handled by voice state in a later unit
            },
          ),
          IconButton(
            icon: const Icon(Icons.settings_rounded, size: 18),
            color: AppColors.gray9,
            tooltip: 'Settings',
            onPressed: () => context.go('/settings'),
          ),
        ],
      ),
    );
  }
}
