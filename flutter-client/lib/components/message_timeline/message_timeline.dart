import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/models.dart';
import '../../state/chat.dart';
import '../../theme/app_theme.dart';
import '../message_rich_content/message_rich_content.dart';

const _groupingThreshold = Duration(minutes: 5);

/// Scrollable message list with grouping, day separators, and typing indicator.
class MessageTimeline extends ConsumerStatefulWidget {
  const MessageTimeline({super.key, required this.channelId});

  final String channelId;

  @override
  ConsumerState<MessageTimeline> createState() => _MessageTimelineState();
}

class _MessageTimelineState extends ConsumerState<MessageTimeline> {
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    // ListView is reversed; "top" is when scrolled to max extent
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      ref.read(messagesProvider(widget.channelId).notifier).loadMore();
    }
  }

  @override
  Widget build(BuildContext context) {
    final messagesAsync = ref.watch(messagesProvider(widget.channelId));
    final typingMap = ref.watch(typingUsersProvider);
    final typingUsers = typingMap[widget.channelId] ?? {};

    return Column(
      children: [
        Expanded(
          child: messagesAsync.when(
            loading: () => const Center(
              child: CircularProgressIndicator(
                color: AppColors.accent,
                strokeWidth: 2,
              ),
            ),
            error: (err, _) => Center(
              child: Text(
                'Failed to load messages',
                style: AppTextStyles.bodyMd.copyWith(color: AppColors.danger),
              ),
            ),
            data: (messages) {
              if (messages.isEmpty) {
                return const _EmptyState();
              }
              return _MessageList(
                messages: messages,
                scrollController: _scrollController,
              );
            },
          ),
        ),
        if (typingUsers.isNotEmpty)
          _TypingIndicator(usernames: typingUsers.toList()),
      ],
    );
  }
}

// ---- Message list ----------------------------------------------------------

class _MessageList extends StatelessWidget {
  const _MessageList({
    required this.messages,
    required this.scrollController,
  });

  final List<Message> messages;
  final ScrollController scrollController;

  @override
  Widget build(BuildContext context) {
    // messages[0] is newest; messages are displayed bottom-to-top with reverse
    final items = <_ListItem>[];

    for (var i = 0; i < messages.length; i++) {
      final msg = messages[i];
      final prev = i + 1 < messages.length ? messages[i + 1] : null;

      // Day separator: insert when date changes compared to previous (older)
      if (prev != null && !_sameDay(msg.createdAt, prev.createdAt)) {
        items.add(_DaySeparatorItem(date: msg.createdAt));
      }

      final isGrouped = prev != null &&
          prev.authorId == msg.authorId &&
          msg.createdAt.difference(prev.createdAt).abs() < _groupingThreshold;

      items.add(_MessageItem(message: msg, grouped: isGrouped));
    }

    return ListView.builder(
      controller: scrollController,
      reverse: true,
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
      itemCount: items.length,
      itemBuilder: (context, index) {
        final item = items[index];
        return switch (item) {
          _MessageItem(message: final m, grouped: final g) =>
            _MessageRow(message: m, grouped: g),
          _DaySeparatorItem(date: final d) => _DaySeparator(date: d),
          _ => const SizedBox.shrink(),
        };
      },
    );
  }

  bool _sameDay(DateTime a, DateTime b) {
    return a.year == b.year && a.month == b.month && a.day == b.day;
  }
}

// ---- List item types -------------------------------------------------------

sealed class _ListItem {}

class _MessageItem extends _ListItem {
  _MessageItem({required this.message, required this.grouped});
  final Message message;
  final bool grouped;
}

class _DaySeparatorItem extends _ListItem {
  _DaySeparatorItem({required this.date});
  final DateTime date;
}

// ---- Message row -----------------------------------------------------------

class _MessageRow extends StatelessWidget {
  const _MessageRow({required this.message, required this.grouped});

  final Message message;
  final bool grouped;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.md,
        right: AppSpacing.md,
        top: grouped ? 2 : AppSpacing.sm,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 36,
            child: grouped
                ? _Timestamp(time: message.createdAt, compact: true)
                : _UserAvatar(
                    displayName: message.authorDisplayName,
                    avatarUrl: message.authorAvatarUrl,
                  ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (!grouped)
                  _MessageHeader(message: message),
                MessageRichContent(message: message),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MessageHeader extends StatelessWidget {
  const _MessageHeader({required this.message});

  final Message message;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final sameDay = now.year == message.createdAt.year &&
        now.month == message.createdAt.month &&
        now.day == message.createdAt.day;

    final timeStr = sameDay
        ? DateFormat.jm().format(message.createdAt)
        : DateFormat('MMM d, y h:mm a').format(message.createdAt);

    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.baseline,
        textBaseline: TextBaseline.alphabetic,
        children: [
          Text(
            message.authorDisplayName,
            style: AppTextStyles.labelMd.copyWith(color: AppColors.gray12),
          ),
          const SizedBox(width: AppSpacing.sm),
          Text(
            timeStr,
            style: AppTextStyles.bodySm.copyWith(color: AppColors.gray8),
          ),
        ],
      ),
    );
  }
}

class _UserAvatar extends StatelessWidget {
  const _UserAvatar({required this.displayName, this.avatarUrl});

  final String displayName;
  final String? avatarUrl;

  @override
  Widget build(BuildContext context) {
    final url = avatarUrl;
    if (url != null && url.isNotEmpty) {
      return CircleAvatar(
        radius: 18,
        backgroundImage: NetworkImage(url),
        backgroundColor: AppColors.accentSubtle,
      );
    }
    return CircleAvatar(
      radius: 18,
      backgroundColor: AppColors.accentSubtle,
      child: Text(
        displayName.isNotEmpty ? displayName[0].toUpperCase() : '?',
        style: AppTextStyles.labelSm.copyWith(color: AppColors.accent),
      ),
    );
  }
}

class _Timestamp extends StatelessWidget {
  const _Timestamp({required this.time, required this.compact});

  final DateTime time;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerRight,
      child: Text(
        DateFormat('h:mm').format(time),
        style: AppTextStyles.codeSm.copyWith(
          color: AppColors.gray8,
          fontSize: 10,
        ),
      ),
    );
  }
}

// ---- Day separator ---------------------------------------------------------

class _DaySeparator extends StatelessWidget {
  const _DaySeparator({required this.date});

  final DateTime date;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final isToday = now.year == date.year &&
        now.month == date.month &&
        now.day == date.day;
    final yesterday = now.subtract(const Duration(days: 1));
    final isYesterday = yesterday.year == date.year &&
        yesterday.month == date.month &&
        yesterday.day == date.day;

    final label = isToday
        ? 'Today'
        : isYesterday
            ? 'Yesterday'
            : DateFormat('MMMM d, y').format(date);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Row(
        children: [
          const SizedBox(width: AppSpacing.md),
          const Expanded(child: Divider(color: AppColors.gray5)),
          Padding(
            padding:
                const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
            child: Text(
              label,
              style:
                  AppTextStyles.labelSm.copyWith(color: AppColors.gray9),
            ),
          ),
          const Expanded(child: Divider(color: AppColors.gray5)),
          const SizedBox(width: AppSpacing.md),
        ],
      ),
    );
  }
}

// ---- Typing indicator ------------------------------------------------------

class _TypingIndicator extends StatelessWidget {
  const _TypingIndicator({required this.usernames});

  final List<String> usernames;

  @override
  Widget build(BuildContext context) {
    final text = switch (usernames.length) {
      1 => '${usernames[0]} is typing...',
      2 => '${usernames[0]} and ${usernames[1]} are typing...',
      _ => '${usernames[0]}, ${usernames[1]} and others are typing...',
    };

    return Container(
      color: AppColors.gray1,
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.xs,
        AppSpacing.lg,
        AppSpacing.sm,
      ),
      child: Row(
        children: [
          const _TypingDots(),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              text,
              style:
                  AppTextStyles.bodySm.copyWith(color: AppColors.gray9),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

class _TypingDots extends StatefulWidget {
  const _TypingDots();

  @override
  State<_TypingDots> createState() => _TypingDotsState();
}

class _TypingDotsState extends State<_TypingDots>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (_, __) {
        final t = _controller.value;
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _Dot(opacity: _dotOpacity(t, 0)),
            const SizedBox(width: 3),
            _Dot(opacity: _dotOpacity(t, 1)),
            const SizedBox(width: 3),
            _Dot(opacity: _dotOpacity(t, 2)),
          ],
        );
      },
    );
  }

  double _dotOpacity(double t, int index) {
    final phase = (t - index / 3.0 + 1.0) % 1.0;
    return phase < 0.5 ? phase * 2 : (1.0 - phase) * 2;
  }
}

class _Dot extends StatelessWidget {
  const _Dot({required this.opacity});

  final double opacity;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 5,
      height: 5,
      decoration: BoxDecoration(
        color: AppColors.gray9.withOpacity(opacity.clamp(0.2, 1.0)),
        shape: BoxShape.circle,
      ),
    );
  }
}

// ---- Empty state -----------------------------------------------------------

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.chat_bubble_outline_rounded,
              size: 40, color: AppColors.gray7),
          const SizedBox(height: AppSpacing.md),
          Text(
            'No messages yet',
            style: AppTextStyles.headingMd.copyWith(color: AppColors.gray9),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Be the first to say something.',
            style: AppTextStyles.bodyMd.copyWith(color: AppColors.gray8),
          ),
        ],
      ),
    );
  }
}
