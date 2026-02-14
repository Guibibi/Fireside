import { Show, createSignal, onCleanup } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { patch } from "../api/http";
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
import { connect, disconnect } from "../api/ws";
import {
  clearAuth,
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
  avatarPlaceholderName,
  preferredAudioInputDeviceId,
  preferredAudioOutputDeviceId,
  preferredCameraDeviceId,
  saveAvatarPlaceholderName,
} from "../stores/settings";
import Modal from "./Modal";

interface UpdateCurrentUserResponse {
  token: string;
  username: string;
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
  const [avatarPreviewUrl, setAvatarPreviewUrl] = createSignal<string | null>(null);
  const [avatarPreviewBroken, setAvatarPreviewBroken] = createSignal(false);

  const supportsSpeakerSelection = isSpeakerSelectionSupported();

  function openSettings() {
    setDraftUsername(currentUsername() ?? "");
    setProfileError("");
    setAudioError("");
    setIsOpen(true);
    void refreshMediaDevices();
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

    const avatarNameValue = avatarPlaceholderName()?.trim();
    if (avatarNameValue && avatarNameValue.length > 0) {
      return avatarNameValue.slice(0, 1).toUpperCase();
    }

    return "?";
  }

  function hasAvatarPreview() {
    return !!avatarPreviewUrl() && !avatarPreviewBroken();
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
      setAudioError(error instanceof Error ? error.message : "Failed to load media devices");
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

      updateAuthIdentity(response.token, response.username);
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
      setProfileError(error instanceof Error ? error.message : "Failed to update profile");
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function handleAudioInputChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    setAudioError("");

    try {
      await setPreferredMicrophoneDevice(value || null);
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : "Failed to switch microphone device");
    }
  }

  async function handleAudioOutputChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    setAudioError("");

    try {
      await setPreferredSpeakerDevice(value || null);
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : "Failed to switch speaker device");
    }
  }

  async function handleCameraInputChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    setAudioError("");

    try {
      await setPreferredCameraDevice(value || null);
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : "Failed to switch camera device");
    }
  }

  async function handleResetAudioPreferences() {
    setAudioError("");
    try {
      await resetPreferredAudioDevices();
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : "Failed to reset audio preferences");
    }
  }

  function handleAvatarInput(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }

    saveAvatarPlaceholderName(file.name);
    const previousPreview = avatarPreviewUrl();
    if (previousPreview) {
      URL.revokeObjectURL(previousPreview);
    }

    setAvatarPreviewBroken(false);
    setAvatarPreviewUrl(URL.createObjectURL(file));
  }

  function clearAvatarPlaceholder() {
    const preview = avatarPreviewUrl();
    if (preview) {
      URL.revokeObjectURL(preview);
    }

    setAvatarPreviewUrl(null);
    setAvatarPreviewBroken(false);
    saveAvatarPlaceholderName(null);
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

  onCleanup(() => {
    const preview = avatarPreviewUrl();
    if (preview) {
      URL.revokeObjectURL(preview);
    }
  });

  return (
    <>
      <div class="user-dock">
        <div class={`user-dock-avatar${avatarPlaceholderName() ? " is-placeholder" : ""}`} aria-hidden="true">
          <Show when={hasAvatarPreview()} fallback={<span>{avatarFallbackLabel()}</span>}>
            <img src={avatarPreviewUrl() ?? ""} alt="" onError={() => setAvatarPreviewBroken(true)} />
          </Show>
        </div>
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

              <label class="settings-label" for="settings-avatar">Avatar (placeholder)</label>
              <input id="settings-avatar" type="file" accept="image/*" onChange={handleAvatarInput} />
              <Show when={hasAvatarPreview()}>
                <div class="settings-avatar-preview">
                  <img src={avatarPreviewUrl() ?? ""} alt="Avatar preview" onError={() => setAvatarPreviewBroken(true)} />
                </div>
              </Show>
              <Show when={avatarPlaceholderName()}>
                <p class="settings-help">Selected: {avatarPlaceholderName()}</p>
              </Show>
              <Show when={avatarPlaceholderName()}>
                <button type="button" class="settings-secondary" onClick={clearAvatarPlaceholder}>Clear avatar placeholder</button>
              </Show>

              <Show when={profileError()}>
                <p class="error">{profileError()}</p>
              </Show>

              <div class="settings-actions">
                <button type="submit" disabled={isSavingProfile()}>
                  {isSavingProfile() ? "Saving..." : "Save profile"}
                </button>
              </div>
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

              <Show when={audioError()}>
                <p class="error">{audioError()}</p>
              </Show>
            </section>

            <section class="settings-section">
              <h5>Session</h5>
              <p class="settings-help">Sign out from this server and return to connect screen.</p>
              <div class="settings-actions">
                <button type="button" class="settings-danger" onClick={handleLogout}>Log out</button>
              </div>
            </section>
        </>
      </Modal>
    </>
  );
}
