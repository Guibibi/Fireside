import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/http_client.dart';
import '../../theme/app_theme.dart';

// ---- Model -----------------------------------------------------------------

class _Invite {
  const _Invite({
    required this.id,
    required this.code,
    required this.createdAt,
  });

  final String id;
  final String code;
  final DateTime createdAt;

  factory _Invite.fromJson(Map<String, dynamic> json) {
    return _Invite(
      id: json['id'] as String,
      code: json['code'] as String,
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }
}

// ---- Provider --------------------------------------------------------------

final _invitesProvider = AsyncNotifierProvider<_InvitesNotifier, List<_Invite>>(
  _InvitesNotifier.new,
);

class _InvitesNotifier extends AsyncNotifier<List<_Invite>> {
  @override
  Future<List<_Invite>> build() => _fetch();

  Future<List<_Invite>> _fetch() async {
    final raw = await ref.read(httpClientProvider).getInvites();
    return raw
        .cast<Map<String, dynamic>>()
        .map(_Invite.fromJson)
        .toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
  }

  Future<void> refresh() async {
    state = AsyncData(await _fetch());
  }

  Future<void> create() async {
    final raw = await ref.read(httpClientProvider).createInvite();
    final invite = _Invite.fromJson(raw);
    final current = state.valueOrNull ?? [];
    state = AsyncData([invite, ...current]);
  }

  Future<void> delete(String inviteId) async {
    await ref.read(httpClientProvider).deleteInvite(inviteId);
    final current = state.valueOrNull ?? [];
    state = AsyncData(current.where((i) => i.id != inviteId).toList());
  }
}

// ---- Screen ----------------------------------------------------------------

class InviteSettings extends ConsumerWidget {
  const InviteSettings({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final invitesAsync = ref.watch(_invitesProvider);
    final notifier = ref.read(_invitesProvider.notifier);

    return Padding(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header row
          Row(
            children: [
              Expanded(
                child: Text('Invite Codes', style: AppTextStyles.displaySm),
              ),
              ElevatedButton.icon(
                onPressed: () => notifier.create(),
                icon: const Icon(Icons.add_rounded, size: 16),
                label: const Text('Create Invite'),
              ),
            ],
          ),

          const SizedBox(height: AppSpacing.sm),
          Text(
            'Share these codes so people can join your server.',
            style: AppTextStyles.bodyMd.copyWith(color: AppColors.gray9),
          ),

          const SizedBox(height: AppSpacing.xl),

          // List
          Expanded(
            child: invitesAsync.when(
              loading: () => const Center(
                child: CircularProgressIndicator(
                  color: AppColors.accent,
                  strokeWidth: 2,
                ),
              ),
              error: (_, __) => Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Failed to load invites',
                      style:
                          AppTextStyles.bodyMd.copyWith(color: AppColors.danger),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    TextButton(
                      onPressed: () => notifier.refresh(),
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
              data: (invites) {
                if (invites.isEmpty) {
                  return Center(
                    child: Text(
                      'No invite codes yet.\nCreate one to share with friends.',
                      style:
                          AppTextStyles.bodyMd.copyWith(color: AppColors.gray9),
                      textAlign: TextAlign.center,
                    ),
                  );
                }

                return ListView.separated(
                  itemCount: invites.length,
                  separatorBuilder: (_, __) =>
                      const Divider(color: AppColors.gray5, height: 1),
                  itemBuilder: (context, i) => _InviteRow(
                    invite: invites[i],
                    onDelete: () => _confirmDelete(
                      context,
                      notifier,
                      invites[i].id,
                      invites[i].code,
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  void _confirmDelete(
    BuildContext context,
    _InvitesNotifier notifier,
    String id,
    String code,
  ) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.gray3,
        title: Text('Delete invite?', style: AppTextStyles.headingMd),
        content: Text(
          'Code "$code" will no longer work.',
          style: AppTextStyles.bodyMd.copyWith(color: AppColors.gray10),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              notifier.delete(id);
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.danger,
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
  }
}

class _InviteRow extends StatelessWidget {
  const _InviteRow({required this.invite, required this.onDelete});

  final _Invite invite;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
      child: Row(
        children: [
          // Code in mono
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  invite.code,
                  style: AppTextStyles.codeMd,
                ),
                const SizedBox(height: 2),
                Text(
                  'Created ${_formatDate(invite.createdAt)}',
                  style: AppTextStyles.bodySm.copyWith(color: AppColors.gray9),
                ),
              ],
            ),
          ),

          // Copy button
          Tooltip(
            message: 'Copy code',
            child: IconButton(
              icon: const Icon(Icons.copy_rounded, size: 16),
              onPressed: () {
                Clipboard.setData(ClipboardData(text: invite.code));
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Copied to clipboard')),
                );
              },
              color: AppColors.gray9,
            ),
          ),

          // Delete button
          Tooltip(
            message: 'Delete invite',
            child: IconButton(
              icon: const Icon(Icons.delete_outline_rounded, size: 16),
              onPressed: onDelete,
              color: AppColors.danger,
            ),
          ),
        ],
      ),
    );
  }

  String _formatDate(DateTime dt) {
    final now = DateTime.now();
    final diff = now.difference(dt);
    if (diff.inDays == 0) return 'today';
    if (diff.inDays == 1) return 'yesterday';
    if (diff.inDays < 7) return '${diff.inDays} days ago';
    return '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')}';
  }
}
