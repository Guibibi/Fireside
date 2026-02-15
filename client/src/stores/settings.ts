import { createSignal } from "solid-js";

const AUDIO_INPUT_KEY = "yankcord_audio_input_device_id";
const AUDIO_OUTPUT_KEY = "yankcord_audio_output_device_id";
const CAMERA_INPUT_KEY = "yankcord_camera_input_device_id";
const AVATAR_NAME_KEY = "yankcord_avatar_name";
const SCREEN_SHARE_RESOLUTION_KEY = "yankcord_screen_share_resolution";
const SCREEN_SHARE_FPS_KEY = "yankcord_screen_share_fps";
const SCREEN_SHARE_BITRATE_MODE_KEY = "yankcord_screen_share_bitrate_mode";
const SCREEN_SHARE_CUSTOM_BITRATE_KEY = "yankcord_screen_share_custom_bitrate_kbps";
const SCREEN_SHARE_SOURCE_KIND_KEY = "yankcord_screen_share_source_kind";
const VOICE_JOIN_SOUND_ENABLED_KEY = "yankcord_voice_join_sound_enabled";
const VOICE_LEAVE_SOUND_ENABLED_KEY = "yankcord_voice_leave_sound_enabled";

export type ScreenShareResolution = "720p" | "1080p" | "1440p" | "4k";
export type ScreenShareFps = 30 | 60;
export type ScreenShareBitrateMode = "auto" | "balanced" | "high" | "ultra" | "custom";
export type ScreenShareSourceKind = "screen" | "window" | "application";

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

function readScreenShareResolution(): ScreenShareResolution {
  const value = localStorage.getItem(SCREEN_SHARE_RESOLUTION_KEY);
  if (value === "720p" || value === "1080p" || value === "1440p" || value === "4k") {
    return value;
  }

  return "1080p";
}

function readScreenShareFps(): ScreenShareFps {
  const value = localStorage.getItem(SCREEN_SHARE_FPS_KEY);
  if (value === "30" || value === "60") {
    return Number(value) as ScreenShareFps;
  }

  return 60;
}

function readScreenShareBitrateMode(): ScreenShareBitrateMode {
  const value = localStorage.getItem(SCREEN_SHARE_BITRATE_MODE_KEY);
  if (value === "auto" || value === "balanced" || value === "high" || value === "ultra" || value === "custom") {
    return value;
  }

  return "auto";
}

function readScreenShareCustomBitrateKbps(): number {
  const value = localStorage.getItem(SCREEN_SHARE_CUSTOM_BITRATE_KEY);
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return 12000;
  }

  return Math.min(50000, Math.max(1500, parsed));
}

function readScreenShareSourceKind(): ScreenShareSourceKind {
  const value = localStorage.getItem(SCREEN_SHARE_SOURCE_KIND_KEY);
  if (value === "screen" || value === "window" || value === "application") {
    return value;
  }

  return "screen";
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

const [preferredScreenShareResolution, setPreferredScreenShareResolution] = createSignal<ScreenShareResolution>(
  readScreenShareResolution(),
);

const [preferredScreenShareFps, setPreferredScreenShareFps] = createSignal<ScreenShareFps>(
  readScreenShareFps(),
);

const [preferredScreenShareBitrateMode, setPreferredScreenShareBitrateMode] = createSignal<ScreenShareBitrateMode>(
  readScreenShareBitrateMode(),
);

const [preferredScreenShareCustomBitrateKbps, setPreferredScreenShareCustomBitrateKbps] = createSignal<number>(
  readScreenShareCustomBitrateKbps(),
);

const [preferredScreenShareSourceKind, setPreferredScreenShareSourceKind] = createSignal<ScreenShareSourceKind>(
  readScreenShareSourceKind(),
);

const [voiceJoinSoundEnabled, setVoiceJoinSoundEnabled] = createSignal<boolean>(
  readBooleanPreference(VOICE_JOIN_SOUND_ENABLED_KEY, true),
);

const [voiceLeaveSoundEnabled, setVoiceLeaveSoundEnabled] = createSignal<boolean>(
  readBooleanPreference(VOICE_LEAVE_SOUND_ENABLED_KEY, true),
);

export {
  preferredAudioInputDeviceId,
  preferredAudioOutputDeviceId,
  preferredCameraDeviceId,
  avatarPlaceholderName,
  preferredScreenShareResolution,
  preferredScreenShareFps,
  preferredScreenShareBitrateMode,
  preferredScreenShareCustomBitrateKbps,
  preferredScreenShareSourceKind,
  voiceJoinSoundEnabled,
  voiceLeaveSoundEnabled,
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

export function savePreferredScreenShareResolution(resolution: ScreenShareResolution) {
  localStorage.setItem(SCREEN_SHARE_RESOLUTION_KEY, resolution);
  setPreferredScreenShareResolution(resolution);
}

export function savePreferredScreenShareFps(fps: ScreenShareFps) {
  localStorage.setItem(SCREEN_SHARE_FPS_KEY, String(fps));
  setPreferredScreenShareFps(fps);
}

export function savePreferredScreenShareBitrateMode(mode: ScreenShareBitrateMode) {
  localStorage.setItem(SCREEN_SHARE_BITRATE_MODE_KEY, mode);
  setPreferredScreenShareBitrateMode(mode);
}

export function savePreferredScreenShareCustomBitrateKbps(kbps: number) {
  const normalized = Math.min(50000, Math.max(1500, Math.round(kbps)));
  localStorage.setItem(SCREEN_SHARE_CUSTOM_BITRATE_KEY, String(normalized));
  setPreferredScreenShareCustomBitrateKbps(normalized);
}

export function savePreferredScreenShareSourceKind(kind: ScreenShareSourceKind) {
  localStorage.setItem(SCREEN_SHARE_SOURCE_KIND_KEY, kind);
  setPreferredScreenShareSourceKind(kind);
}

export function saveVoiceJoinSoundEnabled(enabled: boolean) {
  localStorage.setItem(VOICE_JOIN_SOUND_ENABLED_KEY, String(enabled));
  setVoiceJoinSoundEnabled(enabled);
}

export function saveVoiceLeaveSoundEnabled(enabled: boolean) {
  localStorage.setItem(VOICE_LEAVE_SOUND_ENABLED_KEY, String(enabled));
  setVoiceLeaveSoundEnabled(enabled);
}

export function resetAudioPreferences() {
  savePreferredAudioInputDeviceId(null);
  savePreferredAudioOutputDeviceId(null);
  savePreferredCameraDeviceId(null);
}
