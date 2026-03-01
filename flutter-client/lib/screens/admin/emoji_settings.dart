import 'package:cached_network_image/cached_network_image.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/http_client.dart';
import '../../core/models.dart';
import '../../theme/app_theme.dart';

// ---- Provider --------------------------------------------------------------

final _emojiSettingsProvider =
    AsyncNotifierProvider<_EmojiSettingsNotifier, List<CustomEmoji>>(
  _EmojiSettingsNotifier.new,
);

class _EmojiSettingsNotifier extends AsyncNotifier<List<CustomEmoji>> {
  @override
  Future<List<CustomEmoji>> build() => _fetch();

  Future<List<CustomEmoji>> _fetch() async {
    final raw = await ref.read(httpClientProvider).getCustomEmojis();
    return raw.cast<Map<String, dynamic>>().map(CustomEmoji.fromJson).toList();
  }

  Future<void> refresh() async {
    state = AsyncData(await _fetch());
  }

  Future<void> delete(String emojiId) async {
    await ref.read(httpClientProvider).deleteEmoji(emojiId);
    final current = state.valueOrNull ?? [];
    state = AsyncData(current.where((e) => e.id != emojiId).toList());
  }

  Future<void> upload(String shortcode, List<int> bytes, String filename) async {
    final raw = await ref.read(httpClientProvider).uploadEmoji(
          shortcode: shortcode,
          bytes: bytes,
          filename: filename,
        );
    final emoji = CustomEmoji.fromJson(raw);
    final current = state.valueOrNull ?? [];
    state = AsyncData([...current, emoji]);
  }
}

// ---- Screen ----------------------------------------------------------------

class EmojiSettings extends ConsumerWidget {
  const EmojiSettings({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final emojisAsync = ref.watch(_emojiSettingsProvider);
    final notifier = ref.read(_emojiSettingsProvider.notifier);

    return Padding(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Row(
            children: [
              Expanded(
                child: Text('Custom Emojis', style: AppTextStyles.displaySm),
              ),
              ElevatedButton.icon(
                onPressed: () => _showAddDialog(context, notifier),
                icon: const Icon(Icons.add_rounded, size: 16),
                label: const Text('Add Emoji'),
              ),
            ],
          ),

          const SizedBox(height: AppSpacing.sm),
          Text(
            'Custom emojis are available to all members of the server.',
            style: AppTextStyles.bodyMd.copyWith(color: AppColors.gray9),
          ),

          const SizedBox(height: AppSpacing.xl),

          // Table header
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
            child: Row(
              children: [
                const SizedBox(width: 48),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Text(
                    'SHORTCODE',
                    style: AppTextStyles.headingSm.copyWith(
                      color: AppColors.gray9,
                    ),
                  ),
                ),
                const SizedBox(width: 80),
              ],
            ),
          ),

          const Divider(color: AppColors.gray5, height: AppSpacing.md),

          // List
          Expanded(
            child: emojisAsync.when(
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
                      'Failed to load emojis',
                      style: AppTextStyles.bodyMd.copyWith(
                        color: AppColors.danger,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    TextButton(
                      onPressed: notifier.refresh,
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
              data: (emojis) {
                if (emojis.isEmpty) {
                  return Center(
                    child: Text(
                      'No custom emojis yet.\nAdd some with the button above.',
                      style:
                          AppTextStyles.bodyMd.copyWith(color: AppColors.gray9),
                      textAlign: TextAlign.center,
                    ),
                  );
                }

                return ListView.separated(
                  itemCount: emojis.length,
                  separatorBuilder: (_, __) =>
                      const Divider(color: AppColors.gray5, height: 1),
                  itemBuilder: (context, i) => _EmojiRow(
                    emoji: emojis[i],
                    onDelete: () => _confirmDelete(
                      context,
                      notifier,
                      emojis[i].id,
                      emojis[i].shortcode,
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

  void _showAddDialog(BuildContext context, _EmojiSettingsNotifier notifier) {
    showDialog(
      context: context,
      builder: (ctx) => _AddEmojiDialog(onAdd: notifier.upload),
    );
  }

  void _confirmDelete(
    BuildContext context,
    _EmojiSettingsNotifier notifier,
    String id,
    String shortcode,
  ) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.gray3,
        title: Text('Delete :$shortcode:?', style: AppTextStyles.headingMd),
        content: Text(
          'This emoji will be removed from the server.',
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

// ---- Emoji row -------------------------------------------------------------

class _EmojiRow extends StatelessWidget {
  const _EmojiRow({required this.emoji, required this.onDelete});

  final CustomEmoji emoji;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
      child: Row(
        children: [
          // Preview
          ClipRRect(
            borderRadius: BorderRadius.all(AppRadius.sm),
            child: CachedNetworkImage(
              imageUrl: emoji.imageUrl,
              width: 40,
              height: 40,
              fit: BoxFit.contain,
              placeholder: (_, __) => const SizedBox(
                width: 40,
                height: 40,
                child: ColoredBox(color: AppColors.gray4),
              ),
            ),
          ),
          const SizedBox(width: AppSpacing.md),

          // Shortcode
          Expanded(
            child: Text(
              ':${emoji.shortcode}:',
              style: AppTextStyles.codeMd,
            ),
          ),

          // Delete
          Tooltip(
            message: 'Delete emoji',
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
}

// ---- Add emoji dialog ------------------------------------------------------

class _AddEmojiDialog extends StatefulWidget {
  const _AddEmojiDialog({required this.onAdd});

  final Future<void> Function(String shortcode, List<int> bytes, String filename) onAdd;

  @override
  State<_AddEmojiDialog> createState() => _AddEmojiDialogState();
}

class _AddEmojiDialogState extends State<_AddEmojiDialog> {
  final _shortcodeCtrl = TextEditingController();
  PlatformFile? _pickedFile;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _shortcodeCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickFile() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.image,
      withData: true,
    );
    if (result != null && result.files.isNotEmpty) {
      setState(() => _pickedFile = result.files.first);
    }
  }

  Future<void> _submit() async {
    final shortcode = _shortcodeCtrl.text.trim();
    if (shortcode.isEmpty) {
      setState(() => _error = 'Shortcode is required');
      return;
    }
    if (!RegExp(r'^[a-z0-9_]+$').hasMatch(shortcode)) {
      setState(() => _error = 'Use only lowercase letters, numbers, and _');
      return;
    }
    if (_pickedFile == null || _pickedFile!.bytes == null) {
      setState(() => _error = 'Please select an image');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      await widget.onAdd(
        shortcode,
        _pickedFile!.bytes!,
        _pickedFile!.name,
      );
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Upload failed. Please try again.';
          _saving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppColors.gray3,
      title: Text('Add Custom Emoji', style: AppTextStyles.headingMd),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Shortcode',
              style: AppTextStyles.headingSm.copyWith(color: AppColors.gray9),
            ),
            const SizedBox(height: AppSpacing.xs),
            TextField(
              controller: _shortcodeCtrl,
              style: AppTextStyles.codeMd,
              decoration: const InputDecoration(
                hintText: 'e.g. thumbsup',
                prefixText: ':',
                suffixText: ':',
              ),
            ),

            const SizedBox(height: AppSpacing.lg),

            Text(
              'Image',
              style: AppTextStyles.headingSm.copyWith(color: AppColors.gray9),
            ),
            const SizedBox(height: AppSpacing.xs),

            InkWell(
              onTap: _pickFile,
              borderRadius: BorderRadius.all(AppRadius.md),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.md,
                  vertical: AppSpacing.md,
                ),
                decoration: BoxDecoration(
                  color: AppColors.gray2,
                  borderRadius: BorderRadius.all(AppRadius.md),
                  border: Border.all(color: AppColors.gray6),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.upload_file_rounded,
                      color: AppColors.gray9,
                      size: 20,
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Text(
                        _pickedFile != null
                            ? _pickedFile!.name
                            : 'Choose image…',
                        style: AppTextStyles.bodyMd.copyWith(
                          color: _pickedFile != null
                              ? AppColors.gray12
                              : AppColors.gray8,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ),
            ),

            if (_error != null) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(
                _error!,
                style:
                    AppTextStyles.bodySm.copyWith(color: AppColors.danger),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        ElevatedButton(
          onPressed: _saving ? null : _submit,
          child: _saving
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppColors.gray12,
                  ),
                )
              : const Text('Upload'),
        ),
      ],
    );
  }
}
