import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../theme/app_theme.dart';

/// Dialog for selecting and starting/stopping screen sharing.
/// On desktop: lists available screen/window sources via platform channel.
/// On mobile: shows a stub message.
class ScreenShareModal extends ConsumerStatefulWidget {
  const ScreenShareModal({super.key});

  @override
  ConsumerState<ScreenShareModal> createState() => _ScreenShareModalState();
}

class _ScreenShareModalState extends ConsumerState<ScreenShareModal> {
  bool _sharing = false;
  int? _selectedSourceIndex;

  // Stub sources — a real implementation would call a platform channel
  // to enumerate DesktopCaptureSources (screens + windows).
  static const _stubSources = [
    _CaptureSource(name: 'Entire Screen', icon: Icons.monitor_rounded),
    _CaptureSource(name: 'Window: Terminal', icon: Icons.terminal_rounded),
    _CaptureSource(name: 'Window: Browser', icon: Icons.language_rounded),
    _CaptureSource(name: 'Window: Code Editor', icon: Icons.code_rounded),
  ];

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: AppColors.gray3,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(AppRadius.xl),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480, maxHeight: 520),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Title row
              Row(
                children: [
                  const Icon(
                    Icons.screen_share_rounded,
                    color: AppColors.accent,
                    size: 20,
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Text('Share Screen', style: AppTextStyles.headingMd),
                  const Spacer(),
                  IconButton(
                    icon: const Icon(Icons.close_rounded, size: 18),
                    onPressed: () => Navigator.of(context).pop(),
                    style: IconButton.styleFrom(
                      foregroundColor: AppColors.gray9,
                    ),
                  ),
                ],
              ),

              const SizedBox(height: AppSpacing.lg),

              Text(
                'Select a screen or window to share:',
                style: AppTextStyles.bodyMd.copyWith(color: AppColors.gray10),
              ),

              const SizedBox(height: AppSpacing.md),

              // Source list
              Flexible(
                child: ListView.separated(
                  shrinkWrap: true,
                  itemCount: _stubSources.length,
                  separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.xs),
                  itemBuilder: (context, index) {
                    final source = _stubSources[index];
                    final selected = _selectedSourceIndex == index;
                    return _SourceTile(
                      source: source,
                      selected: selected,
                      onTap: () => setState(() => _selectedSourceIndex = index),
                    );
                  },
                ),
              ),

              const SizedBox(height: AppSpacing.lg),

              // Action buttons
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('Cancel'),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  ElevatedButton.icon(
                    onPressed: _selectedSourceIndex == null
                        ? null
                        : _sharing
                            ? _stopSharing
                            : _startSharing,
                    icon: Icon(
                      _sharing
                          ? Icons.stop_screen_share_rounded
                          : Icons.screen_share_rounded,
                      size: 16,
                    ),
                    label: Text(_sharing ? 'Stop Sharing' : 'Start Sharing'),
                    style: _sharing
                        ? ElevatedButton.styleFrom(
                            backgroundColor: AppColors.danger,
                          )
                        : null,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _startSharing() {
    // Real implementation: call flutter_webrtc getDisplayMedia() with the
    // selected source ID from the platform channel enumeration.
    setState(() => _sharing = true);
  }

  void _stopSharing() {
    setState(() {
      _sharing = false;
      _selectedSourceIndex = null;
    });
    Navigator.of(context).pop();
  }
}

class _CaptureSource {
  const _CaptureSource({required this.name, required this.icon});

  final String name;
  final IconData icon;
}

class _SourceTile extends StatelessWidget {
  const _SourceTile({
    required this.source,
    required this.selected,
    required this.onTap,
  });

  final _CaptureSource source;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.all(AppRadius.md),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 120),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.sm,
        ),
        decoration: BoxDecoration(
          color: selected ? AppColors.accentSubtle : AppColors.gray4,
          borderRadius: BorderRadius.all(AppRadius.md),
          border: Border.all(
            color: selected ? AppColors.accent : Colors.transparent,
          ),
        ),
        child: Row(
          children: [
            // Thumbnail placeholder
            Container(
              width: 80,
              height: 50,
              decoration: BoxDecoration(
                color: AppColors.gray2,
                borderRadius: BorderRadius.all(AppRadius.sm),
              ),
              child: Icon(source.icon, color: AppColors.gray7, size: 24),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Text(
                source.name,
                style: AppTextStyles.bodyMd.copyWith(
                  color: selected ? AppColors.accent : AppColors.gray12,
                ),
              ),
            ),
            if (selected)
              const Icon(
                Icons.check_circle_rounded,
                color: AppColors.accent,
                size: 18,
              ),
          ],
        ),
      ),
    );
  }
}
