import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/http_client.dart';
import '../../core/models.dart';
import '../../theme/app_theme.dart';
import 'user_avatar.dart';

/// Modal that shows a user's public profile: avatar, display name,
/// username, description, status, and online indicator.
class UserProfileModal extends ConsumerWidget {
  const UserProfileModal({super.key, required this.username});

  final String username;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Dialog(
      backgroundColor: AppColors.gray3,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(AppRadius.xl),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 360),
        child: _ProfileContent(username: username),
      ),
    );
  }
}

class _ProfileContent extends ConsumerWidget {
  const _ProfileContent({required this.username});

  final String username;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Use FutureProvider pattern inline
    final futureProvider = FutureProvider.autoDispose<User>((ref) async {
      final raw = await ref.read(httpClientProvider).getUserProfile(username);
      return User.fromJson(raw);
    });

    final userAsync = ref.watch(futureProvider);

    return userAsync.when(
      loading: () => const SizedBox(
        height: 200,
        child: Center(
          child: CircularProgressIndicator(color: AppColors.accent),
        ),
      ),
      error: (e, _) => Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline_rounded,
                color: AppColors.danger, size: 32),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'Could not load profile',
              style: AppTextStyles.bodyMd.copyWith(color: AppColors.gray10),
            ),
          ],
        ),
      ),
      data: (user) => _ProfileBody(user: user),
    );
  }
}

class _ProfileBody extends StatelessWidget {
  const _ProfileBody({required this.user});

  final User user;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Header — accent-tinted banner area
        Container(
          height: 80,
          decoration: const BoxDecoration(
            color: AppColors.accentSubtle,
            borderRadius: BorderRadius.only(
              topLeft: AppRadius.xl,
              topRight: AppRadius.xl,
            ),
          ),
        ),

        // Avatar overlapping the banner
        Transform.translate(
          offset: const Offset(0, -28),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Container(
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.gray3, width: 4),
                  ),
                  child: UserAvatar(
                    username: user.username,
                    avatarUrl: user.avatarUrl,
                    displayName: user.displayName,
                    size: 72,
                    showOnlineIndicator: false,
                  ),
                ),
                const Spacer(),
                if (user.role == 'operator')
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.sm,
                      vertical: AppSpacing.xs,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.accentSubtle,
                      borderRadius: BorderRadius.all(AppRadius.sm),
                      border: Border.all(color: AppColors.accent),
                    ),
                    child: Text(
                      'Operator',
                      style: AppTextStyles.labelSm.copyWith(
                        color: AppColors.accent,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),

        // Name + username
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.xl,
            0,
            AppSpacing.xl,
            0,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(user.displayName, style: AppTextStyles.headingLg),
              const SizedBox(height: 2),
              Text(
                '@${user.username}',
                style: AppTextStyles.bodyMd.copyWith(color: AppColors.gray9),
              ),

              if (user.profileStatus != null && user.profileStatus!.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.sm),
                Row(
                  children: [
                    const Icon(
                      Icons.circle,
                      size: 8,
                      color: AppColors.success,
                    ),
                    const SizedBox(width: AppSpacing.xs),
                    Expanded(
                      child: Text(
                        user.profileStatus!,
                        style: AppTextStyles.bodySm.copyWith(
                          color: AppColors.gray10,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ],

              if (user.profileDescription != null &&
                  user.profileDescription!.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.md),
                const Divider(color: AppColors.gray5),
                const SizedBox(height: AppSpacing.md),
                Text(
                  'About me',
                  style: AppTextStyles.headingSm.copyWith(
                    color: AppColors.gray9,
                  ),
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  user.profileDescription!,
                  style: AppTextStyles.bodyMd.copyWith(color: AppColors.gray11),
                ),
              ],

              const SizedBox(height: AppSpacing.xl),
            ],
          ),
        ),
      ],
    );
  }
}
