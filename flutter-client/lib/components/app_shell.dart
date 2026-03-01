import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

const _sidebarWidth = 260.0;
const _memberListWidth = 240.0;
const _mobileBreakpoint = 700.0;

/// Three-panel app shell: sidebar | content | member list.
///
/// On mobile (width < 700px) only the main content is shown,
/// with a bottom navigation bar for navigation.
class AppShell extends StatelessWidget {
  const AppShell({
    super.key,
    required this.sidebar,
    required this.content,
    required this.memberList,
  });

  final Widget sidebar;
  final Widget content;
  final Widget memberList;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isMobile = constraints.maxWidth < _mobileBreakpoint;

        if (isMobile) {
          return _MobileShell(
            sidebar: sidebar,
            content: content,
            memberList: memberList,
          );
        }

        return _DesktopShell(
          sidebar: sidebar,
          content: content,
          memberList: memberList,
        );
      },
    );
  }
}

class _DesktopShell extends StatelessWidget {
  const _DesktopShell({
    required this.sidebar,
    required this.content,
    required this.memberList,
  });

  final Widget sidebar;
  final Widget content;
  final Widget memberList;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.gray1,
      body: Row(
        children: [
          SizedBox(
            width: _sidebarWidth,
            child: ColoredBox(
              color: AppColors.gray3,
              child: sidebar,
            ),
          ),
          Expanded(
            child: ColoredBox(
              color: AppColors.gray1,
              child: content,
            ),
          ),
          SizedBox(
            width: _memberListWidth,
            child: ColoredBox(
              color: AppColors.gray3,
              child: memberList,
            ),
          ),
        ],
      ),
    );
  }
}

class _MobileShell extends StatefulWidget {
  const _MobileShell({
    required this.sidebar,
    required this.content,
    required this.memberList,
  });

  final Widget sidebar;
  final Widget content;
  final Widget memberList;

  @override
  State<_MobileShell> createState() => _MobileShellState();
}

class _MobileShellState extends State<_MobileShell> {
  int _selectedIndex = 1; // default to content

  @override
  Widget build(BuildContext context) {
    final panels = [
      widget.sidebar,
      widget.content,
      widget.memberList,
    ];

    return Scaffold(
      backgroundColor: AppColors.gray1,
      body: IndexedStack(
        index: _selectedIndex,
        children: panels,
      ),
      bottomNavigationBar: _MobileNavBar(
        selectedIndex: _selectedIndex,
        onTap: (i) => setState(() => _selectedIndex = i),
      ),
    );
  }
}

class _MobileNavBar extends StatelessWidget {
  const _MobileNavBar({
    required this.selectedIndex,
    required this.onTap,
  });

  final int selectedIndex;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.gray3,
        border: Border(top: BorderSide(color: AppColors.gray5)),
      ),
      child: SafeArea(
        child: SizedBox(
          height: 56,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _NavItem(
                icon: Icons.tag_rounded,
                label: 'Channels',
                selected: selectedIndex == 0,
                onTap: () => onTap(0),
              ),
              _NavItem(
                icon: Icons.chat_bubble_outline_rounded,
                label: 'Chat',
                selected: selectedIndex == 1,
                onTap: () => onTap(1),
              ),
              _NavItem(
                icon: Icons.people_outline_rounded,
                label: 'Members',
                selected: selectedIndex == 2,
                onTap: () => onTap(2),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected ? AppColors.accent : AppColors.gray9;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.all(AppRadius.md),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.lg,
          vertical: AppSpacing.sm,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: color, size: 22),
            const SizedBox(height: 2),
            Text(
              label,
              style: AppTextStyles.labelSm.copyWith(color: color),
            ),
          ],
        ),
      ),
    );
  }
}
