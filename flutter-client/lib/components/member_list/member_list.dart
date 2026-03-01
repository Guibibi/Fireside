import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/ws_messages.dart';
import '../../api/ws_client.dart';
import '../../core/models.dart';
import '../../state/voice.dart';
import '../../theme/app_theme.dart';
import '../overlays/user_avatar.dart';
import '../overlays/user_profile_modal.dart';

/// Right-hand member list sidebar.
/// Groups members: voice participants first, then online, then offline.
/// Clicking a member opens a [UserProfileModal].
class MemberList extends ConsumerWidget {
  const MemberList({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final presenceState = ref.watch(_presenceProvider);
    final voiceAsync = ref.watch(voiceStateProvider);
    final voiceParticipants = voiceAsync.valueOrNull?.participants ?? {};

    final List<_MemberEntry> voiceEntries = [];
    final List<_MemberEntry> onlineEntries = [];
    final List<_MemberEntry> offlineEntries = [];

    for (final entry in presenceState.entries) {
      final username = entry.key;
      final status = entry.value;
      final vp = voiceParticipants[username];

      final memberEntry = _MemberEntry(
        username: username,
        status: status,
        voiceParticipant: vp,
      );

      if (vp != null) {
        voiceEntries.add(memberEntry);
      } else if (status == 'online') {
        onlineEntries.add(memberEntry);
      } else {
        offlineEntries.add(memberEntry);
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.md,
            AppSpacing.md,
            AppSpacing.md,
            AppSpacing.sm,
          ),
          child: Text(
            'Members',
            style: AppTextStyles.headingSm.copyWith(color: AppColors.gray9),
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            children: [
              if (voiceEntries.isNotEmpty) ...[
                _SectionHeader(
                  label: 'In Voice — ${voiceEntries.length}',
                  icon: Icons.volume_up_rounded,
                  color: AppColors.success,
                ),
                ...voiceEntries.map((e) => _MemberTile(entry: e)),
                const SizedBox(height: AppSpacing.sm),
              ],
              if (onlineEntries.isNotEmpty) ...[
                _SectionHeader(label: 'Online — ${onlineEntries.length}'),
                ...onlineEntries.map((e) => _MemberTile(entry: e)),
                const SizedBox(height: AppSpacing.sm),
              ],
              if (offlineEntries.isNotEmpty) ...[
                _SectionHeader(
                  label: 'Offline — ${offlineEntries.length}',
                  color: AppColors.gray8,
                ),
                ...offlineEntries.map((e) => _MemberTile(entry: e)),
              ],
              if (presenceState.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(AppSpacing.xl),
                  child: Text(
                    'No members',
                    style: AppTextStyles.bodySm.copyWith(color: AppColors.gray8),
                    textAlign: TextAlign.center,
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

// ---- Presence provider -----------------------------------------------------

final _presenceProvider = StateProvider<Map<String, String>>((ref) {
  ref.listen(wsMessageStreamProvider, (_, next) {
    next.whenData((msg) {
      final current = ref.controller.state;
      switch (msg) {
        case PresenceSnapshotMsg(:final users):
          ref.controller.state = {
            for (final u in users) u.username: u.status,
          };

        case UserConnectedMsg(:final username, :final status):
          ref.controller.state = {...current, username: status};

        case UserStatusChangedMsg(:final username, :final status):
          ref.controller.state = {...current, username: status};

        case UserDisconnectedMsg(:final username):
          ref.controller.state = {...current, username: 'offline'};

        default:
          break;
      }
    });
  });
  return {};
});

// ---- Internal models -------------------------------------------------------

class _MemberEntry {
  const _MemberEntry({
    required this.username,
    required this.status,
    this.voiceParticipant,
    this.displayName,
    this.avatarUrl,
  });

  final String username;
  final String status;
  final VoiceParticipant? voiceParticipant;
  final String? displayName;
  final String? avatarUrl;
}

// ---- Widgets ---------------------------------------------------------------

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.label,
    this.icon,
    this.color,
  });

  final String label;
  final IconData? icon;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final textColor = color ?? AppColors.gray9;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.xs,
        AppSpacing.md,
        AppSpacing.xs,
      ),
      child: Row(
        children: [
          if (icon != null) ...[
            Icon(icon, size: 12, color: textColor),
            const SizedBox(width: AppSpacing.xs),
          ],
          Text(
            label.toUpperCase(),
            style: AppTextStyles.headingSm.copyWith(color: textColor),
          ),
        ],
      ),
    );
  }
}

class _MemberTile extends StatelessWidget {
  const _MemberTile({super.key, required this.entry});

  final _MemberEntry entry;

  @override
  Widget build(BuildContext context) {
    final vp = entry.voiceParticipant;
    final isOnline = entry.status == 'online' || vp != null;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 1),
      child: InkWell(
        onTap: () => showDialog(
          context: context,
          builder: (_) => UserProfileModal(username: entry.username),
        ),
        borderRadius: BorderRadius.all(AppRadius.sm),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.sm,
            vertical: AppSpacing.xs + 2,
          ),
          child: Row(
            children: [
              _AvatarWithSpeaking(
                username: entry.username,
                avatarUrl: entry.avatarUrl,
                displayName: entry.displayName,
                speaking: vp?.speaking ?? false,
                isOnline: isOnline,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  entry.displayName ?? entry.username,
                  style: AppTextStyles.bodyMd.copyWith(
                    color: isOnline ? AppColors.gray12 : AppColors.gray8,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (vp != null) ...[
                if (vp.muteState.micMuted)
                  const Padding(
                    padding: EdgeInsets.only(left: AppSpacing.xs),
                    child: Icon(
                      Icons.mic_off_rounded,
                      size: 14,
                      color: AppColors.danger,
                    ),
                  )
                else if (vp.speaking)
                  const Padding(
                    padding: EdgeInsets.only(left: AppSpacing.xs),
                    child: Icon(
                      Icons.graphic_eq_rounded,
                      size: 14,
                      color: AppColors.success,
                    ),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _AvatarWithSpeaking extends StatelessWidget {
  const _AvatarWithSpeaking({
    required this.username,
    required this.speaking,
    required this.isOnline,
    this.avatarUrl,
    this.displayName,
  });

  final String username;
  final String? avatarUrl;
  final String? displayName;
  final bool speaking;
  final bool isOnline;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 150),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(
          color: speaking ? AppColors.success : Colors.transparent,
          width: 2,
        ),
      ),
      child: UserAvatar(
        username: username,
        avatarUrl: avatarUrl,
        displayName: displayName,
        size: 30,
        showOnlineIndicator: true,
        isOnline: isOnline,
      ),
    );
  }
}
