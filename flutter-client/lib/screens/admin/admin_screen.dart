import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../state/auth.dart';
import '../../theme/app_theme.dart';
import 'emoji_settings.dart';
import 'invite_settings.dart';

// ---- Provider --------------------------------------------------------------

final _adminTabProvider = StateProvider<_AdminTab>((_) => _AdminTab.invites);

// ---- Model -----------------------------------------------------------------

enum _AdminTab { invites, emojis, serverSettings }

extension _AdminTabLabel on _AdminTab {
  String get label {
    switch (this) {
      case _AdminTab.invites:
        return 'Invites';
      case _AdminTab.emojis:
        return 'Custom Emojis';
      case _AdminTab.serverSettings:
        return 'Server Settings';
    }
  }

  IconData get icon {
    switch (this) {
      case _AdminTab.invites:
        return Icons.link_rounded;
      case _AdminTab.emojis:
        return Icons.emoji_emotions_outlined;
      case _AdminTab.serverSettings:
        return Icons.settings_outlined;
    }
  }
}

// ---- Screen ----------------------------------------------------------------

/// Admin panel — only visible to operators.
/// If the current user is not an operator, shows an access-denied message.
class AdminScreen extends ConsumerWidget {
  const AdminScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authAsync = ref.watch(authStateProvider);

    return authAsync.when(
      loading: () => const Scaffold(
        backgroundColor: AppColors.gray1,
        body: Center(
          child: CircularProgressIndicator(color: AppColors.accent),
        ),
      ),
      error: (_, __) => const _AccessDenied(),
      data: (auth) {
        if (!auth.isOperator) return const _AccessDenied();
        return const _AdminLayout();
      },
    );
  }
}

// ---- Access denied ---------------------------------------------------------

class _AccessDenied extends StatelessWidget {
  const _AccessDenied();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.gray1,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.lock_outline_rounded, size: 48, color: AppColors.gray7),
            const SizedBox(height: AppSpacing.md),
            Text('Access Denied', style: AppTextStyles.headingLg),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'You must be an operator to access the admin panel.',
              style: AppTextStyles.bodyMd.copyWith(color: AppColors.gray9),
            ),
          ],
        ),
      ),
    );
  }
}

// ---- Admin layout ----------------------------------------------------------

class _AdminLayout extends ConsumerWidget {
  const _AdminLayout();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final narrow = constraints.maxWidth < 640;
        if (narrow) {
          return _MobileAdminLayout();
        }
        return _DesktopAdminLayout();
      },
    );
  }
}

class _DesktopAdminLayout extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      backgroundColor: AppColors.gray1,
      body: Row(
        children: [
          SizedBox(
            width: 220,
            child: Container(
              color: AppColors.gray3,
              child: _AdminSidebar(),
            ),
          ),
          Expanded(
            child: _AdminContent(),
          ),
        ],
      ),
    );
  }
}

class _MobileAdminLayout extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      backgroundColor: AppColors.gray1,
      appBar: AppBar(
        backgroundColor: AppColors.gray2,
        title: Text('Admin', style: AppTextStyles.headingMd),
      ),
      body: Column(
        children: [
          Container(
            color: AppColors.gray3,
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.sm,
              vertical: AppSpacing.xs,
            ),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: _AdminTab.values.map((tab) {
                  final selected =
                      ref.watch(_adminTabProvider) == tab;
                  return Padding(
                    padding: const EdgeInsets.only(right: AppSpacing.xs),
                    child: _TabChip(tab: tab, selected: selected),
                  );
                }).toList(),
              ),
            ),
          ),
          Expanded(child: _AdminContent()),
        ],
      ),
    );
  }
}

class _TabChip extends ConsumerWidget {
  const _TabChip({required this.tab, required this.selected});

  final _AdminTab tab;
  final bool selected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return InkWell(
      onTap: () => ref.read(_adminTabProvider.notifier).state = tab,
      borderRadius: BorderRadius.all(AppRadius.md),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 120),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.xs,
        ),
        decoration: BoxDecoration(
          color: selected ? AppColors.accentSubtle : Colors.transparent,
          borderRadius: BorderRadius.all(AppRadius.md),
        ),
        child: Text(
          tab.label,
          style: AppTextStyles.labelMd.copyWith(
            color: selected ? AppColors.accent : AppColors.gray9,
          ),
        ),
      ),
    );
  }
}

// ---- Sidebar ---------------------------------------------------------------

class _AdminSidebar extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final current = ref.watch(_adminTabProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg,
            AppSpacing.xl,
            AppSpacing.lg,
            AppSpacing.md,
          ),
          child: Text('Admin', style: AppTextStyles.displaySm),
        ),
        ..._AdminTab.values.map((tab) => _SidebarItem(
              tab: tab,
              selected: tab == current,
            )),
      ],
    );
  }
}

class _SidebarItem extends ConsumerWidget {
  const _SidebarItem({required this.tab, required this.selected});

  final _AdminTab tab;
  final bool selected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: 1,
      ),
      child: InkWell(
        onTap: () => ref.read(_adminTabProvider.notifier).state = tab,
        borderRadius: BorderRadius.all(AppRadius.md),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 120),
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
            vertical: AppSpacing.sm,
          ),
          decoration: BoxDecoration(
            color: selected ? AppColors.gray4 : Colors.transparent,
            borderRadius: BorderRadius.all(AppRadius.md),
          ),
          child: Row(
            children: [
              Icon(
                tab.icon,
                size: 16,
                color: selected ? AppColors.accent : AppColors.gray9,
              ),
              const SizedBox(width: AppSpacing.sm),
              Text(
                tab.label,
                style: AppTextStyles.labelMd.copyWith(
                  color: selected ? AppColors.gray12 : AppColors.gray9,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---- Content pane ----------------------------------------------------------

class _AdminContent extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tab = ref.watch(_adminTabProvider);

    return switch (tab) {
      _AdminTab.invites => const InviteSettings(),
      _AdminTab.emojis => const EmojiSettings(),
      _AdminTab.serverSettings => const _ServerSettingsPage(),
    };
  }
}

// ---- Server settings (stub) ------------------------------------------------

class _ServerSettingsPage extends StatelessWidget {
  const _ServerSettingsPage();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Server Settings', style: AppTextStyles.displaySm),
          const SizedBox(height: AppSpacing.xl),
          Text(
            'Server-wide configuration options coming soon.',
            style: AppTextStyles.bodyMd.copyWith(color: AppColors.gray9),
          ),
        ],
      ),
    );
  }
}
