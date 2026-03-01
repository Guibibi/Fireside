/// Deterministically maps a username to a muted warm color for avatar backgrounds.
library;

import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Palette of warm, muted colors for avatar backgrounds.
const _palette = [
  Color(0xFF3D2A1E), // terracotta dark
  Color(0xFF2A2010), // warm amber dark
  Color(0xFF1A2A1D), // sage dark
  Color(0xFF1A2430), // sky dark
  Color(0xFF2E1A2A), // mauve dark
  Color(0xFF1E2A1A), // green dark
  Color(0xFF2A1A1A), // rose dark
  Color(0xFF1A1E2A), // blue dark
];

const _textColors = [
  Color(0xFFC9956B), // terracotta
  Color(0xFFD4A64E), // amber
  Color(0xFF7DB88A), // sage
  Color(0xFF7A9EC4), // sky
  Color(0xFFB07A9E), // mauve
  Color(0xFF8AAA78), // green
  Color(0xFFC47070), // rose
  Color(0xFF7090C4), // blue
];

/// Returns a deterministic background color for a given username.
Color avatarBgColor(String username) {
  final idx = username.codeUnits.fold(0, (a, b) => a + b) % _palette.length;
  return _palette[idx];
}

/// Returns the matching foreground color for the avatar background.
Color avatarFgColor(String username) {
  final idx = username.codeUnits.fold(0, (a, b) => a + b) % _textColors.length;
  return _textColors[idx];
}

/// Returns up to 2 initials from a display name or username.
String initials(String name) {
  final parts = name.trim().split(RegExp(r'\s+'));
  if (parts.length >= 2) {
    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
  }
  return name.isNotEmpty ? name[0].toUpperCase() : '?';
}
