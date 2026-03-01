import 'package:flutter/services.dart';
import 'package:flutter/material.dart';

import '../../core/models.dart';
import '../../theme/app_theme.dart';

/// Positioned popup menu for a message.
/// Shows Edit and Delete for own messages, React and Copy for all messages.
/// Delete is also available for operators.
class MessageContextMenu extends StatelessWidget {
  const MessageContextMenu({
    super.key,
    required this.message,
    required this.currentUsername,
    required this.isOperator,
    required this.onDismiss,
    this.onEdit,
    this.onDelete,
    this.onReact,
  });

  final Message message;
  final String currentUsername;
  final bool isOperator;
  final VoidCallback onDismiss;
  final VoidCallback? onEdit;
  final VoidCallback? onDelete;
  final VoidCallback? onReact;

  bool get _isOwnMessage => message.authorUsername == currentUsername;
  bool get _canEdit => _isOwnMessage;
  bool get _canDelete => _isOwnMessage || isOperator;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onDismiss,
      behavior: HitTestBehavior.opaque,
      child: Stack(
        children: [
          Positioned(
            // Anchor near top-right of the triggering widget.
            // Callers may wrap in a LayoutBuilder to compute exact position.
            right: AppSpacing.md,
            top: AppSpacing.md,
            child: _MenuCard(
              items: [
                if (_canEdit)
                  _MenuItem(
                    icon: Icons.edit_rounded,
                    label: 'Edit',
                    onTap: () {
                      onDismiss();
                      onEdit?.call();
                    },
                  ),
                if (_canDelete)
                  _MenuItem(
                    icon: Icons.delete_outline_rounded,
                    label: 'Delete',
                    color: AppColors.danger,
                    onTap: () {
                      onDismiss();
                      onDelete?.call();
                    },
                  ),
                _MenuItem(
                  icon: Icons.add_reaction_outlined,
                  label: 'React',
                  onTap: () {
                    onDismiss();
                    onReact?.call();
                  },
                ),
                _MenuItem(
                  icon: Icons.copy_rounded,
                  label: 'Copy text',
                  onTap: () {
                    Clipboard.setData(ClipboardData(text: message.content));
                    onDismiss();
                  },
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MenuCard extends StatelessWidget {
  const _MenuCard({required this.items});

  final List<_MenuItem> items;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: Container(
        constraints: const BoxConstraints(minWidth: 160),
        decoration: BoxDecoration(
          color: AppColors.gray4,
          borderRadius: BorderRadius.all(AppRadius.lg),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.3),
              blurRadius: 12,
              offset: const Offset(0, 4),
            ),
          ],
          border: Border.all(color: AppColors.gray6),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.all(AppRadius.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: items,
          ),
        ),
      ),
    );
  }
}

class _MenuItem extends StatefulWidget {
  const _MenuItem({
    required this.icon,
    required this.label,
    required this.onTap,
    this.color,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color? color;

  @override
  State<_MenuItem> createState() => _MenuItemState();
}

class _MenuItemState extends State<_MenuItem> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final color = widget.color ?? AppColors.gray12;

    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: GestureDetector(
        onTap: widget.onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 100),
          color: _hovered ? AppColors.gray5 : Colors.transparent,
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
            vertical: AppSpacing.sm + 2,
          ),
          child: Row(
            children: [
              Icon(widget.icon, size: 15, color: color),
              const SizedBox(width: AppSpacing.sm),
              Text(
                widget.label,
                style: AppTextStyles.bodyMd.copyWith(color: color),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
