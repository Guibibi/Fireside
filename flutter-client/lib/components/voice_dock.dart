import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/models.dart';
import '../state/voice.dart';
import '../theme/app_theme.dart';
import 'overlays/user_avatar.dart';

/// Bottom bar shown inside the sidebar when the user is in a voice channel.
/// Displays channel name, participant avatars with speaking indicators,
/// mic/speaker toggles, and a leave button.
class VoiceDock extends ConsumerWidget {
  const VoiceDock({super.key, required this.channelName});

  final String channelName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final voiceAsync = ref.watch(voiceStateProvider);

    return voiceAsync.when(
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
      data: (voice) {
        if (!voice.inChannel) return const SizedBox.shrink();
        return _VoiceDockContent(voice: voice, channelName: channelName);
      },
    );
  }
}

class _VoiceDockContent extends ConsumerWidget {
  const _VoiceDockContent({
    required this.voice,
    required this.channelName,
  });

  final VoiceState voice;
  final String channelName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.gray2,
        border: Border(top: BorderSide(color: AppColors.gray5)),
      ),
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Channel name + connection indicator
          Row(
            children: [
              const Icon(
                Icons.volume_up_rounded,
                size: 14,
                color: AppColors.success,
              ),
              const SizedBox(width: AppSpacing.xs),
              Expanded(
                child: Text(
                  channelName,
                  style: AppTextStyles.labelSm.copyWith(color: AppColors.success),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Text(
                'Connected',
                style: AppTextStyles.labelSm.copyWith(color: AppColors.gray9),
              ),
            ],
          ),

          // Participant avatars
          if (voice.participants.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            _ParticipantAvatarRow(participants: voice.participants),
          ],

          const SizedBox(height: AppSpacing.sm),

          // Controls row
          Row(
            children: [
              // Mic toggle
              _DockIconButton(
                icon: voice.micMuted
                    ? Icons.mic_off_rounded
                    : Icons.mic_rounded,
                color: voice.micMuted ? AppColors.danger : AppColors.gray10,
                tooltip: voice.micMuted ? 'Unmute mic' : 'Mute mic',
                onTap: () => ref.read(voiceStateProvider.notifier).toggleMic(),
              ),

              const SizedBox(width: AppSpacing.xs),

              // Speaker toggle
              _DockIconButton(
                icon: voice.speakerMuted
                    ? Icons.volume_off_rounded
                    : Icons.volume_up_rounded,
                color: voice.speakerMuted ? AppColors.danger : AppColors.gray10,
                tooltip: voice.speakerMuted ? 'Unmute speaker' : 'Mute speaker',
                onTap: () => ref.read(voiceStateProvider.notifier).toggleSpeaker(),
              ),

              const Spacer(),

              // Leave button
              Tooltip(
                message: 'Leave voice channel',
                child: InkWell(
                  onTap: () => ref.read(voiceStateProvider.notifier).leaveChannel(),
                  borderRadius: BorderRadius.all(AppRadius.sm),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.sm,
                      vertical: AppSpacing.xs,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.dangerBg,
                      borderRadius: BorderRadius.all(AppRadius.sm),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.call_end_rounded,
                          size: 14,
                          color: AppColors.danger,
                        ),
                        const SizedBox(width: AppSpacing.xs),
                        Text(
                          'Leave',
                          style: AppTextStyles.labelSm.copyWith(
                            color: AppColors.danger,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ParticipantAvatarRow extends StatelessWidget {
  const _ParticipantAvatarRow({required this.participants});

  final Map<String, VoiceParticipant> participants;

  @override
  Widget build(BuildContext context) {
    final list = participants.values.toList();
    const maxVisible = 6;
    final visible = list.take(maxVisible).toList();
    final overflow = list.length - maxVisible;

    return Row(
      children: [
        ...visible.map((p) => Padding(
          padding: const EdgeInsets.only(right: AppSpacing.xs),
          child: _SpeakingAvatarWrapper(participant: p),
        )),
        if (overflow > 0)
          Container(
            width: 26,
            height: 26,
            decoration: const BoxDecoration(
              color: AppColors.gray5,
              shape: BoxShape.circle,
            ),
            child: Center(
              child: Text(
                '+$overflow',
                style: AppTextStyles.labelSm.copyWith(
                  fontSize: 10,
                  color: AppColors.gray10,
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _SpeakingAvatarWrapper extends StatelessWidget {
  const _SpeakingAvatarWrapper({required this.participant});

  final VoiceParticipant participant;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(
          color: participant.speaking
              ? AppColors.success
              : Colors.transparent,
          width: 2,
        ),
      ),
      child: UserAvatar(
        username: participant.username,
        avatarUrl: participant.avatarUrl,
        displayName: participant.displayName,
        size: 24,
      ),
    );
  }
}

class _DockIconButton extends StatelessWidget {
  const _DockIconButton({
    required this.icon,
    required this.color,
    required this.tooltip,
    required this.onTap,
  });

  final IconData icon;
  final Color color;
  final String tooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.all(AppRadius.sm),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xs),
          child: Icon(icon, size: 18, color: color),
        ),
      ),
    );
  }
}
