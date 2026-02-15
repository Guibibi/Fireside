import { Show, createSignal, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { patch } from "../api/http";
import { errorMessage } from "../utils/error";
import {
  isSpeakerSelectionSupported,
  listAudioDevices,
  listCameraDevices,
  resetPreferredAudioDevices,
  cleanupMediaTransports,
  setPreferredCameraDevice,
  setPreferredMicrophoneDevice,
  setPreferredSpeakerDevice,
  type AudioDeviceOption,
  type CameraDeviceOption,
} from "../api/media";
import {
  updateIncomingVoiceGainNodes,
  updateVoiceNormalizationNodesEnabled,
} from "../api/media/consumers";
import { connect, disconnect } from "../api/ws";
import { updateOutgoingMicrophoneGain } from "../api/media/microphoneProcessing";
import {
  clearAuth,
  getApiBaseUrl,
  token,
  serverUrl,
  updateAuthIdentity,
  username as currentUsername,
} from "../stores/auth";
import { resetChatState } from "../stores/chat";
import {
  clearVoiceRejoinNotice,
  joinedVoiceChannelId,
  resetVoiceState,
  setJoinedVoiceChannel,
  setVoiceActionState,
  showVoiceRejoinNotice,
} from "../stores/voice";
import {
  preferredAudioInputDeviceId,
  preferredAudioOutputDeviceId,
  preferredCameraDeviceId,
  saveVoiceAutoLevelEnabled,
  saveVoiceEchoCancellationEnabled,
  saveVoiceIncomingVolume,
  saveVoiceJoinSoundEnabled,
  saveVoiceLeaveSoundEnabled,
  saveVoiceNoiseSuppressionEnabled,
  saveVoiceOutgoingVolume,
  voiceAutoLevelEnabled,
  voiceEchoCancellationEnabled,
  voiceIncomingVolume,
  voiceJoinSoundEnabled,
  voiceLeaveSoundEnabled,
  voiceNoiseSuppressionEnabled,
  voiceOutgoingVolume,
} from "../stores/settings";
import Modal from "./Modal";
import UserAvatar from "./UserAvatar";
import { renameUserProfile, setUserAvatar, upsertUserProfile } from "../stores/userProfiles";
import NotificationSessionSettings from "./settings/NotificationSessionSettings";
import VoiceAudioPreferences from "./settings/VoiceAudioPreferences";

interface UpdateCurrentUserResponse {
  token: string;
  username: string;
  avatar_url: string | null;
}

interface CurrentUserResponse {
  username: string;
  avatar_url: string | null;
}

interface UploadAvatarResponse {
  avatar_url: string;
}

export default function UserSettingsDock() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = createSignal(false);
  const [draftUsername, setDraftUsername] = createSignal(currentUsername() ?? "");
  const [profileError, setProfileError] = createSignal("");
  const [audioError, setAudioError] = createSignal("");
  const [isSavingProfile, setIsSavingProfile] = createSignal(false);
  const [isRefreshingDevices, setIsRefreshingDevices] = createSignal(false);
  const [audioInputs, setAudioInputs] = createSignal<AudioDeviceOption[]>([]);
  const [audioOutputs, setAudioOutputs] = createSignal<AudioDeviceOption[]>([]);
  const [cameraInputs, setCameraInputs] = createSignal<CameraDeviceOption[]>([]);
  const [isUploadingAvatar, setIsUploadingAvatar] = createSignal(false);

  const supportsSpeakerSelection = isSpeakerSelectionSupported();

  function openSettings() {
    setDraftUsername(currentUsername() ?? "");
    setProfileError("");
    setAudioError("");
    setIsOpen(true);
    void refreshMediaDevices();
    void refreshCurrentUserProfile();
  }

  function closeSettings() {
    setIsOpen(false);
    setProfileError("");
    setAudioError("");
  }

  function avatarFallbackLabel() {
    const usernameValue = currentUsername()?.trim();
    if (usernameValue && usernameValue.length > 0) {
      return usernameValue.slice(0, 1).toUpperCase();
    }

    return "?";
  }

  async function refreshCurrentUserProfile() {
    try {
      const response = await fetch(`${getApiBaseUrl()}/users/me`, {
        headers: {
          Authorization: `Bearer ${token() ?? ""}`,
        },
      });
      if (!response.ok) {
        return;
      }

      const profile = await response.json() as CurrentUserResponse;
      upsertUserProfile({ username: profile.username, avatar_url: profile.avatar_url });
    } catch {
      // no-op: avatar fetch failure should not block settings
    }
  }

  async function refreshMediaDevices() {
    setIsRefreshingDevices(true);
    setAudioError("");

    try {
      const [inventory, cameras] = await Promise.all([
        listAudioDevices(),
        listCameraDevices(),
      ]);
      setAudioInputs(inventory.inputs);
      setAudioOutputs(inventory.outputs);
      setCameraInputs(cameras);
    } catch (error) {
      setAudioError(errorMessage(error, "Failed to load media devices"));
    } finally {
      setIsRefreshingDevices(false);
    }
  }

  async function handleSaveProfile(event: Event) {
    event.preventDefault();
    setProfileError("");

    const nextUsername = draftUsername().trim();
    if (nextUsername.length < 3 || nextUsername.length > 32) {
      setProfileError("Username must be between 3 and 32 characters");
      return;
    }

    setIsSavingProfile(true);
    try {
      const wasInVoice = !!joinedVoiceChannelId();
      const response = await patch<UpdateCurrentUserResponse>("/users/me", {
        username: nextUsername,
      });

      const previousUsername = currentUsername();
      updateAuthIdentity(response.token, response.username);
      if (previousUsername && previousUsername !== response.username) {
        renameUserProfile(previousUsername, response.username);
      }
      upsertUserProfile({ username: response.username, avatar_url: response.avatar_url });
      cleanupMediaTransports();
      if (wasInVoice) {
        setJoinedVoiceChannel(null);
        showVoiceRejoinNotice();
      } else {
        clearVoiceRejoinNotice();
      }
      setVoiceActionState("idle");
      disconnect();
      connect();
      closeSettings();
    } catch (error) {
      setProfileError(errorMessage(error, "Failed to update profile"));
    } finally {
      setIsSavingProfile(false);
    }
  }

  function handleDeviceChange(
    setter: (id: string | null) => Promise<void>,
    failureMessage: string,
  ) {
    return async (event: Event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      setAudioError("");
      try {
        await setter(value || null);
      } catch (error) {
        setAudioError(errorMessage(error, failureMessage));
      }
    };
  }

  const handleAudioInputChange = handleDeviceChange(setPreferredMicrophoneDevice, "Failed to switch microphone device");
  const handleAudioOutputChange = handleDeviceChange(setPreferredSpeakerDevice, "Failed to switch speaker device");
  const handleCameraInputChange = handleDeviceChange(setPreferredCameraDevice, "Failed to switch camera device");

  async function handleResetAudioPreferences() {
    setAudioError("");
    try {
      await resetPreferredAudioDevices();
      updateIncomingVoiceGainNodes(100);
    } catch (error) {
      setAudioError(errorMessage(error, "Failed to reset audio preferences"));
    }
  }

  async function handleAvatarInput(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setProfileError("Avatar must be 2 MB or smaller");
      return;
    }

    const contentType = file.type;
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
      setProfileError("Avatar must be JPEG, PNG, or WebP");
      return;
    }

    setProfileError("");
    setIsUploadingAvatar(true);

    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`${getApiBaseUrl()}/users/me/avatar`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token() ?? ""}`,
        },
        body: form,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(body.error || response.statusText);
      }

      const payload = await response.json() as UploadAvatarResponse;
      const cacheBustedUrl = `${payload.avatar_url}?v=${Date.now()}`;
      const current = currentUsername();
      if (current) {
        setUserAvatar(current, cacheBustedUrl);
      }
    } catch (error) {
      setProfileError(errorMessage(error, "Failed to upload avatar"));
    } finally {
      setIsUploadingAvatar(false);
      (event.currentTarget as HTMLInputElement).value = "";
    }
  }


  function handleVoiceJoinSoundToggle(event: Event) {
    saveVoiceJoinSoundEnabled((event.currentTarget as HTMLInputElement).checked);
  }

  function handleVoiceLeaveSoundToggle(event: Event) {
    saveVoiceLeaveSoundEnabled((event.currentTarget as HTMLInputElement).checked);
  }

  function handleVoiceAutoLevelToggle(event: Event) {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    saveVoiceAutoLevelEnabled(enabled);
    updateVoiceNormalizationNodesEnabled(enabled);
  }

  async function applyUpdatedMicrophoneConstraints() {
    setAudioError("");
    try {
      await setPreferredMicrophoneDevice(preferredAudioInputDeviceId());
    } catch (error) {
      setAudioError(errorMessage(error, "Failed to apply microphone processing settings"));
    }
  }

  function handleVoiceNoiseSuppressionToggle(event: Event) {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    saveVoiceNoiseSuppressionEnabled(enabled);
    void applyUpdatedMicrophoneConstraints();
  }

  function handleVoiceEchoCancellationToggle(event: Event) {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    saveVoiceEchoCancellationEnabled(enabled);
    void applyUpdatedMicrophoneConstraints();
  }

  function handleVoiceIncomingVolumeInput(event: InputEvent) {
    const value = Number.parseInt((event.currentTarget as HTMLInputElement).value, 10);
    saveVoiceIncomingVolume(value);
    updateIncomingVoiceGainNodes(value);
  }

  function handleVoiceOutgoingVolumeInput(event: InputEvent) {
    const value = Number.parseInt((event.currentTarget as HTMLInputElement).value, 10);
    saveVoiceOutgoingVolume(value);
    updateOutgoingMicrophoneGain(value);
  }

  function handleLogout() {
    cleanupMediaTransports();
    disconnect();
    resetChatState();
    resetVoiceState();
    clearAuth();
    closeSettings();
    navigate("/connect");
  }

  onMount(() => {
    void refreshCurrentUserProfile();
  });

  return (
    <>
      <div class="user-dock">
        <UserAvatar username={currentUsername() ?? avatarFallbackLabel()} class="user-dock-avatar" size={42} />
        <div class="user-dock-meta">
          <p class="user-dock-name">{currentUsername() ?? "Unknown user"}</p>
          <p class="user-dock-subtitle">Online</p>
        </div>
        <button
          type="button"
          class="user-dock-settings"
          onClick={openSettings}
          aria-label="Open settings"
          title="Settings"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M19.14 12.94a7.43 7.43 0 0 0 .05-.94 7.43 7.43 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.3 7.3 0 0 0-1.63-.94l-.36-2.54a.49.49 0 0 0-.49-.42h-3.84a.49.49 0 0 0-.49.42l-.36 2.54c-.58.22-1.13.53-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.43 7.43 0 0 0-.05.94 7.43 7.43 0 0 0 .05.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.41 1.05.73 1.63.94l.36 2.54a.49.49 0 0 0 .49.42h3.84a.49.49 0 0 0 .49-.42l.36-2.54c.58-.22 1.13-.53 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
          </svg>
        </button>
      </div>

      <Modal
        open={isOpen()}
        onClose={closeSettings}
        title="User Settings"
        ariaLabel="User settings"
      >
        <>

            <form class="settings-section" onSubmit={(event) => void handleSaveProfile(event)}>
              <h5>Profile</h5>
              <label class="settings-label" for="settings-username">Username</label>
              <input
                id="settings-username"
                type="text"
                value={draftUsername()}
                maxlength={32}
                onInput={(event) => setDraftUsername(event.currentTarget.value)}
                disabled={isSavingProfile()}
              />
              <p class="settings-help">Server URL: {serverUrl()}</p>

              <label class="settings-label" for="settings-avatar">Avatar</label>
              <input id="settings-avatar" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void handleAvatarInput(event)} disabled={isUploadingAvatar()} />
              <p class="settings-help">JPEG, PNG, or WebP. Max size 2 MB.</p>
              <div class="settings-avatar-preview">
                <UserAvatar username={currentUsername() ?? avatarFallbackLabel()} size={72} />
              </div>

              <Show when={profileError()}>
                <p class="error">{profileError()}</p>
              </Show>

              <div class="settings-actions">
                <button type="submit" disabled={isSavingProfile()}>
                  {isSavingProfile() ? "Saving..." : "Save profile"}
                </button>
              </div>
              <Show when={isUploadingAvatar()}>
                <p class="settings-help">Uploading avatar...</p>
              </Show>
            </form>

            <section class="settings-section">
              <h5>Audio</h5>
              <div class="settings-audio-row">
                <label class="settings-label" for="settings-microphone">Microphone</label>
                <select
                  id="settings-microphone"
                  value={preferredAudioInputDeviceId() ?? ""}
                  onInput={(event) => void handleAudioInputChange(event)}
                  disabled={isRefreshingDevices()}
                >
                  <option value="">System default microphone</option>
                  {audioInputs().map((device) => (
                    <option value={device.deviceId}>{device.label}</option>
                  ))}
                </select>
              </div>

              <div class="settings-audio-row">
                <label class="settings-label" for="settings-speaker">Speakers</label>
                <select
                  id="settings-speaker"
                  value={preferredAudioOutputDeviceId() ?? ""}
                  onInput={(event) => void handleAudioOutputChange(event)}
                  disabled={!supportsSpeakerSelection || isRefreshingDevices()}
                >
                  <option value="">System default output</option>
                  {audioOutputs().map((device) => (
                    <option value={device.deviceId}>{device.label}</option>
                  ))}
                </select>
                <Show when={!supportsSpeakerSelection}>
                  <p class="settings-help">Speaker selection is not supported in this runtime.</p>
                </Show>
              </div>

                <div class="settings-actions">
                <button type="button" class="settings-secondary" onClick={() => void refreshMediaDevices()}>
                  Refresh devices
                </button>
                <button type="button" class="settings-secondary" onClick={() => void handleResetAudioPreferences()}>
                  Reset audio
                </button>
              </div>

              <div class="settings-audio-row">
                <label class="settings-label" for="settings-camera">Camera</label>
                <select
                  id="settings-camera"
                  value={preferredCameraDeviceId() ?? ""}
                  onInput={(event) => void handleCameraInputChange(event)}
                  disabled={isRefreshingDevices()}
                >
                  <option value="">System default camera</option>
                  {cameraInputs().map((device) => (
                    <option value={device.deviceId}>{device.label}</option>
                  ))}
                </select>
              </div>

              <VoiceAudioPreferences
                voiceAutoLevelEnabled={voiceAutoLevelEnabled()}
                voiceNoiseSuppressionEnabled={voiceNoiseSuppressionEnabled()}
                voiceEchoCancellationEnabled={voiceEchoCancellationEnabled()}
                voiceIncomingVolume={voiceIncomingVolume()}
                voiceOutgoingVolume={voiceOutgoingVolume()}
                onVoiceAutoLevelToggle={handleVoiceAutoLevelToggle}
                onVoiceNoiseSuppressionToggle={handleVoiceNoiseSuppressionToggle}
                onVoiceEchoCancellationToggle={handleVoiceEchoCancellationToggle}
                onVoiceIncomingVolumeInput={handleVoiceIncomingVolumeInput}
                onVoiceOutgoingVolumeInput={handleVoiceOutgoingVolumeInput}
              />

              <Show when={audioError()}>
                <p class="error">{audioError()}</p>
              </Show>
            </section>

            <NotificationSessionSettings
              voiceJoinSoundEnabled={voiceJoinSoundEnabled()}
              voiceLeaveSoundEnabled={voiceLeaveSoundEnabled()}
              onVoiceJoinSoundToggle={handleVoiceJoinSoundToggle}
              onVoiceLeaveSoundToggle={handleVoiceLeaveSoundToggle}
              onLogout={handleLogout}
            />
        </>
      </Modal>
    </>
  );
}
