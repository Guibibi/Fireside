import { createSignal } from "solid-js";

const AUDIO_INPUT_KEY = "yankcord_audio_input_device_id";
const AUDIO_OUTPUT_KEY = "yankcord_audio_output_device_id";
const AVATAR_NAME_KEY = "yankcord_avatar_name";

const [preferredAudioInputDeviceId, setPreferredAudioInputDeviceId] = createSignal<string | null>(
  localStorage.getItem(AUDIO_INPUT_KEY),
);

const [preferredAudioOutputDeviceId, setPreferredAudioOutputDeviceId] = createSignal<string | null>(
  localStorage.getItem(AUDIO_OUTPUT_KEY),
);

const [avatarPlaceholderName, setAvatarPlaceholderName] = createSignal<string | null>(
  localStorage.getItem(AVATAR_NAME_KEY),
);

export {
  preferredAudioInputDeviceId,
  preferredAudioOutputDeviceId,
  avatarPlaceholderName,
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

export function saveAvatarPlaceholderName(name: string | null) {
  if (name) {
    localStorage.setItem(AVATAR_NAME_KEY, name);
  } else {
    localStorage.removeItem(AVATAR_NAME_KEY);
  }

  setAvatarPlaceholderName(name);
}

export function resetAudioPreferences() {
  savePreferredAudioInputDeviceId(null);
  savePreferredAudioOutputDeviceId(null);
}
