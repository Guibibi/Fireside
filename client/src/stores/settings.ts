import { createSignal } from "solid-js";

const AUDIO_INPUT_KEY = "yankcord_audio_input_device_id";
const AUDIO_OUTPUT_KEY = "yankcord_audio_output_device_id";
const CAMERA_INPUT_KEY = "yankcord_camera_input_device_id";
const AVATAR_NAME_KEY = "yankcord_avatar_name";
const VOICE_JOIN_SOUND_ENABLED_KEY = "yankcord_voice_join_sound_enabled";
const VOICE_LEAVE_SOUND_ENABLED_KEY = "yankcord_voice_leave_sound_enabled";
const MESSAGE_NOTIFICATION_SOUND_ENABLED_KEY = "yankcord_message_notification_sound_enabled";
const MENTION_DESKTOP_NOTIFICATIONS_ENABLED_KEY = "yankcord_mention_desktop_notifications_enabled";
const VOICE_AUTO_LEVEL_ENABLED_KEY = "yankcord_voice_auto_level_enabled";
const VOICE_NOISE_SUPPRESSION_ENABLED_KEY = "yankcord_voice_noise_suppression_enabled";
const VOICE_ECHO_CANCELLATION_ENABLED_KEY = "yankcord_voice_echo_cancellation_enabled";
const VOICE_INCOMING_VOLUME_KEY = "yankcord_voice_incoming_volume";
const VOICE_OUTGOING_VOLUME_KEY = "yankcord_voice_outgoing_volume";

function readBooleanPreference(key: string, defaultValue: boolean): boolean {
  const value = localStorage.getItem(key);
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return defaultValue;
}

function clampIncomingVoiceVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 100;
  }

  return Math.max(0, Math.min(100, Math.round(volume)));
}

function clampOutgoingVoiceVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 100;
  }

  return Math.max(0, Math.min(200, Math.round(volume)));
}

function readVoiceVolumePreference(
  key: string,
  defaultValue: number,
  clamp: (volume: number) => number,
): number {
  const value = localStorage.getItem(key);
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  return clamp(parsed);
}

const [preferredAudioInputDeviceId, setPreferredAudioInputDeviceId] = createSignal<string | null>(
  localStorage.getItem(AUDIO_INPUT_KEY),
);

const [preferredAudioOutputDeviceId, setPreferredAudioOutputDeviceId] = createSignal<string | null>(
  localStorage.getItem(AUDIO_OUTPUT_KEY),
);

const [preferredCameraDeviceId, setPreferredCameraDeviceId] = createSignal<string | null>(
  localStorage.getItem(CAMERA_INPUT_KEY),
);

const [avatarPlaceholderName, setAvatarPlaceholderName] = createSignal<string | null>(
  localStorage.getItem(AVATAR_NAME_KEY),
);

const [voiceJoinSoundEnabled, setVoiceJoinSoundEnabled] = createSignal<boolean>(
  readBooleanPreference(VOICE_JOIN_SOUND_ENABLED_KEY, true),
);

const [voiceLeaveSoundEnabled, setVoiceLeaveSoundEnabled] = createSignal<boolean>(
  readBooleanPreference(VOICE_LEAVE_SOUND_ENABLED_KEY, true),
);

const [messageNotificationSoundEnabled, setMessageNotificationSoundEnabled] = createSignal<boolean>(
  readBooleanPreference(MESSAGE_NOTIFICATION_SOUND_ENABLED_KEY, true),
);

const [mentionDesktopNotificationsEnabled, setMentionDesktopNotificationsEnabled] = createSignal<boolean>(
  readBooleanPreference(MENTION_DESKTOP_NOTIFICATIONS_ENABLED_KEY, false),
);

const [voiceAutoLevelEnabled, setVoiceAutoLevelEnabled] = createSignal<boolean>(
  readBooleanPreference(VOICE_AUTO_LEVEL_ENABLED_KEY, true),
);

const [voiceNoiseSuppressionEnabled, setVoiceNoiseSuppressionEnabled] = createSignal<boolean>(
  readBooleanPreference(VOICE_NOISE_SUPPRESSION_ENABLED_KEY, true),
);

const [voiceEchoCancellationEnabled, setVoiceEchoCancellationEnabled] = createSignal<boolean>(
  readBooleanPreference(VOICE_ECHO_CANCELLATION_ENABLED_KEY, true),
);

const [voiceIncomingVolume, setVoiceIncomingVolume] = createSignal<number>(
  readVoiceVolumePreference(VOICE_INCOMING_VOLUME_KEY, 100, clampIncomingVoiceVolume),
);

const [voiceOutgoingVolume, setVoiceOutgoingVolume] = createSignal<number>(
  readVoiceVolumePreference(VOICE_OUTGOING_VOLUME_KEY, 100, clampOutgoingVoiceVolume),
);

export {
  preferredAudioInputDeviceId,
  preferredAudioOutputDeviceId,
  preferredCameraDeviceId,
  avatarPlaceholderName,
  voiceJoinSoundEnabled,
  voiceLeaveSoundEnabled,
  messageNotificationSoundEnabled,
  mentionDesktopNotificationsEnabled,
  voiceAutoLevelEnabled,
  voiceNoiseSuppressionEnabled,
  voiceEchoCancellationEnabled,
  voiceIncomingVolume,
  voiceOutgoingVolume,
};

export function savePreferredAudioInputDeviceId(deviceId: string | null) {
  if (deviceId) {
    localStorage.setItem(AUDIO_INPUT_KEY, deviceId);
  } else {
    localStorage.removeItem(AUDIO_INPUT_KEY);
  }

  setPreferredAudioInputDeviceId(deviceId);
}

export function savePreferredAudioOutputDeviceId(deviceId: string | null) {
  if (deviceId) {
    localStorage.setItem(AUDIO_OUTPUT_KEY, deviceId);
  } else {
    localStorage.removeItem(AUDIO_OUTPUT_KEY);
  }

  setPreferredAudioOutputDeviceId(deviceId);
}

export function savePreferredCameraDeviceId(deviceId: string | null) {
  if (deviceId) {
    localStorage.setItem(CAMERA_INPUT_KEY, deviceId);
  } else {
    localStorage.removeItem(CAMERA_INPUT_KEY);
  }

  setPreferredCameraDeviceId(deviceId);
}

export function saveAvatarPlaceholderName(name: string | null) {
  if (name) {
    localStorage.setItem(AVATAR_NAME_KEY, name);
  } else {
    localStorage.removeItem(AVATAR_NAME_KEY);
  }

  setAvatarPlaceholderName(name);
}

export function saveVoiceJoinSoundEnabled(enabled: boolean) {
  localStorage.setItem(VOICE_JOIN_SOUND_ENABLED_KEY, String(enabled));
  setVoiceJoinSoundEnabled(enabled);
}

export function saveVoiceLeaveSoundEnabled(enabled: boolean) {
  localStorage.setItem(VOICE_LEAVE_SOUND_ENABLED_KEY, String(enabled));
  setVoiceLeaveSoundEnabled(enabled);
}

export function saveMessageNotificationSoundEnabled(enabled: boolean) {
  localStorage.setItem(MESSAGE_NOTIFICATION_SOUND_ENABLED_KEY, String(enabled));
  setMessageNotificationSoundEnabled(enabled);
}

export function saveMentionDesktopNotificationsEnabled(enabled: boolean) {
  localStorage.setItem(MENTION_DESKTOP_NOTIFICATIONS_ENABLED_KEY, String(enabled));
  setMentionDesktopNotificationsEnabled(enabled);
}

export function saveVoiceAutoLevelEnabled(enabled: boolean) {
  localStorage.setItem(VOICE_AUTO_LEVEL_ENABLED_KEY, String(enabled));
  setVoiceAutoLevelEnabled(enabled);
}

export function saveVoiceNoiseSuppressionEnabled(enabled: boolean) {
  localStorage.setItem(VOICE_NOISE_SUPPRESSION_ENABLED_KEY, String(enabled));
  setVoiceNoiseSuppressionEnabled(enabled);
}

export function saveVoiceEchoCancellationEnabled(enabled: boolean) {
  localStorage.setItem(VOICE_ECHO_CANCELLATION_ENABLED_KEY, String(enabled));
  setVoiceEchoCancellationEnabled(enabled);
}

export function saveVoiceIncomingVolume(volume: number) {
  const normalized = clampIncomingVoiceVolume(volume);
  localStorage.setItem(VOICE_INCOMING_VOLUME_KEY, String(normalized));
  setVoiceIncomingVolume(normalized);
}

export function saveVoiceOutgoingVolume(volume: number) {
  const normalized = clampOutgoingVoiceVolume(volume);
  localStorage.setItem(VOICE_OUTGOING_VOLUME_KEY, String(normalized));
  setVoiceOutgoingVolume(normalized);
}

export type SettingsSection = "profile" | "audio" | "emojis" | "notifications" | "session";

const [settingsOpen, setSettingsOpen] = createSignal(false);
const [activeSettingsSection, setActiveSettingsSection] = createSignal<SettingsSection>("profile");

export { settingsOpen, activeSettingsSection };

export function openSettings(section?: SettingsSection) {
  if (section) {
    setActiveSettingsSection(section);
  }
  setSettingsOpen(true);
}

export function closeSettings() {
  setSettingsOpen(false);
  setActiveSettingsSection("profile");
}

export function resetAudioPreferences() {
  savePreferredAudioInputDeviceId(null);
  savePreferredAudioOutputDeviceId(null);
  savePreferredCameraDeviceId(null);
  saveVoiceNoiseSuppressionEnabled(true);
  saveVoiceEchoCancellationEnabled(true);
  saveVoiceIncomingVolume(100);
  saveVoiceOutgoingVolume(100);
}
