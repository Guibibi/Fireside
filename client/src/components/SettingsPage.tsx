import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { patch } from "../api/http";
import { errorMessage } from "../utils/error";
import { CloseIcon } from "./icons";
import { EmojiSettings, InviteSettings } from "./settings-sections";
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
import { disconnect } from "../api/ws";
import { updateOutgoingMicrophoneGain } from "../api/media/microphoneProcessing";
import {
  clearAuth,
  getApiBaseUrl,
  role,
  token,
  serverUrl,
  username as currentUsername,
} from "../stores/auth";
import { resetChatState } from "../stores/chat";
import { resetDmState } from "../stores/dms";
import { resetVoiceState } from "../stores/voice";
import {
  preferredAudioInputDeviceId,
  preferredAudioOutputDeviceId,
  preferredCameraDeviceId,
  saveVoiceAutoLevelEnabled,
  saveVoiceEchoCancellationEnabled,
  saveVoiceIncomingVolume,
  saveVoiceJoinSoundEnabled,
  saveVoiceLeaveSoundEnabled,
  saveMessageNotificationSoundEnabled,
  saveMentionDesktopNotificationsEnabled,
  saveVoiceNoiseSuppressionEnabled,
  saveVoiceOutgoingVolume,
  voiceAutoLevelEnabled,
  voiceEchoCancellationEnabled,
  voiceIncomingVolume,
  voiceJoinSoundEnabled,
  voiceLeaveSoundEnabled,
  messageNotificationSoundEnabled,
  mentionDesktopNotificationsEnabled,
  voiceNoiseSuppressionEnabled,
  voiceOutgoingVolume,
  activeSettingsSection,
  closeSettings,
  type SettingsSection,
} from "../stores/settings";
import { openSettings } from "../stores/settings";
import UserAvatar from "./UserAvatar";
import { displayNameFor, setUserAvatar, upsertUserProfile } from "../stores/userProfiles";
import VoiceAudioPreferences from "./settings/VoiceAudioPreferences";
import UpdaterSettings from "./settings/UpdaterSettings";
import {
  desktopNotificationsSupported,
  requestDesktopNotificationPermission,
} from "../utils/desktopNotifications";

interface UpdateCurrentUserResponse {
  token: string;
  user_id: string;
  username: string;
  display_name: string;
  role: string;
  avatar_url: string | null;
  profile_description: string | null;
  profile_status: string | null;
}

interface CurrentUserResponse {
  username: string;
  display_name: string;
  avatar_url: string | null;
  profile_description: string | null;
  profile_status: string | null;
}

interface UploadAvatarResponse {
  avatar_url: string;
}

const NAV_ITEMS: { key: SettingsSection; label: string; adminOnly?: boolean }[] = [
  { key: "profile", label: "Profile" },
  { key: "audio", label: "Audio" },
  { key: "invites", label: "Invites", adminOnly: true },
  { key: "emojis", label: "Emojis", adminOnly: true },
  { key: "notifications", label: "Notifications" },
  { key: "session", label: "Session" },
];

export default function SettingsPage() {
  const navigate = useNavigate();
  const [draftDisplayName, setDraftDisplayName] = createSignal("");
  const [draftProfileDescription, setDraftProfileDescription] = createSignal("");
  const [draftProfileStatus, setDraftProfileStatus] = createSignal("");
  const [profileError, setProfileError] = createSignal("");
  const [audioError, setAudioError] = createSignal("");
  const [notificationError, setNotificationError] = createSignal("");
  const [isSavingProfile, setIsSavingProfile] = createSignal(false);
  const [isRefreshingDevices, setIsRefreshingDevices] = createSignal(false);
  const [audioInputs, setAudioInputs] = createSignal<AudioDeviceOption[]>([]);
  const [audioOutputs, setAudioOutputs] = createSignal<AudioDeviceOption[]>([]);
  const [cameraInputs, setCameraInputs] = createSignal<CameraDeviceOption[]>([]);
  const [isUploadingAvatar, setIsUploadingAvatar] = createSignal(false);

  const supportsSpeakerSelection = isSpeakerSelectionSupported();

  createEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSettings();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
    });
  });

  onMount(() => {
    const usernameValue = currentUsername();
    setDraftDisplayName(usernameValue ? displayNameFor(usernameValue) : "");
    void refreshMediaDevices();
    void refreshCurrentUserProfile();
  });

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
      upsertUserProfile({
        username: profile.username,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        profile_description: profile.profile_description,
        profile_status: profile.profile_status,
      });
      setDraftDisplayName(profile.display_name);
      setDraftProfileDescription(profile.profile_description ?? "");
      setDraftProfileStatus(profile.profile_status ?? "");
    } catch {
      // no-op
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

    const nextDisplayName = draftDisplayName().trim();
    const nextProfileDescription = draftProfileDescription().trim();
    const nextProfileStatus = draftProfileStatus().trim();
    if (nextDisplayName.length < 1 || nextDisplayName.length > 32) {
      setProfileError("Display name must be between 1 and 32 characters");
      return;
    }

    if (nextProfileDescription.length > 280) {
      setProfileError("Profile description must be 280 characters or fewer");
      return;
    }

    if (nextProfileStatus.length > 80) {
      setProfileError("Profile status must be 80 characters or fewer");
      return;
    }

    setIsSavingProfile(true);
    try {
      const response = await patch<UpdateCurrentUserResponse>("/users/me", {
        display_name: nextDisplayName,
        profile_description: nextProfileDescription.length > 0 ? nextProfileDescription : null,
        profile_status: nextProfileStatus.length > 0 ? nextProfileStatus : null,
      });

      upsertUserProfile({
        username: response.username,
        display_name: response.display_name,
        avatar_url: response.avatar_url,
        profile_description: response.profile_description,
        profile_status: response.profile_status,
      });
      setDraftDisplayName(response.display_name);
      setDraftProfileDescription(response.profile_description ?? "");
      setDraftProfileStatus(response.profile_status ?? "");
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

  async function handleAvatarInput(input: HTMLInputElement) {
    const file = input.files?.[0];
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
      input.value = "";
    }
  }

  function handleVoiceJoinSoundToggle(event: Event) {
    saveVoiceJoinSoundEnabled((event.currentTarget as HTMLInputElement).checked);
  }

  function handleVoiceLeaveSoundToggle(event: Event) {
    saveVoiceLeaveSoundEnabled((event.currentTarget as HTMLInputElement).checked);
  }

  async function handleMentionDesktopNotificationsToggle(event: Event) {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    setNotificationError("");

    if (!enabled) {
      saveMentionDesktopNotificationsEnabled(false);
      return;
    }

    if (!desktopNotificationsSupported()) {
      setNotificationError("Desktop notifications are not supported in this browser.");
      return;
    }

    const permission = await requestDesktopNotificationPermission();
    saveMentionDesktopNotificationsEnabled(permission === "granted");
    if (permission !== "granted") {
      setNotificationError("Desktop notification permission was not granted.");
    }
  }

  function handleMessageNotificationSoundToggle(event: Event) {
    saveMessageNotificationSoundEnabled((event.currentTarget as HTMLInputElement).checked);
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
    resetDmState();
    resetVoiceState();
    clearAuth();
    closeSettings();
    navigate("/login");
  }

  const visibleNavItems = () => {
    const userRole = role();
    return NAV_ITEMS.filter((item) => !item.adminOnly || userRole === "operator" || userRole === "admin");
  };

  return (
    <div class="settings-page">
      <nav class="settings-nav">
        <h4 class="settings-nav-title">Settings</h4>
        <div class="settings-nav-items">
          <For each={visibleNavItems()}>
            {(item) => (
              <button
                type="button"
                class={`settings-nav-item${activeSettingsSection() === item.key ? " settings-nav-item-active" : ""}`}
                onClick={() => openSettings(item.key)}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>
      </nav>

      <div class="settings-content">
        <div class="settings-content-header">
          <h4 class="settings-content-title">
            {visibleNavItems().find((i) => i.key === activeSettingsSection())?.label ?? "Settings"}
          </h4>
          <button
            type="button"
            class="settings-close-btn"
            onClick={closeSettings}
            aria-label="Close settings"
            title="Close settings (Esc)"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        <div class="settings-content-body">
          <Show when={activeSettingsSection() === "profile"}>
            <form class="settings-section" onSubmit={(event) => void handleSaveProfile(event)}>
              <div class="settings-section-head">
                <h5>Profile</h5>
                <p class="settings-help">Manage your display identity for this server.</p>
              </div>

              <div class="settings-profile-grid">
                <section class="settings-profile-card">
                  <h6>Identity</h6>
                  <label class="settings-label" for="settings-display-name">Display name</label>
                  <input
                    id="settings-display-name"
                    type="text"
                    value={draftDisplayName()}
                    maxlength={32}
                    onInput={(event) => setDraftDisplayName(event.currentTarget.value)}
                    disabled={isSavingProfile()}
                  />
                  <p class="settings-help">Username (login): {currentUsername() ?? "Unknown"}</p>
                  <p class="settings-help">Server URL: {serverUrl()}</p>

                  <label class="settings-label" for="settings-profile-status">Profile status</label>
                  <input
                    id="settings-profile-status"
                    type="text"
                    value={draftProfileStatus()}
                    maxlength={80}
                    onInput={(event) => setDraftProfileStatus(event.currentTarget.value)}
                    disabled={isSavingProfile()}
                  />

                  <label class="settings-label" for="settings-profile-description">Profile description</label>
                  <textarea
                    id="settings-profile-description"
                    rows={4}
                    value={draftProfileDescription()}
                    maxlength={280}
                    onInput={(event) => setDraftProfileDescription(event.currentTarget.value)}
                    disabled={isSavingProfile()}
                  />
                </section>

                <section class="settings-profile-card">
                  <h6>Avatar</h6>
                  <div class="settings-avatar-preview">
                    <UserAvatar username={currentUsername() ?? avatarFallbackLabel()} size={72} />
                  </div>
                  <label class="settings-label" for="settings-avatar">Upload new image</label>
                  <input id="settings-avatar" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void handleAvatarInput(event.currentTarget)} disabled={isUploadingAvatar()} />
                  <p class="settings-help">JPEG, PNG, or WebP. Max size 2 MB.</p>
                </section>
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
          </Show>

          <Show when={activeSettingsSection() === "audio"}>
            <section class="settings-section settings-audio-panel">
              <div class="settings-section-head">
                <h5>Audio</h5>
                <p class="settings-help">Choose devices and tune processing so voice chats stay clear and balanced.</p>
              </div>

              <div class="settings-audio-device-grid">
                <div class="settings-audio-card">
                  <label class="settings-label" for="settings-microphone">Microphone</label>
                  <p class="settings-help">Input source for your outgoing voice.</p>
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

                <div class="settings-audio-card">
                  <label class="settings-label" for="settings-speaker">Speakers</label>
                  <p class="settings-help">Output target for incoming voice audio.</p>
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

                <div class="settings-audio-card settings-audio-card-wide">
                  <label class="settings-label" for="settings-camera">Camera</label>
                  <p class="settings-help">Camera used when enabling video.</p>
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
              </div>

              <div class="settings-actions settings-audio-actions">
                <button type="button" class="settings-secondary" onClick={() => void refreshMediaDevices()}>
                  Refresh devices
                </button>
                <button type="button" class="settings-secondary" onClick={() => void handleResetAudioPreferences()}>
                  Reset audio
                </button>
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
          </Show>

          <Show when={activeSettingsSection() === "invites"}>
            <InviteSettings isOperatorOrAdmin={role() === "operator" || role() === "admin"} />
          </Show>

          <Show when={activeSettingsSection() === "emojis"}>
            <EmojiSettings isOperatorOrAdmin={role() === "operator" || role() === "admin"} />
          </Show>

          <Show when={activeSettingsSection() === "notifications"}>
            <section class="settings-section">
              <div class="settings-section-head">
                <h5>Notifications</h5>
                <p class="settings-help">Choose which cues and alerts you want while chatting.</p>
              </div>

              <div class="settings-notification-stack">
                <label class="settings-toggle-card" for="settings-voice-join-sound-enabled">
                  <span class="settings-toggle-copy">
                    <span class="settings-toggle-title">Join voice cue</span>
                    <span class="settings-help">Play a sound when someone joins your current voice channel.</span>
                  </span>
                  <input
                    id="settings-voice-join-sound-enabled"
                    type="checkbox"
                    checked={voiceJoinSoundEnabled()}
                    onInput={handleVoiceJoinSoundToggle}
                  />
                </label>

                <label class="settings-toggle-card" for="settings-voice-leave-sound-enabled">
                  <span class="settings-toggle-copy">
                    <span class="settings-toggle-title">Leave voice cue</span>
                    <span class="settings-help">Play a sound when someone leaves your current voice channel.</span>
                  </span>
                  <input
                    id="settings-voice-leave-sound-enabled"
                    type="checkbox"
                    checked={voiceLeaveSoundEnabled()}
                    onInput={handleVoiceLeaveSoundToggle}
                  />
                </label>

                <label class="settings-toggle-card" for="settings-message-notification-sound-enabled">
                  <span class="settings-toggle-copy">
                    <span class="settings-toggle-title">Message cue</span>
                    <span class="settings-help">Play a sound for new messages when the app or channel is not focused.</span>
                  </span>
                  <input
                    id="settings-message-notification-sound-enabled"
                    type="checkbox"
                    checked={messageNotificationSoundEnabled()}
                    onInput={handleMessageNotificationSoundToggle}
                  />
                </label>

                <label class="settings-toggle-card" for="settings-mention-desktop-notifications-enabled">
                  <span class="settings-toggle-copy">
                    <span class="settings-toggle-title">Mention desktop alerts</span>
                    <span class="settings-help">Show desktop notifications when someone mentions you.</span>
                  </span>
                  <input
                    id="settings-mention-desktop-notifications-enabled"
                    type="checkbox"
                    checked={mentionDesktopNotificationsEnabled()}
                    onInput={(event) => void handleMentionDesktopNotificationsToggle(event)}
                  />
                </label>
              </div>

              <Show when={notificationError()}>
                <p class="error">{notificationError()}</p>
              </Show>
            </section>
          </Show>

          <Show when={activeSettingsSection() === "session"}>
            <>
              <UpdaterSettings />
              <section class="settings-section">
                <h5>Session</h5>
                <p class="settings-help">Sign out from this server and return to connect screen.</p>
                <div class="settings-actions">
                  <button type="button" class="settings-danger" onClick={handleLogout}>Log out</button>
                </div>
              </section>
            </>
          </Show>
        </div>
      </div>
    </div>
  );
}
