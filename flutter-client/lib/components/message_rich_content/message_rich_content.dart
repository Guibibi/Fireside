import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../api/http_client.dart';
import '../../core/models.dart';
import '../../theme/app_theme.dart';

/// Renders a message's content: markdown, reactions, attachments, edit badge.
class MessageRichContent extends ConsumerWidget {
  const MessageRichContent({super.key, required this.message});

  final Message message;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _MarkdownContent(content: message.content, editedAt: message.editedAt),
        if (message.reactions.isNotEmpty)
          _ReactionRow(message: message),
        if (message.attachments.isNotEmpty)
          _AttachmentSection(attachments: message.attachments),
      ],
    );
  }
}

// ---- Markdown content ------------------------------------------------------

class _MarkdownContent extends StatelessWidget {
  const _MarkdownContent({required this.content, this.editedAt});

  final String content;
  final DateTime? editedAt;

  @override
  Widget build(BuildContext context) {
    final styleSheet = MarkdownStyleSheet(
      p: AppTextStyles.bodyMd.copyWith(color: AppColors.gray11),
      strong: AppTextStyles.bodyMd.copyWith(
        color: AppColors.gray12,
        fontWeight: FontWeight.w600,
      ),
      em: AppTextStyles.bodyMd.copyWith(
        color: AppColors.gray11,
        fontStyle: FontStyle.italic,
      ),
      code: AppTextStyles.codeMd,
      codeblockDecoration: BoxDecoration(
        color: AppColors.gray3,
        borderRadius: BorderRadius.all(AppRadius.md),
        border: Border.all(color: AppColors.gray5),
      ),
      codeblockPadding: const EdgeInsets.all(AppSpacing.md),
      blockquoteDecoration: BoxDecoration(
        border: Border(
          left: BorderSide(color: AppColors.gray6, width: 3),
        ),
      ),
      blockquotePadding:
          const EdgeInsets.only(left: AppSpacing.md),
      a: AppTextStyles.bodyMd.copyWith(
        color: AppColors.info,
        decoration: TextDecoration.underline,
        decorationColor: AppColors.info,
      ),
      h1: AppTextStyles.headingLg,
      h2: AppTextStyles.headingMd,
      h3: AppTextStyles.headingSm,
      listBullet: AppTextStyles.bodyMd.copyWith(color: AppColors.gray11),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        MarkdownBody(
          data: _applyMentionHighlighting(content),
          styleSheet: styleSheet,
          onTapLink: (text, href, title) async {
            if (href != null) {
              final uri = Uri.tryParse(href);
              if (uri != null && await canLaunchUrl(uri)) {
                await launchUrl(uri, mode: LaunchMode.externalApplication);
              }
            }
          },
        ),
        if (editedAt != null)
          Text(
            ' (edited)',
            style: AppTextStyles.bodySm.copyWith(color: AppColors.gray8),
          ),
      ],
    );
  }

  /// Wraps @username patterns so they can be styled via a custom builder.
  /// For simplicity we replace @username with bold accent-colored text via
  /// markdown bold syntax and a custom prefix marker.
  String _applyMentionHighlighting(String text) {
    // Replace @username with a styled span using inline HTML isn't supported
    // in flutter_markdown easily, so we use bold as visual emphasis and rely
    // on the color set in the styleSheet for @ mentions.
    return text.replaceAllMapped(
      RegExp(r'@(\w+)'),
      (m) => '**@${m[1]}**',
    );
  }
}

// ---- Reactions -------------------------------------------------------------

class _ReactionRow extends ConsumerWidget {
  const _ReactionRow({required this.message});

  final Message message;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.xs),
      child: Wrap(
        spacing: AppSpacing.xs,
        runSpacing: AppSpacing.xs,
        children: message.reactions
            .map((r) => _ReactionChip(reaction: r, message: message))
            .toList(),
      ),
    );
  }
}

class _ReactionChip extends ConsumerWidget {
  const _ReactionChip({required this.reaction, required this.message});

  final ReactionSummary reaction;
  final Message message;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final reacted = reaction.reactedByMe;

    return GestureDetector(
      onTap: () => _toggleReaction(ref),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 120),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.sm,
          vertical: 3,
        ),
        decoration: BoxDecoration(
          color: reacted ? AppColors.accentSubtle : AppColors.gray3,
          borderRadius: BorderRadius.all(AppRadius.sm),
          border: Border.all(
            color: reacted ? AppColors.accent : AppColors.gray5,
            width: reacted ? 1.5 : 1,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _ReactionEmoji(reaction: reaction),
            const SizedBox(width: 4),
            Text(
              '${reaction.count}',
              style: AppTextStyles.labelSm.copyWith(
                color: reacted ? AppColors.accent : AppColors.gray10,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _toggleReaction(WidgetRef ref) async {
    final client = ref.read(httpClientProvider);
    try {
      if (reaction.reactedByMe) {
        await client.removeReaction(
          message.channelId,
          message.id,
          emojiId: reaction.emojiId,
          unicodeEmoji: reaction.unicodeEmoji,
        );
      } else {
        await client.addReaction(
          message.channelId,
          message.id,
          emojiId: reaction.emojiId,
          unicodeEmoji: reaction.unicodeEmoji,
        );
      }
    } catch (_) {
      // Optimistic update will be reconciled on next WS event
    }
  }
}

class _ReactionEmoji extends StatelessWidget {
  const _ReactionEmoji({required this.reaction});

  final ReactionSummary reaction;

  @override
  Widget build(BuildContext context) {
    final imageUrl = reaction.imageUrl;
    if (imageUrl != null && imageUrl.isNotEmpty) {
      return CachedNetworkImage(
        imageUrl: imageUrl,
        width: 16,
        height: 16,
        errorWidget: (_, __, ___) => Text(
          reaction.displayLabel,
          style: const TextStyle(fontSize: 14),
        ),
      );
    }
    return Text(
      reaction.displayLabel,
      style: const TextStyle(fontSize: 14),
    );
  }
}

// ---- Attachments -----------------------------------------------------------

class _AttachmentSection extends StatelessWidget {
  const _AttachmentSection({required this.attachments});

  final List<MessageAttachment> attachments;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: attachments.map((a) {
          if (a.isImage) return _ImageAttachment(attachment: a);
          return _FileAttachment(attachment: a);
        }).toList(),
      ),
    );
  }
}

class _ImageAttachment extends StatelessWidget {
  const _ImageAttachment({required this.attachment});

  final MessageAttachment attachment;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: ClipRRect(
        borderRadius: BorderRadius.all(AppRadius.md),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 300),
          child: CachedNetworkImage(
            imageUrl: attachment.url,
            fit: BoxFit.contain,
            placeholder: (_, __) => Container(
              height: 120,
              color: AppColors.gray3,
              child: const Center(
                child: CircularProgressIndicator(
                  color: AppColors.accent,
                  strokeWidth: 2,
                ),
              ),
            ),
            errorWidget: (_, __, ___) => Container(
              height: 80,
              color: AppColors.gray3,
              child: const Icon(
                Icons.broken_image_outlined,
                color: AppColors.gray8,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _FileAttachment extends StatelessWidget {
  const _FileAttachment({required this.attachment});

  final MessageAttachment attachment;

  @override
  Widget build(BuildContext context) {
    final sizeStr = _formatBytes(attachment.size);
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: InkWell(
        onTap: () async {
          final uri = Uri.tryParse(attachment.url);
          if (uri != null && await canLaunchUrl(uri)) {
            await launchUrl(uri, mode: LaunchMode.externalApplication);
          }
        },
        borderRadius: BorderRadius.all(AppRadius.md),
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.sm),
          decoration: BoxDecoration(
            color: AppColors.gray3,
            borderRadius: BorderRadius.all(AppRadius.md),
            border: Border.all(color: AppColors.gray5),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.attach_file_rounded,
                  size: 20, color: AppColors.gray9),
              const SizedBox(width: AppSpacing.sm),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    attachment.filename,
                    style: AppTextStyles.labelMd
                        .copyWith(color: AppColors.gray11),
                  ),
                  if (sizeStr != null)
                    Text(
                      sizeStr,
                      style: AppTextStyles.bodySm
                          .copyWith(color: AppColors.gray9),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  String? _formatBytes(int? bytes) {
    if (bytes == null) return null;
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}
