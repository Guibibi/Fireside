import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';

/// Styled modal dialog matching Fireside's design system.
/// Use [showAppModal] to present it from any context.
class AppModal extends StatelessWidget {
  const AppModal({
    super.key,
    required this.title,
    required this.child,
    this.actions,
    this.maxWidth = 480.0,
  });

  final String title;
  final Widget child;
  final List<Widget>? actions;
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: AppColors.gray3,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(AppRadius.xl),
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Title bar
            _ModalTitleBar(title: title),

            // Content
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.xl,
                  0,
                  AppSpacing.xl,
                  AppSpacing.xl,
                ),
                child: child,
              ),
            ),

            // Footer with actions
            if (actions != null && actions!.isNotEmpty)
              _ModalFooter(actions: actions!),
          ],
        ),
      ),
    );
  }
}

class _ModalTitleBar extends StatelessWidget {
  const _ModalTitleBar({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.xl,
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
      ),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.gray5)),
        borderRadius: BorderRadius.only(
          topLeft: AppRadius.xl,
          topRight: AppRadius.xl,
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(title, style: AppTextStyles.headingLg),
          ),
          IconButton(
            icon: const Icon(Icons.close_rounded, size: 18),
            onPressed: () => Navigator.of(context).pop(),
            style: IconButton.styleFrom(
              foregroundColor: AppColors.gray9,
              padding: const EdgeInsets.all(AppSpacing.xs),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
          ),
        ],
      ),
    );
  }
}

class _ModalFooter extends StatelessWidget {
  const _ModalFooter({required this.actions});

  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.xl,
        vertical: AppSpacing.md,
      ),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.gray5)),
        borderRadius: BorderRadius.only(
          bottomLeft: AppRadius.xl,
          bottomRight: AppRadius.xl,
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          for (int i = 0; i < actions.length; i++) ...[
            if (i > 0) const SizedBox(width: AppSpacing.sm),
            actions[i],
          ],
        ],
      ),
    );
  }
}

/// Convenience helper to push [AppModal] onto the navigator.
Future<T?> showAppModal<T>(
  BuildContext context, {
  required String title,
  required Widget content,
  List<Widget>? actions,
  double maxWidth = 480.0,
}) {
  return showDialog<T>(
    context: context,
    builder: (_) => AppModal(
      title: title,
      maxWidth: maxWidth,
      actions: actions,
      child: content,
    ),
  );
}
