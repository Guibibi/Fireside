import 'package:flutter/material.dart';

/// Design tokens from the Fireside design system.
/// Maps CSS variables from the SolidJS client to Flutter ThemeData.
class AppColors {
  AppColors._();

  // Accent — terracotta
  static const accent = Color(0xFFC9956B);
  static const accentDim = Color(0xFFB07D57);
  static const accentSubtle = Color(0xFF3D2A1E);

  // Background scale — warm charcoal (gray-1 through gray-12)
  static const gray1 = Color(0xFF121110);
  static const gray2 = Color(0xFF1A1917);
  static const gray3 = Color(0xFF222120);
  static const gray4 = Color(0xFF2A2928);
  static const gray5 = Color(0xFF313130);
  static const gray6 = Color(0xFF3A3938);
  static const gray7 = Color(0xFF494846);
  static const gray8 = Color(0xFF6B6A68);
  static const gray9 = Color(0xFF929190);
  static const gray10 = Color(0xFFB2B1AF);
  static const gray11 = Color(0xFFD4D3D1);
  static const gray12 = Color(0xFFEEEBE8);

  // Semantic
  static const success = Color(0xFF7DB88A);
  static const warning = Color(0xFFD4A64E);
  static const danger = Color(0xFFC47070);
  static const info = Color(0xFF7A9EC4);

  // Semantic backgrounds
  static const successBg = Color(0xFF1A2E1D);
  static const warningBg = Color(0xFF2E2310);
  static const dangerBg = Color(0xFF2E1A1A);
  static const infoBg = Color(0xFF1A2430);

  // Overlay
  static const overlay = Color(0x99000000);
  static const overlayLight = Color(0x33000000);
}

class AppSpacing {
  AppSpacing._();

  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 24.0;
  static const xxl = 32.0;
  static const xxxl = 40.0;
}

class AppRadius {
  AppRadius._();

  static const xs = Radius.circular(2.0);
  static const sm = Radius.circular(4.0);
  static const md = Radius.circular(6.0);
  static const lg = Radius.circular(8.0);
  static const xl = Radius.circular(10.0);
  static const full = Radius.circular(9999.0);
}

class AppTextStyles {
  AppTextStyles._();

  static const _base = TextStyle(
    fontFamily: 'Geist',
    color: AppColors.gray12,
    leadingDistribution: TextLeadingDistribution.even,
  );

  static final displayLg = _base.copyWith(fontSize: 28, fontWeight: FontWeight.w600, height: 1.25);
  static final displayMd = _base.copyWith(fontSize: 22, fontWeight: FontWeight.w600, height: 1.3);
  static final displaySm = _base.copyWith(fontSize: 18, fontWeight: FontWeight.w600, height: 1.3);

  static final headingLg = _base.copyWith(fontSize: 16, fontWeight: FontWeight.w600, height: 1.35);
  static final headingMd = _base.copyWith(fontSize: 14, fontWeight: FontWeight.w600, height: 1.4);
  static final headingSm = _base.copyWith(fontSize: 12, fontWeight: FontWeight.w600, height: 1.4, letterSpacing: 0.5);

  static final bodyLg = _base.copyWith(fontSize: 15, fontWeight: FontWeight.w400, height: 1.5);
  static final bodyMd = _base.copyWith(fontSize: 14, fontWeight: FontWeight.w400, height: 1.5);
  static final bodySm = _base.copyWith(fontSize: 12, fontWeight: FontWeight.w400, height: 1.5);

  static final labelLg = _base.copyWith(fontSize: 14, fontWeight: FontWeight.w500, height: 1.4);
  static final labelMd = _base.copyWith(fontSize: 13, fontWeight: FontWeight.w500, height: 1.4);
  static final labelSm = _base.copyWith(fontSize: 11, fontWeight: FontWeight.w500, height: 1.4, letterSpacing: 0.3);

  static final codeMd = TextStyle(
    fontFamily: 'IBMPlexMono',
    fontSize: 13,
    fontWeight: FontWeight.w400,
    color: AppColors.gray11,
    height: 1.6,
  );
  static final codeSm = TextStyle(
    fontFamily: 'IBMPlexMono',
    fontSize: 11,
    fontWeight: FontWeight.w400,
    color: AppColors.gray11,
    height: 1.6,
  );
}

class AppTheme {
  AppTheme._();

  static ThemeData get darkTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: AppColors.gray1,
      colorScheme: const ColorScheme.dark(
        primary: AppColors.accent,
        secondary: AppColors.accentDim,
        surface: AppColors.gray2,
        error: AppColors.danger,
        onPrimary: AppColors.gray12,
        onSecondary: AppColors.gray12,
        onSurface: AppColors.gray12,
        onError: AppColors.gray12,
      ),
      textTheme: TextTheme(
        displayLarge: AppTextStyles.displayLg,
        displayMedium: AppTextStyles.displayMd,
        displaySmall: AppTextStyles.displaySm,
        headlineLarge: AppTextStyles.headingLg,
        headlineMedium: AppTextStyles.headingMd,
        headlineSmall: AppTextStyles.headingSm,
        bodyLarge: AppTextStyles.bodyLg,
        bodyMedium: AppTextStyles.bodyMd,
        bodySmall: AppTextStyles.bodySm,
        labelLarge: AppTextStyles.labelLg,
        labelMedium: AppTextStyles.labelMd,
        labelSmall: AppTextStyles.labelSm,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.gray2,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.sm + 2,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.all(AppRadius.md),
          borderSide: const BorderSide(color: AppColors.gray6),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.all(AppRadius.md),
          borderSide: const BorderSide(color: AppColors.gray6),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.all(AppRadius.md),
          borderSide: const BorderSide(color: AppColors.accent, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.all(AppRadius.md),
          borderSide: const BorderSide(color: AppColors.danger),
        ),
        hintStyle: AppTextStyles.bodyMd.copyWith(color: AppColors.gray8),
        labelStyle: AppTextStyles.labelMd.copyWith(color: AppColors.gray10),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.accent,
          foregroundColor: AppColors.gray12,
          textStyle: AppTextStyles.labelLg,
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: AppSpacing.sm + 2,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.all(AppRadius.md),
          ),
          elevation: 0,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.accent,
          textStyle: AppTextStyles.labelMd,
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.sm,
            vertical: AppSpacing.xs,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.all(AppRadius.sm),
          ),
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(
          foregroundColor: AppColors.gray10,
          hoverColor: AppColors.gray4,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.all(AppRadius.sm),
          ),
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: AppColors.gray5,
        thickness: 1,
        space: 0,
      ),
      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: AppColors.gray4,
          borderRadius: BorderRadius.all(AppRadius.sm),
          border: Border.all(color: AppColors.gray6),
        ),
        textStyle: AppTextStyles.bodySm.copyWith(color: AppColors.gray12),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.sm,
          vertical: AppSpacing.xs,
        ),
      ),
      scrollbarTheme: ScrollbarThemeData(
        thumbColor: WidgetStateProperty.all(AppColors.gray6),
        radius: AppRadius.sm,
        thickness: WidgetStateProperty.all(4),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return AppColors.gray12;
          return AppColors.gray8;
        }),
        trackColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return AppColors.accent;
          return AppColors.gray5;
        }),
      ),
      sliderTheme: SliderThemeData(
        activeTrackColor: AppColors.accent,
        inactiveTrackColor: AppColors.gray5,
        thumbColor: AppColors.accent,
        overlayColor: AppColors.accentSubtle,
        trackHeight: 3,
        thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: AppColors.gray4,
        contentTextStyle: AppTextStyles.bodyMd.copyWith(color: AppColors.gray12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(AppRadius.md),
        ),
        behavior: SnackBarBehavior.floating,
      ),
      extensions: const [
        FiresideColors(),
      ],
    );
  }
}

/// Custom theme extension carrying Fireside-specific semantic colors.
@immutable
class FiresideColors extends ThemeExtension<FiresideColors> {
  const FiresideColors({
    this.success = AppColors.success,
    this.warning = AppColors.warning,
    this.danger = AppColors.danger,
    this.info = AppColors.info,
    this.successBg = AppColors.successBg,
    this.warningBg = AppColors.warningBg,
    this.dangerBg = AppColors.dangerBg,
    this.infoBg = AppColors.infoBg,
    this.sidebarBg = AppColors.gray3,
    this.inputBg = AppColors.gray2,
    this.hoverBg = AppColors.gray4,
    this.textPrimary = AppColors.gray12,
    this.textSecondary = AppColors.gray10,
    this.textMuted = AppColors.gray8,
  });

  final Color success;
  final Color warning;
  final Color danger;
  final Color info;
  final Color successBg;
  final Color warningBg;
  final Color dangerBg;
  final Color infoBg;
  final Color sidebarBg;
  final Color inputBg;
  final Color hoverBg;
  final Color textPrimary;
  final Color textSecondary;
  final Color textMuted;

  @override
  FiresideColors copyWith({
    Color? success,
    Color? warning,
    Color? danger,
    Color? info,
    Color? successBg,
    Color? warningBg,
    Color? dangerBg,
    Color? infoBg,
    Color? sidebarBg,
    Color? inputBg,
    Color? hoverBg,
    Color? textPrimary,
    Color? textSecondary,
    Color? textMuted,
  }) {
    return FiresideColors(
      success: success ?? this.success,
      warning: warning ?? this.warning,
      danger: danger ?? this.danger,
      info: info ?? this.info,
      successBg: successBg ?? this.successBg,
      warningBg: warningBg ?? this.warningBg,
      dangerBg: dangerBg ?? this.dangerBg,
      infoBg: infoBg ?? this.infoBg,
      sidebarBg: sidebarBg ?? this.sidebarBg,
      inputBg: inputBg ?? this.inputBg,
      hoverBg: hoverBg ?? this.hoverBg,
      textPrimary: textPrimary ?? this.textPrimary,
      textSecondary: textSecondary ?? this.textSecondary,
      textMuted: textMuted ?? this.textMuted,
    );
  }

  @override
  FiresideColors lerp(FiresideColors? other, double t) {
    if (other is! FiresideColors) return this;
    return FiresideColors(
      success: Color.lerp(success, other.success, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      info: Color.lerp(info, other.info, t)!,
      successBg: Color.lerp(successBg, other.successBg, t)!,
      warningBg: Color.lerp(warningBg, other.warningBg, t)!,
      dangerBg: Color.lerp(dangerBg, other.dangerBg, t)!,
      infoBg: Color.lerp(infoBg, other.infoBg, t)!,
      sidebarBg: Color.lerp(sidebarBg, other.sidebarBg, t)!,
      inputBg: Color.lerp(inputBg, other.inputBg, t)!,
      hoverBg: Color.lerp(hoverBg, other.hoverBg, t)!,
      textPrimary: Color.lerp(textPrimary, other.textPrimary, t)!,
      textSecondary: Color.lerp(textSecondary, other.textSecondary, t)!,
      textMuted: Color.lerp(textMuted, other.textMuted, t)!,
    );
  }
}
