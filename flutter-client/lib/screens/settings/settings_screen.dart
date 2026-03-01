import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../theme/app_theme.dart';
import 'audio_video_settings.dart';
import 'profile_settings.dart';

// ---- Provider --------------------------------------------------------------

final _settingsCategoryProvider = StateProvider<_SettingsCategory>(
  (_) => _SettingsCategory.profile,
);

// ---- Model -----------------------------------------------------------------

enum _SettingsCategory { profile, audioVideo, notifications, appearance }

extension _SettingsCategoryLabel on _SettingsCategory {
  String get label {
    switch (this) {
      case _SettingsCategory.profile:
        return 'Profile';
      case _SettingsCategory.audioVideo:
        return 'Audio / Video';
      case _SettingsCategory.notifications:
        return 'Notifications';
      case _SettingsCategory.appearance:
        return 'Appearance';
    }
  }

  IconData get icon {
    switch (this) {
      case _SettingsCategory.profile:
        return Icons.person_outline_rounded;
      case _SettingsCategory.audioVideo:
        return Icons.headset_rounded;
      case _SettingsCategory.notifications:
        return Icons.notifications_none_rounded;
      case _SettingsCategory.appearance:
        return Icons.palette_outlined;
    }
  }
}

// ---- Screen ----------------------------------------------------------------

/// Main settings screen with a sidebar category nav and a content pane.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      backgroundColor: AppColors.gray1,
      body: LayoutBuilder(
        builder: (context, constraints) {
          final narrow = constraints.maxWidth < 600;
          if (narrow) {
            return _MobileSettings();
          }
          return _DesktopSettings();
        },
      ),
    );
  }
}

// ---- Desktop layout --------------------------------------------------------

class _DesktopSettings extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Row(
      children: [
        // Sidebar
        SizedBox(
          width: 220,
          child: Container(
            color: AppColors.gray3,
            child: _SettingsSidebar(),
          ),
        ),
        // Content
        const Expanded(
          child: _SettingsContent(),
        ),
      ],
    );
  }
}

// ---- Mobile layout ---------------------------------------------------------

class _MobileSettings extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final current = ref.watch(_settingsCategoryProvider);
    return Column(
      children: [
        // Top nav row
        Container(
          color: AppColors.gray3,
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.sm,
            vertical: AppSpacing.xs,
          ),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: _SettingsCategory.values.map((cat) {
                final selected = cat == current;
                return Padding(
                  padding: const EdgeInsets.only(right: AppSpacing.xs),
                  child: _CategoryChip(category: cat, selected: selected),
                );
              }).toList(),
            ),
          ),
        ),
        const Expanded(child: _SettingsContent()),
      ],
    );
  }
}

class _CategoryChip extends ConsumerWidget {
  const _CategoryChip({required this.category, required this.selected});

  final _SettingsCategory category;
  final bool selected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return InkWell(
      onTap: () =>
          ref.read(_settingsCategoryProvider.notifier).state = category,
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
          category.label,
          style: AppTextStyles.labelMd.copyWith(
            color: selected ? AppColors.accent : AppColors.gray9,
          ),
        ),
      ),
    );
  }
}

// ---- Sidebar ---------------------------------------------------------------

class _SettingsSidebar extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final current = ref.watch(_settingsCategoryProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Header
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg,
            AppSpacing.xl,
            AppSpacing.lg,
            AppSpacing.md,
          ),
          child: Text('Settings', style: AppTextStyles.displaySm),
        ),

        // Category list
        ..._SettingsCategory.values.map((cat) => _SidebarItem(
              category: cat,
              selected: cat == current,
            )),
      ],
    );
  }
}

class _SidebarItem extends ConsumerWidget {
  const _SidebarItem({required this.category, required this.selected});

  final _SettingsCategory category;
  final bool selected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: 1,
      ),
      child: InkWell(
        onTap: () =>
            ref.read(_settingsCategoryProvider.notifier).state = category,
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
                category.icon,
                size: 16,
                color: selected ? AppColors.accent : AppColors.gray9,
              ),
              const SizedBox(width: AppSpacing.sm),
              Text(
                category.label,
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

class _SettingsContent extends ConsumerWidget {
  const _SettingsContent();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final current = ref.watch(_settingsCategoryProvider);

    return switch (current) {
      _SettingsCategory.profile => const ProfileSettings(),
      _SettingsCategory.audioVideo => const AudioVideoSettings(),
      _SettingsCategory.notifications => const _NotificationsSettings(),
      _SettingsCategory.appearance => const _AppearanceSettings(),
    };
  }
}

// ---- Stub pages for not-yet-built categories --------------------------------

class _NotificationsSettings extends ConsumerWidget {
  const _NotificationsSettings();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Notifications', style: AppTextStyles.displaySm),
          const SizedBox(height: AppSpacing.xl),
          Text(
            'Notification preferences',
            style: AppTextStyles.headingMd,
          ),
          const SizedBox(height: AppSpacing.md),
          _SettingsRow(
            label: 'Enable notifications',
            child: Switch(
              value: true,
              onChanged: (_) {},
            ),
          ),
          _SettingsRow(
            label: 'Mention notifications',
            child: Switch(
              value: true,
              onChanged: (_) {},
            ),
          ),
          _SettingsRow(
            label: 'DM notifications',
            child: Switch(
              value: true,
              onChanged: (_) {},
            ),
          ),
        ],
      ),
    );
  }
}

class _AppearanceSettings extends StatelessWidget {
  const _AppearanceSettings();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Appearance', style: AppTextStyles.displaySm),
          const SizedBox(height: AppSpacing.xl),
          Text(
            'Fireside uses a warm dark theme. Additional appearance settings coming soon.',
            style: AppTextStyles.bodyMd.copyWith(color: AppColors.gray10),
          ),
        ],
      ),
    );
  }
}

// ---- Shared utility widget -------------------------------------------------

class _SettingsRow extends StatelessWidget {
  const _SettingsRow({required this.label, required this.child});

  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
      child: Row(
        children: [
          Expanded(
            child: Text(label, style: AppTextStyles.bodyMd),
          ),
          child,
        ],
      ),
    );
  }
}
