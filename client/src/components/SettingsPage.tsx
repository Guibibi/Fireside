import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { del, get, patch, post } from "../api/http";
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
  role,
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
  activeSettingsSection,
  closeSettings,
  type SettingsSection,
} from "../stores/settings";
import { openSettings } from "../stores/settings";
import UserAvatar from "./UserAvatar";
import { renameUserProfile, setUserAvatar, upsertUserProfile } from "../stores/userProfiles";
import VoiceAudioPreferences from "./settings/VoiceAudioPreferences";

interface UpdateCurrentUserResponse {
  token: string;
  user_id: string;
  username: string;
  role: string;
  avatar_url: string | null;
}

interface InviteResponse {
  id: string;
  code: string;
  created_by: string;
  creator_username: string;
  single_use: boolean;
  used_count: number;
  max_uses: number | null;
  created_at: string;
  expires_at: string | null;
  revoked: boolean;
}

interface CreateInviteRequest {
  single_use: boolean;
  max_uses?: number;
  expires_at?: string;
}

type InviteExpirationPreset = "none" | "24h" | "7d" | "30d" | "custom";

interface CurrentUserResponse {
  username: string;
  avatar_url: string | null;
}

interface UploadAvatarResponse {
  avatar_url: string;
}

const NAV_ITEMS: { key: SettingsSection; label: string; adminOnly?: boolean }[] = [
  { key: "profile", label: "Profile" },
  { key: "audio", label: "Audio" },
  { key: "invites", label: "Invites", adminOnly: true },
  { key: "notifications", label: "Notifications" },
  { key: "session", label: "Session" },
];

export default function SettingsPage() {
  const navigate = useNavigate();
  const [draftUsername, setDraftUsername] = createSignal(currentUsername() ?? "");
  const [profileError, setProfileError] = createSignal("");
  const [audioError, setAudioError] = createSignal("");
  const [isSavingProfile, setIsSavingProfile] = createSignal(false);
  const [isRefreshingDevices, setIsRefreshingDevices] = createSignal(false);
  const [audioInputs, setAudioInputs] = createSignal<AudioDeviceOption[]>([]);
  const [audioOutputs, setAudioOutputs] = createSignal<AudioDeviceOption[]>([]);
  const [cameraInputs, setCameraInputs] = createSignal<CameraDeviceOption[]>([]);
  const [isUploadingAvatar, setIsUploadingAvatar] = createSignal(false);
  const [invites, setInvites] = createSignal<InviteResponse[]>([]);
  const [inviteError, setInviteError] = createSignal("");
  const [isCreatingInvite, setIsCreatingInvite] = createSignal(false);
  const [copiedInviteId, setCopiedInviteId] = createSignal<string | null>(null);
  const [inviteSingleUse, setInviteSingleUse] = createSignal(true);
  const [inviteMaxUses, setInviteMaxUses] = createSignal("10");
  const [inviteExpirationPreset, setInviteExpirationPreset] = createSignal<InviteExpirationPreset>("none");
  const [inviteExpiresAtLocal, setInviteExpiresAtLocal] = createSignal("");

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
    setDraftUsername(currentUsername() ?? "");
    void refreshMediaDevices();
    void refreshCurrentUserProfile();
    void refreshInvites();
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
      upsertUserProfile({ username: profile.username, avatar_url: profile.avatar_url });
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
      updateAuthIdentity(response.token, response.user_id, response.username, response.role);
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

  async function refreshInvites() {
    try {
      const data = await get<InviteResponse[]>("/invites");
      setInvites(data);
    } catch {
      // non-blocking
    }
  }

  function formatInviteTimestamp(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "Invalid date";
    }

    return date.toLocaleString();
  }

  function formatInviteExpiry(expiresAt: string | null): string {
    if (!expiresAt) {
      return "No expiration";
    }

    const date = new Date(expiresAt);
    if (Number.isNaN(date.getTime())) {
      return "Expiration unavailable";
    }

    return `Expires ${date.toLocaleString()}`;
  }

  function presetExpirationToIso(preset: InviteExpirationPreset): string | null {
    const now = Date.now();
    if (preset === "24h") {
      return new Date(now + 24 * 60 * 60 * 1000).toISOString();
    }

    if (preset === "7d") {
      return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
    }

    if (preset === "30d") {
      return new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
    }

    return null;
  }

  async function handleCreateInvite() {
    setInviteError("");

    const payload: CreateInviteRequest = {
      single_use: inviteSingleUse(),
    };

    if (!inviteSingleUse()) {
      const parsedMaxUses = Number.parseInt(inviteMaxUses().trim(), 10);
      if (!Number.isFinite(parsedMaxUses) || parsedMaxUses < 1) {
        setInviteError("Max uses must be a whole number of at least 1");
        return;
      }

      payload.max_uses = parsedMaxUses;
    }

    if (inviteExpirationPreset() === "custom") {
      const localValue = inviteExpiresAtLocal().trim();
      if (!localValue) {
        setInviteError("Choose an expiration date and time");
        return;
      }

      const expiresAtDate = new Date(localValue);
      if (Number.isNaN(expiresAtDate.getTime())) {
        setInviteError("Expiration date is invalid");
        return;
      }

      if (expiresAtDate.getTime() <= Date.now()) {
        setInviteError("Expiration date must be in the future");
        return;
      }

      payload.expires_at = expiresAtDate.toISOString();
    } else {
      const presetExpiresAt = presetExpirationToIso(inviteExpirationPreset());
      if (presetExpiresAt) {
        payload.expires_at = presetExpiresAt;
      }
    }

    setIsCreatingInvite(true);
    try {
      const invite = await post<InviteResponse>("/invites", payload);
      setInvites((prev) => [invite, ...prev]);
    } catch (err) {
      setInviteError(errorMessage(err, "Failed to create invite"));
    } finally {
      setIsCreatingInvite(false);
    }
  }

  async function handleRevokeInvite(id: string) {
    setInviteError("");
    try {
      await del<unknown>(`/invites/${id}`);
      setInvites((prev) => prev.map((inv) => inv.id === id ? { ...inv, revoked: true } : inv));
    } catch (err) {
      setInviteError(errorMessage(err, "Failed to revoke invite"));
    }
  }

  function handleCopyInviteLink(code: string, id: string) {
    const link = `${window.location.origin}/invite/${code}`;
    void navigator.clipboard.writeText(link).then(() => {
      setCopiedInviteId(id);
      setTimeout(() => setCopiedInviteId(null), 2000);
    });
  }

  function handleLogout() {
    cleanupMediaTransports();
    disconnect();
    resetChatState();
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
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z" fill="currentColor" />
            </svg>
          </button>
        </div>

        <div class="settings-content-body">
          <Show when={activeSettingsSection() === "profile"}>
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
          </Show>

          <Show when={activeSettingsSection() === "audio"}>
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
          </Show>

          <Show when={activeSettingsSection() === "invites" && (role() === "operator" || role() === "admin")}>
            <section class="settings-section">
              <h5>Invites</h5>

              <div class="invite-create-options">
                <label class="settings-checkbox" for="settings-invite-single-use">
                  <input
                    id="settings-invite-single-use"
                    type="checkbox"
                    checked={inviteSingleUse()}
                    onInput={(event) => setInviteSingleUse(event.currentTarget.checked)}
                  />
                  Single-use invite
                </label>

                <Show when={!inviteSingleUse()}>
                  <div class="settings-audio-row invite-option-row">
                    <label class="settings-label" for="settings-invite-max-uses">Max uses</label>
                    <input
                      id="settings-invite-max-uses"
                      type="number"
                      min="1"
                      step="1"
                      value={inviteMaxUses()}
                      onInput={(event) => setInviteMaxUses(event.currentTarget.value)}
                    />
                  </div>
                </Show>

                <div class="settings-audio-row invite-option-row">
                  <label class="settings-label" for="settings-invite-expiration-preset">Expiration</label>
                  <select
                    id="settings-invite-expiration-preset"
                    value={inviteExpirationPreset()}
                    onInput={(event) => setInviteExpirationPreset(event.currentTarget.value as InviteExpirationPreset)}
                  >
                    <option value="none">No expiration</option>
                    <option value="24h">24 hours</option>
                    <option value="7d">7 days</option>
                    <option value="30d">30 days</option>
                    <option value="custom">Custom date/time</option>
                  </select>
                </div>

                <Show when={inviteExpirationPreset() === "custom"}>
                  <div class="settings-audio-row invite-option-row">
                    <label class="settings-label" for="settings-invite-expires-at">Expiration date</label>
                    <input
                      id="settings-invite-expires-at"
                      type="datetime-local"
                      value={inviteExpiresAtLocal()}
                      onInput={(event) => setInviteExpiresAtLocal(event.currentTarget.value)}
                    />
                  </div>
                </Show>
              </div>

              <div class="settings-actions">
                <button type="button" onClick={() => void handleCreateInvite()} disabled={isCreatingInvite()}>
                  {isCreatingInvite() ? "Creating..." : "Create invite"}
                </button>
              </div>
              <Show when={inviteError()}>
                <p class="error">{inviteError()}</p>
              </Show>
              <div class="invite-list">
                <For each={invites()}>
                  {(invite) => (
                    <div class={`invite-card ${invite.revoked ? "invite-revoked" : ""}`}>
                      <div class="invite-card-header">
                        <code class="invite-code">{invite.code}</code>
                        <Show when={!invite.revoked}>
                          <button
                            type="button"
                            class="invite-copy-btn"
                            onClick={() => handleCopyInviteLink(invite.code, invite.id)}
                          >
                            {copiedInviteId() === invite.id ? "Copied" : "Copy link"}
                          </button>
                        </Show>
                      </div>
                      <div class="invite-card-meta">
                        <span>
                          {invite.single_use ? "Single-use" : "Multi-use"}
                          {invite.max_uses != null ? ` (${invite.used_count}/${invite.max_uses})` : ` (${invite.used_count} used)`}
                        </span>
                        <span>{formatInviteExpiry(invite.expires_at)}</span>
                        <span>Created {formatInviteTimestamp(invite.created_at)}</span>
                        {invite.revoked && <span class="invite-badge-revoked">Revoked</span>}
                      </div>
                      <Show when={!invite.revoked}>
                        <button
                          type="button"
                          class="invite-revoke-btn"
                          onClick={() => void handleRevokeInvite(invite.id)}
                        >
                          Revoke
                        </button>
                      </Show>
                    </div>
                  )}
                </For>
                <Show when={invites().length === 0}>
                  <p class="settings-help">No invites yet.</p>
                </Show>
              </div>
            </section>
          </Show>

          <Show when={activeSettingsSection() === "notifications"}>
            <section class="settings-section">
              <h5>Notifications</h5>
              <label class="settings-checkbox" for="settings-voice-join-sound-enabled">
                <input
                  id="settings-voice-join-sound-enabled"
                  type="checkbox"
                  checked={voiceJoinSoundEnabled()}
                  onInput={handleVoiceJoinSoundToggle}
                />
                Play sound when someone joins your current voice channel
              </label>

              <label class="settings-checkbox" for="settings-voice-leave-sound-enabled">
                <input
                  id="settings-voice-leave-sound-enabled"
                  type="checkbox"
                  checked={voiceLeaveSoundEnabled()}
                  onInput={handleVoiceLeaveSoundToggle}
                />
                Play sound when someone leaves your current voice channel
              </label>
            </section>
          </Show>

          <Show when={activeSettingsSection() === "session"}>
            <section class="settings-section">
              <h5>Session</h5>
              <p class="settings-help">Sign out from this server and return to connect screen.</p>
              <div class="settings-actions">
                <button type="button" class="settings-danger" onClick={handleLogout}>Log out</button>
              </div>
            </section>
          </Show>
        </div>
      </div>
    </div>
  );
}
