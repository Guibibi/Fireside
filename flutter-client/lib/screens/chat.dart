import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../components/app_shell.dart';
import '../components/channel_list/channel_list.dart';
import '../components/member_list/member_list.dart';
import '../components/message_composer/message_composer.dart';
import '../components/message_timeline/message_timeline.dart';
import '../core/models.dart';
import '../state/channels.dart';
import '../theme/app_theme.dart';

/// Main chat screen. Shows the three-panel app shell.
///
/// [channelId] is optional — if null, a welcome placeholder is shown.
class ChatScreen extends ConsumerWidget {
  const ChatScreen({super.key, this.channelId});

  final String? channelId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Keep active channel in sync with route parameter
    if (channelId != null) {
      final current = ref.read(activeChannelIdProvider);
      if (current != channelId) {
        // Schedule state update outside build
        WidgetsBinding.instance.addPostFrameCallback((_) {
          ref.read(activeChannelIdProvider.notifier).state = channelId;
        });
      }
    }

    return AppShell(
      sidebar: const ChannelList(),
      content: _ChatContent(channelId: channelId),
      memberList: const MemberList(),
    );
  }
}

// ---- Main content area -----------------------------------------------------

class _ChatContent extends StatelessWidget {
  const _ChatContent({this.channelId});

  final String? channelId;

  @override
  Widget build(BuildContext context) {
    if (channelId == null) {
      return const _NoChannelPlaceholder();
    }

    return Column(
      children: [
        _ChannelHeader(channelId: channelId!),
        Expanded(
          child: MessageTimeline(channelId: channelId!),
        ),
        MessageComposer(channelId: channelId!),
      ],
    );
  }
}

// ---- Channel header --------------------------------------------------------

class _ChannelHeader extends ConsumerWidget {
  const _ChannelHeader({required this.channelId});

  final String channelId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final channels = ref.watch(channelsProvider).valueOrNull ?? [];
    Channel? channel;
    try {
      channel = channels.firstWhere((c) => c.id == channelId);
    } catch (_) {
      channel = null;
    }

    final name = channel?.name ?? channelId;
    final description = channel?.description;

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.md,
      ),
      decoration: const BoxDecoration(
        color: AppColors.gray1,
        border: Border(bottom: BorderSide(color: AppColors.gray5)),
      ),
      child: Row(
        children: [
          const Icon(Icons.tag_rounded, size: 18, color: AppColors.gray9),
          const SizedBox(width: AppSpacing.sm),
          Text(
            name,
            style: AppTextStyles.headingMd.copyWith(color: AppColors.gray12),
          ),
          if (description != null && description.isNotEmpty) ...[
            const SizedBox(width: AppSpacing.md),
            Container(
              width: 1,
              height: 16,
              color: AppColors.gray6,
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Text(
                description,
                style:
                    AppTextStyles.bodyMd.copyWith(color: AppColors.gray9),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// ---- No channel placeholder ------------------------------------------------

class _NoChannelPlaceholder extends StatelessWidget {
  const _NoChannelPlaceholder();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: const BoxDecoration(
              color: AppColors.accentSubtle,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.local_fire_department_rounded,
              color: AppColors.accent,
              size: 36,
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          Text(
            'Welcome to Fireside',
            style:
                AppTextStyles.displaySm.copyWith(color: AppColors.gray12),
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Select a channel from the sidebar to start chatting.',
            style:
                AppTextStyles.bodyMd.copyWith(color: AppColors.gray9),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
