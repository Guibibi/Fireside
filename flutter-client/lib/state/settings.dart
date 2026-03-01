import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

// ---- Provider --------------------------------------------------------------

final settingsProvider = AsyncNotifierProvider<SettingsNotifier, AppSettings>(
  SettingsNotifier.new,
);

// ---- Keys ------------------------------------------------------------------

const _keyNoiseSuppression = 'noise_suppression_enabled';
const _keyMicVolume = 'mic_volume';
const _keyIncomingVolume = 'incoming_volume';
const _keyPushToTalk = 'push_to_talk_enabled';
const _keyInputDeviceId = 'input_device_id';
const _keyOutputDeviceId = 'output_device_id';
const _keyCameraDeviceId = 'camera_device_id';
const _keyNotificationsEnabled = 'notifications_enabled';
const _keyMentionNotifications = 'mention_notifications_enabled';
const _keyDmNotifications = 'dm_notifications_enabled';

// ---- Model -----------------------------------------------------------------

class AppSettings {
  const AppSettings({
    this.noiseSuppression = true,
    this.micVolume = 100.0,
    this.incomingVolume = 100.0,
    this.pushToTalk = false,
    this.inputDeviceId,
    this.outputDeviceId,
    this.cameraDeviceId,
    this.notificationsEnabled = true,
    this.mentionNotifications = true,
    this.dmNotifications = true,
  });

  final bool noiseSuppression;
  final double micVolume;
  final double incomingVolume;
  final bool pushToTalk;
  final String? inputDeviceId;
  final String? outputDeviceId;
  final String? cameraDeviceId;
  final bool notificationsEnabled;
  final bool mentionNotifications;
  final bool dmNotifications;

  AppSettings copyWith({
    bool? noiseSuppression,
    double? micVolume,
    double? incomingVolume,
    bool? pushToTalk,
    String? inputDeviceId,
    String? outputDeviceId,
    String? cameraDeviceId,
    bool? notificationsEnabled,
    bool? mentionNotifications,
    bool? dmNotifications,
  }) {
    return AppSettings(
      noiseSuppression: noiseSuppression ?? this.noiseSuppression,
      micVolume: micVolume ?? this.micVolume,
      incomingVolume: incomingVolume ?? this.incomingVolume,
      pushToTalk: pushToTalk ?? this.pushToTalk,
      inputDeviceId: inputDeviceId ?? this.inputDeviceId,
      outputDeviceId: outputDeviceId ?? this.outputDeviceId,
      cameraDeviceId: cameraDeviceId ?? this.cameraDeviceId,
      notificationsEnabled: notificationsEnabled ?? this.notificationsEnabled,
      mentionNotifications: mentionNotifications ?? this.mentionNotifications,
      dmNotifications: dmNotifications ?? this.dmNotifications,
    );
  }
}

// ---- Notifier --------------------------------------------------------------

class SettingsNotifier extends AsyncNotifier<AppSettings> {
  @override
  Future<AppSettings> build() async {
    return _loadFromPrefs();
  }

  Future<AppSettings> _loadFromPrefs() async {
    final prefs = await SharedPreferences.getInstance();
    return AppSettings(
      noiseSuppression: prefs.getBool(_keyNoiseSuppression) ?? true,
      micVolume: prefs.getDouble(_keyMicVolume) ?? 100.0,
      incomingVolume: prefs.getDouble(_keyIncomingVolume) ?? 100.0,
      pushToTalk: prefs.getBool(_keyPushToTalk) ?? false,
      inputDeviceId: prefs.getString(_keyInputDeviceId),
      outputDeviceId: prefs.getString(_keyOutputDeviceId),
      cameraDeviceId: prefs.getString(_keyCameraDeviceId),
      notificationsEnabled: prefs.getBool(_keyNotificationsEnabled) ?? true,
      mentionNotifications: prefs.getBool(_keyMentionNotifications) ?? true,
      dmNotifications: prefs.getBool(_keyDmNotifications) ?? true,
    );
  }

  Future<void> setNoiseSuppression(bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_keyNoiseSuppression, enabled);
    final current = state.valueOrNull ?? const AppSettings();
    state = AsyncData(current.copyWith(noiseSuppression: enabled));
  }

  Future<void> setMicVolume(double volume) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble(_keyMicVolume, volume);
    final current = state.valueOrNull ?? const AppSettings();
    state = AsyncData(current.copyWith(micVolume: volume));
  }

  Future<void> setIncomingVolume(double volume) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble(_keyIncomingVolume, volume);
    final current = state.valueOrNull ?? const AppSettings();
    state = AsyncData(current.copyWith(incomingVolume: volume));
  }

  Future<void> setPushToTalk(bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_keyPushToTalk, enabled);
    final current = state.valueOrNull ?? const AppSettings();
    state = AsyncData(current.copyWith(pushToTalk: enabled));
  }

  Future<void> setInputDevice(String? deviceId) async {
    final prefs = await SharedPreferences.getInstance();
    if (deviceId != null) {
      await prefs.setString(_keyInputDeviceId, deviceId);
    } else {
      await prefs.remove(_keyInputDeviceId);
    }
    final current = state.valueOrNull ?? const AppSettings();
    state = AsyncData(current.copyWith(inputDeviceId: deviceId));
  }

  Future<void> setOutputDevice(String? deviceId) async {
    final prefs = await SharedPreferences.getInstance();
    if (deviceId != null) {
      await prefs.setString(_keyOutputDeviceId, deviceId);
    } else {
      await prefs.remove(_keyOutputDeviceId);
    }
    final current = state.valueOrNull ?? const AppSettings();
    state = AsyncData(current.copyWith(outputDeviceId: deviceId));
  }

  Future<void> setCameraDevice(String? deviceId) async {
    final prefs = await SharedPreferences.getInstance();
    if (deviceId != null) {
      await prefs.setString(_keyCameraDeviceId, deviceId);
    } else {
      await prefs.remove(_keyCameraDeviceId);
    }
    final current = state.valueOrNull ?? const AppSettings();
    state = AsyncData(current.copyWith(cameraDeviceId: deviceId));
  }

  Future<void> setNotificationsEnabled(bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_keyNotificationsEnabled, enabled);
    final current = state.valueOrNull ?? const AppSettings();
    state = AsyncData(current.copyWith(notificationsEnabled: enabled));
  }

  Future<void> setMentionNotifications(bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_keyMentionNotifications, enabled);
    final current = state.valueOrNull ?? const AppSettings();
    state = AsyncData(current.copyWith(mentionNotifications: enabled));
  }

  Future<void> setDmNotifications(bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_keyDmNotifications, enabled);
    final current = state.valueOrNull ?? const AppSettings();
    state = AsyncData(current.copyWith(dmNotifications: enabled));
  }
}
