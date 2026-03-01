import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';

/// Circular avatar widget. Shows a cached network image when [avatarUrl]
/// is provided, otherwise falls back to initials in a deterministically
/// colored circle derived from [username].
class UserAvatar extends StatelessWidget {
  const UserAvatar({
    super.key,
    required this.username,
    this.avatarUrl,
    this.displayName,
    this.size = 36,
    this.showOnlineIndicator = false,
    this.isOnline = false,
  });

  final String username;
  final String? avatarUrl;
  final String? displayName;
  final double size;
  final bool showOnlineIndicator;
  final bool isOnline;

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        _AvatarCircle(
          username: username,
          avatarUrl: avatarUrl,
          displayName: displayName,
          size: size,
        ),
        if (showOnlineIndicator)
          Positioned(
            bottom: -1,
            right: -1,
            child: _OnlineDot(isOnline: isOnline, parentSize: size),
          ),
      ],
    );
  }
}

class _AvatarCircle extends StatelessWidget {
  const _AvatarCircle({
    required this.username,
    required this.size,
    this.avatarUrl,
    this.displayName,
  });

  final String username;
  final String? avatarUrl;
  final String? displayName;
  final double size;

  @override
  Widget build(BuildContext context) {
    final url = avatarUrl;
    if (url != null && url.isNotEmpty) {
      return ClipOval(
        child: CachedNetworkImage(
          imageUrl: url,
          width: size,
          height: size,
          fit: BoxFit.cover,
          placeholder: (_, __) => _InitialsCircle(
            username: username,
            displayName: displayName,
            size: size,
          ),
          errorWidget: (_, __, ___) => _InitialsCircle(
            username: username,
            displayName: displayName,
            size: size,
          ),
        ),
      );
    }

    return _InitialsCircle(
      username: username,
      displayName: displayName,
      size: size,
    );
  }
}

class _InitialsCircle extends StatelessWidget {
  const _InitialsCircle({
    required this.username,
    required this.size,
    this.displayName,
  });

  final String username;
  final String? displayName;
  final double size;

  static const _palette = [
    Color(0xFF8B6B5A),
    Color(0xFF5A7A6B),
    Color(0xFF6B5A8B),
    Color(0xFF8B7A5A),
    Color(0xFF5A6B8B),
    Color(0xFF7A8B5A),
    Color(0xFF8B5A6B),
    Color(0xFF5A8B7A),
  ];

  Color _colorFor(String name) {
    var hash = 0;
    for (final char in name.codeUnits) {
      hash = (hash * 31 + char) & 0x7FFFFFFF;
    }
    return _palette[hash % _palette.length];
  }

  String _initials() {
    final name = displayName ?? username;
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.length >= 2) {
      return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
    }
    return name.isNotEmpty ? name[0].toUpperCase() : '?';
  }

  @override
  Widget build(BuildContext context) {
    final bg = _colorFor(username);
    final fontSize = size * 0.38;

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: bg,
        shape: BoxShape.circle,
      ),
      child: Center(
        child: Text(
          _initials(),
          style: TextStyle(
            fontFamily: 'Geist',
            fontSize: fontSize,
            fontWeight: FontWeight.w600,
            color: AppColors.gray12,
            height: 1,
          ),
        ),
      ),
    );
  }
}

class _OnlineDot extends StatelessWidget {
  const _OnlineDot({required this.isOnline, required this.parentSize});

  final bool isOnline;
  final double parentSize;

  @override
  Widget build(BuildContext context) {
    final dotSize = (parentSize * 0.3).clamp(8.0, 14.0);
    return Container(
      width: dotSize,
      height: dotSize,
      decoration: BoxDecoration(
        color: isOnline ? AppColors.success : AppColors.gray7,
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.gray3, width: 2),
      ),
    );
  }
}
