/// Utility functions for formatting dates in message timelines.
library;

import 'package:intl/intl.dart' show DateFormat;

/// Returns "Today", "Yesterday", or a formatted date string.
String formatDaySeparator(DateTime dt) {
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final day = DateTime(dt.year, dt.month, dt.day);
  final diff = today.difference(day).inDays;
  if (diff == 0) return 'Today';
  if (diff == 1) return 'Yesterday';
  if (diff < 7) return DateFormat('EEEE').format(dt); // Monday, Tuesday...
  return DateFormat('MMMM d, y').format(dt);
}

/// Compact time string for message timestamps: "2:34 PM"
String formatTime(DateTime dt) {
  return DateFormat('h:mm a').format(dt.toLocal());
}

/// Full timestamp for message hover: "Monday, January 6, 2025 at 2:34 PM"
String formatFullTimestamp(DateTime dt) {
  return DateFormat("EEEE, MMMM d, y 'at' h:mm a").format(dt.toLocal());
}

/// Whether two datetimes are on the same calendar day.
bool sameDay(DateTime a, DateTime b) {
  return a.year == b.year && a.month == b.month && a.day == b.day;
}

/// Whether two messages should be grouped (same author, within 5 minutes).
bool shouldGroupMessages({
  required String authorA,
  required String authorB,
  required DateTime timeA,
  required DateTime timeB,
}) {
  return authorA == authorB &&
      timeB.difference(timeA).abs().inMinutes < 5;
}
