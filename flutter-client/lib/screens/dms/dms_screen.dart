import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/ws_client.dart';
import '../../api/ws_messages.dart';
import '../../core/models.dart';
import '../../state/auth.dart';
import '../../state/dms.dart';
import '../../theme/app_theme.dart';
import '../../components/overlays/user_avatar.dart';

const _sidebarWidth = 260.0;

/// Full DM screen: thread list sidebar + conversation pane.
class DmsScreen extends ConsumerWidget {
  const DmsScreen({super.key, this.threadId});

  final String? threadId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // If a threadId was provided via navigation, activate it
    if (threadId != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final current = ref.read(activeDmThreadIdProvider);
        if (current != threadId) {
          ref.read(activeDmThreadIdProvider.notifier).state = threadId;
        }
      });
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 600) {
          return _MobileDmsLayout();
        }
        return _DesktopDmsLayout();
      },
    );
  }
}

// ---- Desktop layout --------------------------------------------------------

class _DesktopDmsLayout extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final activeThreadId = ref.watch(activeDmThreadIdProvider);

    return Scaffold(
      backgroundColor: AppColors.gray1,
      body: Row(
        children: [
          SizedBox(
            width: _sidebarWidth,
            child: Container(
              color: AppColors.gray3,
              child: _DmThreadList(),
            ),
          ),
          Expanded(
            child: activeThreadId != null
                ? _DmConversationPane(threadId: activeThreadId)
                : _EmptyState(),
          ),
        ],
      ),
    );
  }
}

// ---- Mobile layout ---------------------------------------------------------

class _MobileDmsLayout extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final activeThreadId = ref.watch(activeDmThreadIdProvider);

    if (activeThreadId != null) {
      return Scaffold(
        backgroundColor: AppColors.gray1,
        appBar: AppBar(
          backgroundColor: AppColors.gray2,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back_rounded, color: AppColors.gray12),
            onPressed: () =>
                ref.read(activeDmThreadIdProvider.notifier).state = null,
          ),
          title: Text('Messages', style: AppTextStyles.headingMd),
        ),
        body: _DmConversationPane(threadId: activeThreadId),
      );
    }

    return Scaffold(
      backgroundColor: AppColors.gray3,
      body: _DmThreadList(),
    );
  }
}

// ---- Thread list sidebar ---------------------------------------------------

class _DmThreadList extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final threadsAsync = ref.watch(dmThreadsProvider);
    final activeThreadId = ref.watch(activeDmThreadIdProvider);

    return Column(
      children: [
        // Header
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.md,
            AppSpacing.md,
            AppSpacing.sm,
            AppSpacing.sm,
          ),
          child: Row(
            children: [
              Expanded(
                child: Text('Direct Messages', style: AppTextStyles.headingMd),
              ),
              IconButton(
                icon: const Icon(Icons.edit_rounded, size: 16),
                tooltip: 'New DM',
                onPressed: () => _showNewDmDialog(context, ref),
              ),
            ],
          ),
        ),

        const Divider(height: 1, color: AppColors.gray5),

        // Thread list
        Expanded(
          child: threadsAsync.when(
            loading: () => const Center(
              child: CircularProgressIndicator(
                color: AppColors.accent,
                strokeWidth: 2,
              ),
            ),
            error: (e, _) => Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Text(
                'Failed to load conversations',
                style: AppTextStyles.bodySm.copyWith(color: AppColors.danger),
              ),
            ),
            data: (threads) {
              if (threads.isEmpty) {
                return Padding(
                  padding: const EdgeInsets.all(AppSpacing.xl),
                  child: Text(
                    'No conversations yet.\nStart one with the pencil icon.',
                    style: AppTextStyles.bodySm.copyWith(color: AppColors.gray9),
                    textAlign: TextAlign.center,
                  ),
                );
              }

              return ListView.builder(
                itemCount: threads.length,
                itemBuilder: (context, i) => _ThreadRow(
                  thread: threads[i],
                  selected: threads[i].threadId == activeThreadId,
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  void _showNewDmDialog(BuildContext context, WidgetRef ref) {
    final controller = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.gray3,
        title: Text('New Direct Message', style: AppTextStyles.headingMd),
        content: TextField(
          controller: controller,
          autofocus: true,
          style: AppTextStyles.bodyMd,
          decoration: const InputDecoration(
            hintText: 'Username',
          ),
          onSubmitted: (_) => _startDm(ctx, ref, controller.text.trim()),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => _startDm(ctx, ref, controller.text.trim()),
            child: const Text('Open'),
          ),
        ],
      ),
    );
  }

  Future<void> _startDm(
      BuildContext context, WidgetRef ref, String username) async {
    if (username.isEmpty) return;
    Navigator.of(context).pop();

    try {
      final thread = await ref.read(dmThreadsProvider.notifier).createThread(username);
      ref.read(activeDmThreadIdProvider.notifier).state = thread.threadId;
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open conversation')),
        );
      }
    }
  }
}

class _ThreadRow extends ConsumerWidget {
  const _ThreadRow({required this.thread, required this.selected});

  final DmThread thread;
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
            ref.read(activeDmThreadIdProvider.notifier).state = thread.threadId,
        borderRadius: BorderRadius.all(AppRadius.md),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 100),
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.sm,
            vertical: AppSpacing.sm,
          ),
          decoration: BoxDecoration(
            color: selected ? AppColors.gray4 : Colors.transparent,
            borderRadius: BorderRadius.all(AppRadius.md),
          ),
          child: Row(
            children: [
              UserAvatar(
                username: thread.otherUsername,
                avatarUrl: thread.otherAvatarUrl,
                displayName: thread.otherDisplayName,
                size: 34,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      thread.otherDisplayName,
                      style: AppTextStyles.labelMd.copyWith(
                        color: AppColors.gray12,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (thread.lastMessagePreview != null)
                      Text(
                        thread.lastMessagePreview!,
                        style: AppTextStyles.bodySm.copyWith(
                          color: thread.unreadCount > 0
                              ? AppColors.gray11
                              : AppColors.gray9,
                        ),
                        overflow: TextOverflow.ellipsis,
                        maxLines: 1,
                      ),
                  ],
                ),
              ),
              if (thread.unreadCount > 0)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.accent,
                    borderRadius: BorderRadius.all(AppRadius.full),
                  ),
                  child: Text(
                    '${thread.unreadCount > 99 ? "99+" : thread.unreadCount}',
                    style: AppTextStyles.labelSm.copyWith(
                      color: AppColors.gray12,
                      fontSize: 10,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---- Conversation pane -----------------------------------------------------

class _DmConversationPane extends ConsumerWidget {
  const _DmConversationPane({required this.threadId});

  final String threadId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final threadsAsync = ref.watch(dmThreadsProvider);
    final thread = threadsAsync.valueOrNull
        ?.firstWhere((t) => t.threadId == threadId, orElse: () => DmThread(
          threadId: threadId,
          otherUsername: '',
          otherDisplayName: 'Conversation',
        ));

    final messagesAsync = ref.watch(dmMessagesProvider(threadId));
    final auth = ref.watch(authStateProvider).valueOrNull;
    final currentUsername = auth?.username ?? '';

    return Column(
      children: [
        // Header
        Container(
          height: 52,
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
          decoration: const BoxDecoration(
            color: AppColors.gray2,
            border: Border(bottom: BorderSide(color: AppColors.gray5)),
          ),
          child: Row(
            children: [
              if (thread != null) ...[
                UserAvatar(
                  username: thread.otherUsername,
                  avatarUrl: thread.otherAvatarUrl,
                  displayName: thread.otherDisplayName,
                  size: 28,
                ),
                const SizedBox(width: AppSpacing.sm),
                Text(
                  thread.otherDisplayName.isNotEmpty
                      ? thread.otherDisplayName
                      : thread.otherUsername,
                  style: AppTextStyles.headingMd,
                ),
              ],
            ],
          ),
        ),

        // Messages
        Expanded(
          child: messagesAsync.when(
            loading: () => const Center(
              child: CircularProgressIndicator(
                color: AppColors.accent,
                strokeWidth: 2,
              ),
            ),
            error: (_, __) => Center(
              child: Text(
                'Failed to load messages',
                style: AppTextStyles.bodyMd.copyWith(color: AppColors.danger),
              ),
            ),
            data: (messages) {
              if (messages.isEmpty) {
                return Center(
                  child: Text(
                    'No messages yet. Say hello!',
                    style: AppTextStyles.bodyMd.copyWith(color: AppColors.gray9),
                  ),
                );
              }
              return ListView.builder(
                reverse: true,
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.lg,
                  vertical: AppSpacing.md,
                ),
                itemCount: messages.length,
                itemBuilder: (context, i) {
                  final msg = messages[messages.length - 1 - i];
                  final isOwn = msg.authorUsername == currentUsername;
                  return _DmMessageRow(message: msg, isOwn: isOwn);
                },
              );
            },
          ),
        ),

        // Composer
        _DmComposer(threadId: threadId),
      ],
    );
  }
}

class _DmMessageRow extends StatelessWidget {
  const _DmMessageRow({required this.message, required this.isOwn});

  final DmMessage message;
  final bool isOwn;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
      child: Row(
        mainAxisAlignment:
            isOwn ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (!isOwn) ...[
            UserAvatar(
              username: message.authorUsername,
              displayName: message.authorDisplayName,
              size: 30,
            ),
            const SizedBox(width: AppSpacing.sm),
          ],
          Flexible(
            child: Column(
              crossAxisAlignment:
                  isOwn ? CrossAxisAlignment.end : CrossAxisAlignment.start,
              children: [
                if (!isOwn)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 2),
                    child: Text(
                      message.authorDisplayName,
                      style: AppTextStyles.labelSm.copyWith(
                        color: AppColors.gray9,
                      ),
                    ),
                  ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.md,
                    vertical: AppSpacing.sm,
                  ),
                  decoration: BoxDecoration(
                    color: isOwn ? AppColors.accentSubtle : AppColors.gray3,
                    borderRadius: BorderRadius.all(AppRadius.lg),
                    border: isOwn
                        ? Border.all(color: AppColors.accent.withOpacity(0.3))
                        : null,
                  ),
                  child: Text(
                    message.content,
                    style: AppTextStyles.bodyMd,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---- DM composer -----------------------------------------------------------

class _DmComposer extends ConsumerStatefulWidget {
  const _DmComposer({required this.threadId});

  final String threadId;

  @override
  ConsumerState<_DmComposer> createState() => _DmComposerState();
}

class _DmComposerState extends ConsumerState<_DmComposer> {
  final _controller = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _sending) return;

    setState(() => _sending = true);
    try {
      ref.read(wsClientProvider).send(
        SendDmMessageClientMsg(
          threadId: widget.threadId,
          content: text,
        ),
      );
      _controller.clear();
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.sm,
        AppSpacing.lg,
        AppSpacing.md,
      ),
      decoration: const BoxDecoration(
        color: AppColors.gray1,
        border: Border(top: BorderSide(color: AppColors.gray5)),
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _controller,
              style: AppTextStyles.bodyMd,
              decoration: const InputDecoration(
                hintText: 'Message...',
              ),
              maxLines: null,
              keyboardType: TextInputType.multiline,
              textInputAction: TextInputAction.newline,
              onSubmitted: (_) => _send(),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          IconButton(
            icon: const Icon(Icons.send_rounded),
            onPressed: _sending ? null : _send,
            color: AppColors.accent,
          ),
        ],
      ),
    );
  }
}

// ---- Empty state -----------------------------------------------------------

class _EmptyState extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.chat_bubble_outline_rounded,
            size: 48,
            color: AppColors.gray7,
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            'Select a conversation',
            style: AppTextStyles.headingMd.copyWith(color: AppColors.gray9),
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Choose a DM thread from the left or start a new one.',
            style: AppTextStyles.bodyMd.copyWith(color: AppColors.gray8),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
