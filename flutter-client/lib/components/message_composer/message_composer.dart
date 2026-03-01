import 'dart:async';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/http_client.dart';
import '../../api/ws_client.dart';
import '../../api/ws_messages.dart';
import '../../state/channels.dart';
import '../../state/composer.dart';
import '../../theme/app_theme.dart';

/// Message input bar with attachments, emoji/GIF placeholders, and send.
class MessageComposer extends ConsumerStatefulWidget {
  const MessageComposer({
    super.key,
    required this.channelId,
    this.placeholder,
  });

  final String channelId;
  final String? placeholder;

  @override
  ConsumerState<MessageComposer> createState() => _MessageComposerState();
}

class _MessageComposerState extends ConsumerState<MessageComposer> {
  final _textController = TextEditingController();
  final _focusNode = FocusNode();
  Timer? _typingDebounce;
  bool _typingSent = false;

  @override
  void dispose() {
    _typingDebounce?.cancel();
    _textController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  String get _placeholder {
    if (widget.placeholder != null) return widget.placeholder!;
    final channels = ref.read(channelsProvider).valueOrNull ?? [];
    final ch = channels.cast<dynamic>().firstWhere(
          (c) => c.id == widget.channelId,
          orElse: () => null,
        );
    final name = ch?.name as String? ?? widget.channelId;
    return 'Message #$name';
  }

  void _onTextChanged(String text) {
    ref.read(composerProvider(widget.channelId).notifier).setText(text);
    _handleTypingIndicator(text);
  }

  void _handleTypingIndicator(String text) {
    final ws = ref.read(wsClientProvider);
    if (text.isEmpty) {
      _typingDebounce?.cancel();
      if (_typingSent) {
        ws.send(TypingStopMessage(channelId: widget.channelId));
        _typingSent = false;
      }
      return;
    }

    if (!_typingSent) {
      ws.send(TypingStartMessage(channelId: widget.channelId));
      _typingSent = true;
    }

    _typingDebounce?.cancel();
    _typingDebounce = Timer(const Duration(milliseconds: 300), () {
      // After debounce, if text is still non-empty, typing is still ongoing.
      // Stop will be sent on clear or submit.
    });
  }

  Future<void> _submit() async {
    final state = ref.read(composerProvider(widget.channelId));
    final text = state.text.trim();
    if (text.isEmpty && state.attachments.isEmpty) return;

    final ws = ref.read(wsClientProvider);
    if (_typingSent) {
      ws.send(TypingStopMessage(channelId: widget.channelId));
      _typingSent = false;
    }

    _textController.clear();
    ref.read(composerProvider(widget.channelId).notifier).clear();

    try {
      final client = ref.read(httpClientProvider);
      final attachmentIds =
          state.attachments.map((a) => a.mediaId).toList();
      await client.sendMessage(
        widget.channelId,
        content: text,
        attachmentMediaIds: attachmentIds,
      );
    } catch (_) {
      // Restore text on failure
      if (mounted) {
        _textController.text = text;
        ref
            .read(composerProvider(widget.channelId).notifier)
            .setText(text);
      }
    }
  }

  Future<void> _pickFile() async {
    final result = await FilePicker.platform.pickFiles(withData: true);
    if (result == null || result.files.isEmpty) return;

    final file = result.files.first;
    if (file.bytes == null) return;

    ref
        .read(composerProvider(widget.channelId).notifier)
        .setUploading(true);

    try {
      final client = ref.read(httpClientProvider);
      final contentType =
          file.extension != null ? _mimeFromExtension(file.extension!) : 'application/octet-stream';
      final data = await client.uploadMedia(
        file.bytes!,
        file.name,
        contentType,
      );
      final mediaId = data['id'] as String;
      ref.read(composerProvider(widget.channelId).notifier).addAttachment(
            ComposerAttachment(
              mediaId: mediaId,
              filename: file.name,
              contentType: contentType,
              bytes: file.bytes!,
            ),
          );
    } catch (_) {
      // Upload failed; could show snackbar
    } finally {
      if (mounted) {
        ref
            .read(composerProvider(widget.channelId).notifier)
            .setUploading(false);
      }
    }
  }

  String _mimeFromExtension(String ext) {
    return switch (ext.toLowerCase()) {
      'jpg' || 'jpeg' => 'image/jpeg',
      'png' => 'image/png',
      'gif' => 'image/gif',
      'webp' => 'image/webp',
      'mp4' => 'video/mp4',
      'pdf' => 'application/pdf',
      _ => 'application/octet-stream',
    };
  }

  void _showEmojiPicker() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.gray3,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(12)),
      ),
      builder: (_) => const _PlaceholderPickerSheet(
        label: 'Emoji picker (Unit 13)',
      ),
    );
  }

  void _showGifPicker() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.gray3,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(12)),
      ),
      builder: (_) => const _PlaceholderPickerSheet(
        label: 'GIF picker (Unit 13)',
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final composerState =
        ref.watch(composerProvider(widget.channelId));

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (composerState.attachments.isNotEmpty)
          _AttachmentPreviewBar(
            attachments: composerState.attachments,
            onRemove: (id) => ref
                .read(composerProvider(widget.channelId).notifier)
                .removeAttachment(id),
          ),
        Container(
          margin: const EdgeInsets.fromLTRB(
            AppSpacing.md,
            0,
            AppSpacing.md,
            AppSpacing.md,
          ),
          decoration: BoxDecoration(
            color: AppColors.gray2,
            borderRadius: BorderRadius.all(AppRadius.md),
            border: Border.all(color: AppColors.gray6),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              _ToolbarButton(
                icon: Icons.add_circle_outline_rounded,
                tooltip: 'Attach file',
                onTap: composerState.isUploading ? null : _pickFile,
              ),
              Expanded(
                child: KeyboardListener(
                  focusNode: FocusNode(),
                  onKeyEvent: (event) {
                    if (event is KeyDownEvent &&
                        event.logicalKey == LogicalKeyboardKey.enter &&
                        HardwareKeyboard.instance.isControlPressed) {
                      _submit();
                    }
                  },
                  child: TextField(
                    controller: _textController,
                    focusNode: _focusNode,
                    onChanged: _onTextChanged,
                    minLines: 1,
                    maxLines: 6,
                    textInputAction: TextInputAction.newline,
                    style:
                        AppTextStyles.bodyMd.copyWith(color: AppColors.gray12),
                    decoration: InputDecoration(
                      hintText: _placeholder,
                      hintStyle: AppTextStyles.bodyMd
                          .copyWith(color: AppColors.gray8),
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      contentPadding: const EdgeInsets.symmetric(
                        vertical: AppSpacing.sm + 2,
                        horizontal: AppSpacing.xs,
                      ),
                      filled: false,
                    ),
                  ),
                ),
              ),
              _ToolbarButton(
                icon: Icons.emoji_emotions_outlined,
                tooltip: 'Emoji',
                onTap: _showEmojiPicker,
              ),
              _ToolbarButton(
                icon: Icons.gif_box_outlined,
                tooltip: 'GIF',
                onTap: _showGifPicker,
              ),
              _SendButton(
                enabled: composerState.text.trim().isNotEmpty ||
                    composerState.attachments.isNotEmpty,
                loading: composerState.isUploading,
                onTap: _submit,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ---- Toolbar button --------------------------------------------------------

class _ToolbarButton extends StatelessWidget {
  const _ToolbarButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.all(AppRadius.sm),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.sm,
            vertical: AppSpacing.sm,
          ),
          child: Icon(
            icon,
            size: 20,
            color: onTap != null ? AppColors.gray9 : AppColors.gray7,
          ),
        ),
      ),
    );
  }
}

// ---- Send button -----------------------------------------------------------

class _SendButton extends StatelessWidget {
  const _SendButton({
    required this.enabled,
    required this.loading,
    required this.onTap,
  });

  final bool enabled;
  final bool loading;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.xs),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        decoration: BoxDecoration(
          color: enabled ? AppColors.accent : AppColors.gray5,
          borderRadius: BorderRadius.all(AppRadius.sm),
        ),
        child: InkWell(
          onTap: enabled && !loading ? onTap : null,
          borderRadius: BorderRadius.all(AppRadius.sm),
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.sm),
            child: loading
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: AppColors.gray12,
                    ),
                  )
                : Icon(
                    Icons.send_rounded,
                    size: 18,
                    color: enabled ? AppColors.gray12 : AppColors.gray8,
                  ),
          ),
        ),
      ),
    );
  }
}

// ---- Attachment preview bar ------------------------------------------------

class _AttachmentPreviewBar extends StatelessWidget {
  const _AttachmentPreviewBar({
    required this.attachments,
    required this.onRemove,
  });

  final List<ComposerAttachment> attachments;
  final ValueChanged<String> onRemove;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 72,
      margin: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.sm,
        AppSpacing.md,
        AppSpacing.xs,
      ),
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: attachments.length,
        separatorBuilder: (_, __) =>
            const SizedBox(width: AppSpacing.sm),
        itemBuilder: (context, i) => _AttachmentThumb(
          attachment: attachments[i],
          onRemove: () => onRemove(attachments[i].mediaId),
        ),
      ),
    );
  }
}

class _AttachmentThumb extends StatelessWidget {
  const _AttachmentThumb({
    required this.attachment,
    required this.onRemove,
  });

  final ComposerAttachment attachment;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Container(
          width: 64,
          height: 64,
          decoration: BoxDecoration(
            color: AppColors.gray3,
            borderRadius: BorderRadius.all(AppRadius.md),
            border: Border.all(color: AppColors.gray5),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.all(AppRadius.md),
            child: attachment.isImage
                ? Image.memory(
                    Uint8List.fromList(attachment.bytes),
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => const Icon(
                      Icons.image_outlined,
                      color: AppColors.gray8,
                    ),
                  )
                : const Icon(
                    Icons.attach_file_rounded,
                    color: AppColors.gray8,
                    size: 28,
                  ),
          ),
        ),
        Positioned(
          top: 2,
          right: 2,
          child: GestureDetector(
            onTap: onRemove,
            child: Container(
              width: 18,
              height: 18,
              decoration: const BoxDecoration(
                color: AppColors.gray6,
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.close, size: 12, color: AppColors.gray12),
            ),
          ),
        ),
      ],
    );
  }
}

// ---- Placeholder picker sheet ----------------------------------------------

class _PlaceholderPickerSheet extends StatelessWidget {
  const _PlaceholderPickerSheet({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Center(
        child: Text(
          label,
          style: AppTextStyles.bodyMd.copyWith(color: AppColors.gray9),
        ),
      ),
    );
  }
}
