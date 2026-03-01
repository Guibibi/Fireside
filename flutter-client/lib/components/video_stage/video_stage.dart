import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
// flutter_webrtc is used when wiring RTCVideoRenderer per participant.
// ignore: unused_import
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../../core/models.dart';
import '../../state/voice.dart';
import '../../theme/app_theme.dart';
import '../overlays/user_avatar.dart';

/// Grid of video tiles for participants with active video streams.
/// Shown in the main content area when a voice channel is active with video.
class VideoStage extends ConsumerWidget {
  const VideoStage({super.key, required this.channelId});

  final String channelId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final voiceAsync = ref.watch(voiceStateProvider);

    return voiceAsync.when(
      loading: () => const _EmptyVideoState(),
      error: (_, __) => const _EmptyVideoState(),
      data: (voice) {
        if (voice.channelId != channelId || voice.participants.isEmpty) {
          return const _EmptyVideoState();
        }

        final participants = voice.participants.values.toList();

        return Padding(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: _VideoGrid(participants: participants),
        );
      },
    );
  }
}

class _VideoGrid extends StatelessWidget {
  const _VideoGrid({required this.participants});

  final List<VoiceParticipant> participants;

  @override
  Widget build(BuildContext context) {
    if (participants.isEmpty) return const _EmptyVideoState();

    final crossAxisCount = participants.length <= 1
        ? 1
        : participants.length <= 4
            ? 2
            : 3;

    return GridView.builder(
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: crossAxisCount,
        crossAxisSpacing: AppSpacing.sm,
        mainAxisSpacing: AppSpacing.sm,
        childAspectRatio: 16 / 9,
      ),
      itemCount: participants.length,
      itemBuilder: (context, index) {
        return _VideoTile(participant: participants[index]);
      },
    );
  }
}

class _VideoTile extends StatelessWidget {
  const _VideoTile({required this.participant});

  final VoiceParticipant participant;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.all(AppRadius.lg),
      child: Stack(
        fit: StackFit.expand,
        children: [
          // Video background
          ColoredBox(color: AppColors.gray2),

          // RTCVideoView placeholder — renderer would be wired from a map of
          // remoteRenderers keyed by username in a real integration.
          // For now we show the avatar centered on the dark background.
          Center(
            child: UserAvatar(
              username: participant.username,
              avatarUrl: participant.avatarUrl,
              displayName: participant.displayName,
              size: 64,
            ),
          ),

          // Speaking ring overlay
          if (participant.speaking)
            DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.all(AppRadius.lg),
                border: Border.all(color: AppColors.success, width: 2),
              ),
            ),

          // Bottom overlay: name + mute badge
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: Container(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.sm,
                vertical: AppSpacing.xs,
              ),
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.bottomCenter,
                  end: Alignment.topCenter,
                  colors: [Color(0xCC000000), Colors.transparent],
                ),
                borderRadius: BorderRadius.only(
                  bottomLeft: AppRadius.lg,
                  bottomRight: AppRadius.lg,
                ),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      participant.displayName ?? participant.username,
                      style: AppTextStyles.labelMd.copyWith(color: AppColors.gray12),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (participant.muteState.micMuted)
                    const Icon(
                      Icons.mic_off_rounded,
                      size: 14,
                      color: AppColors.danger,
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyVideoState extends StatelessWidget {
  const _EmptyVideoState();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.videocam_off_rounded,
            size: 48,
            color: AppColors.gray7,
          ),
          SizedBox(height: AppSpacing.sm),
          Text(
            'No video streams active',
            style: TextStyle(
              color: AppColors.gray9,
              fontSize: 14,
              fontFamily: 'Geist',
            ),
          ),
        ],
      ),
    );
  }
}
