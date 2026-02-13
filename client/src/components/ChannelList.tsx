import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { del, get, post } from "../api/http";
import {
  cleanupMediaTransports,
  initializeMediaTransports,
  startLocalCameraProducer,
  stopLocalCameraProducer,
  setMicrophoneMuted,
  setSpeakersMuted,
} from "../api/media";
import { connect, onClose, onMessage, send } from "../api/ws";
import {
  activeChannelId,
  Channel,
  clearUnread,
  incrementUnread,
  removeUnreadChannel,
  setActiveChannelId,
  unreadCount,
} from "../stores/chat";
import {
  applyVoiceJoined,
  applyVoiceLeft,
  applyVoiceSpeaking,
  applyVoiceSnapshot,
  clearVoiceRejoinNotice,
  clearVoiceCameraError,
  cameraEnabled,
  cameraError,
  isVoiceMemberSpeaking,
  joinedVoiceChannelId,
  micMuted,
  participantsByChannel,
  resetVoiceMediaState,
  removeVoiceChannelState,
  setJoinedVoiceChannel,
  setVoiceCameraError,
  setVoiceActionState,
  speakerMuted,
  startVideoTilesSubscription,
  showVoiceRejoinNotice,
  stopVideoTilesSubscription,
  syncCameraStateFromMedia,
  toggleMicMuted,
  toggleSpeakerMuted,
  voiceRejoinNotice,
  voiceActionState,
} from "../stores/voice";
import UserSettingsDock from "./UserSettingsDock";

async function fetchChannels() {
  return get<Channel[]>("/channels");
}

export default function ChannelList() {
  const [channels, setChannels] = createSignal<Channel[]>([]);
  const [newChannelName, setNewChannelName] = createSignal("");
  const [newChannelKind, setNewChannelKind] = createSignal<Channel["kind"]>("text");
  const [isLoading, setIsLoading] = createSignal(true);
  const [isSaving, setIsSaving] = createSignal(false);
  const [loadError, setLoadError] = createSignal("");
  const [toastError, setToastError] = createSignal("");
  const [cameraActionPending, setCameraActionPending] = createSignal(false);
  const [pulsingByChannel, setPulsingByChannel] = createSignal<Record<string, boolean>>({});
  const pulseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  function showErrorToast(message: string) {
    setToastError(message);
    if (toastTimer) {
      clearTimeout(toastTimer);
    }

    toastTimer = setTimeout(() => {
      toastTimer = null;
      setToastError("");
    }, 3500);
  }

  function ensureValidActiveChannel(nextChannels: Channel[]) {
    const selected = activeChannelId();
    const selectedStillExists = selected ? nextChannels.some((channel) => channel.id === selected) : false;

    if (selectedStillExists) {
      return;
    }

    setActiveChannelId(nextChannels[0]?.id ?? null);
  }

  function joinVoiceChannel(channelId: string) {
    if (voiceActionState() !== "idle" || joinedVoiceChannelId() === channelId) {
      return;
    }

    setVoiceActionState("joining");
    send({ type: "join_voice", channel_id: channelId });
  }

  function leaveVoiceChannel() {
    const channelId = joinedVoiceChannelId();
    if (!channelId || voiceActionState() !== "idle") {
      return;
    }

    setVoiceActionState("leaving");
    send({ type: "leave_voice", channel_id: channelId });
  }

  function handleToggleMicMuted() {
    const nextMuted = !micMuted();
    toggleMicMuted();
    setMicrophoneMuted(nextMuted);
  }

  function handleToggleSpeakerMuted() {
    const nextMuted = !speakerMuted();
    toggleSpeakerMuted();
    setSpeakersMuted(nextMuted);
  }

  async function handleToggleCamera() {
    const channelId = joinedVoiceChannelId();
    if (!channelId || cameraActionPending()) {
      return;
    }

    setCameraActionPending(true);
    clearVoiceCameraError();

    try {
      const result = cameraEnabled()
        ? await stopLocalCameraProducer(channelId)
        : await startLocalCameraProducer(channelId);

      if (!result.ok && result.error) {
        setVoiceCameraError(result.error);
        showErrorToast(result.error);
      }
    } finally {
      syncCameraStateFromMedia();
      setCameraActionPending(false);
    }
  }

  function selectChannel(channel: Channel) {
    if (channel.kind === "voice") {
      joinVoiceChannel(channel.id);
      return;
    }

    setActiveChannelId(channel.id);
    clearUnread(channel.id);
  }

  function clearActiveChannelUnread() {
    const selected = activeChannelId();
    if (selected) {
      clearUnread(selected);
    }
  }

  function formatUnreadBadge(channelId: string) {
    const count = unreadCount(channelId);
    if (count <= 0) {
      return "";
    }

    return count > 99 ? "99+" : String(count);
  }

  function voiceMembers(channelId: string) {
    return participantsByChannel()[channelId] ?? [];
  }

  function pulseBadge(channelId: string) {
    const existingTimer = pulseTimers.get(channelId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    setPulsingByChannel((current) => ({ ...current, [channelId]: true }));

    const timer = setTimeout(() => {
      pulseTimers.delete(channelId);
      setPulsingByChannel((current) => {
        const next = { ...current };
        delete next[channelId];
        return next;
      });
    }, 420);

    pulseTimers.set(channelId, timer);
  }

  async function loadInitialChannels() {
    setIsLoading(true);
    setLoadError("");
    try {
      const loaded = await fetchChannels();
      const sorted = [...loaded].sort((a, b) => a.position - b.position);
      setChannels(sorted);
      ensureValidActiveChannel(sorted);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load channels");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateChannel(e: Event) {
    e.preventDefault();
    if (isSaving()) {
      return;
    }

    const trimmed = newChannelName().trim();
    if (!trimmed) {
      showErrorToast("Channel name is required");
      return;
    }

    setIsSaving(true);
    setLoadError("");
    try {
      await post<Channel>("/channels", {
        name: trimmed,
        kind: newChannelKind(),
      });
      setNewChannelName("");
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : "Failed to create channel");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteChannel(channel: Channel) {
    if (isSaving()) {
      return;
    }

    const confirmed = window.confirm(`Delete #${channel.name}?`);
    if (!confirmed) {
      return;
    }

    setIsSaving(true);
    try {
      await del<{ deleted: true }>(`/channels/${channel.id}`);
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : "Failed to delete channel");
    } finally {
      setIsSaving(false);
    }
  }

  onMount(() => {
    connect();
    void loadInitialChannels();

    const handleWindowFocus = () => {
      clearActiveChannelUnread();
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        clearActiveChannelUnread();
      }
    };

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const unsubscribe = onMessage((msg) => {
      if (msg.type === "channel_created") {
        setChannels((current) => {
          const next = current.some((channel) => channel.id === msg.channel.id)
            ? current.map((channel) => (channel.id === msg.channel.id ? msg.channel : channel))
            : [...current, msg.channel];
          const sorted = next.sort((a, b) => a.position - b.position);
          ensureValidActiveChannel(sorted);
          return sorted;
        });
        return;
      }

      if (msg.type === "channel_deleted") {
        if (joinedVoiceChannelId() === msg.id) {
          setJoinedVoiceChannel(null);
          setVoiceActionState("idle");
          cleanupMediaTransports();
          resetVoiceMediaState();
        }

        removeVoiceChannelState(msg.id);
        setChannels((current) => {
          const next = current.filter((channel) => channel.id !== msg.id);
          ensureValidActiveChannel(next);
          return next;
        });
        removeUnreadChannel(msg.id);
        return;
      }

      if (msg.type === "channel_activity") {
        if (msg.channel_id !== activeChannelId()) {
          incrementUnread(msg.channel_id);
          pulseBadge(msg.channel_id);
        }
        return;
      }

      if (msg.type === "voice_presence_snapshot") {
        applyVoiceSnapshot(msg.channels);
        return;
      }

      if (msg.type === "voice_user_joined") {
        applyVoiceJoined(msg.channel_id, msg.username);
        return;
      }

      if (msg.type === "voice_user_left") {
        applyVoiceLeft(msg.channel_id, msg.username);
        return;
      }

      if (msg.type === "voice_user_speaking") {
        applyVoiceSpeaking(msg.channel_id, msg.username, msg.speaking);
        return;
      }

      if (msg.type === "voice_joined") {
        setJoinedVoiceChannel(msg.channel_id);
        startVideoTilesSubscription();
        clearVoiceRejoinNotice();
        setVoiceActionState("idle");
        void initializeMediaTransports(msg.channel_id).catch((error) => {
          showErrorToast(error instanceof Error ? error.message : "Failed to initialize media transports");
        }).finally(() => {
          syncCameraStateFromMedia();
        });
        setMicrophoneMuted(micMuted());
        setSpeakersMuted(speakerMuted());
        return;
      }

      if (msg.type === "voice_left") {
        if (joinedVoiceChannelId() === msg.channel_id) {
          setJoinedVoiceChannel(null);
          cleanupMediaTransports();
          resetVoiceMediaState();
        }
        setVoiceActionState("idle");
        return;
      }

      if (msg.type === "error" && voiceActionState() !== "idle") {
        setVoiceActionState("idle");
        showErrorToast(msg.message);
      }
    });

    const unsubscribeClose = onClose(() => {
      if (!joinedVoiceChannelId()) {
        return;
      }

      cleanupMediaTransports();
      setJoinedVoiceChannel(null);
      stopVideoTilesSubscription();
      syncCameraStateFromMedia();
      setVoiceActionState("idle");
      showVoiceRejoinNotice();
    });

    onCleanup(() => {
      pulseTimers.forEach((timer) => clearTimeout(timer));
      pulseTimers.clear();
      if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      unsubscribe();
      unsubscribeClose();
    });
  });

  const sortedChannels = () => [...channels()].sort((a, b) => a.position - b.position);
  const connectedVoiceChannelName = () => {
    const connectedChannelId = joinedVoiceChannelId();
    if (!connectedChannelId) {
      return null;
    }

    const channel = sortedChannels().find((entry) => entry.id === connectedChannelId);
    return channel ? channel.name : "Unknown channel";
  };

  createEffect(() => {
    clearActiveChannelUnread();
  });

  return (
    <div class="channel-list">
      <h3>Channels</h3>
      <Show when={!isLoading()} fallback={<p class="placeholder">Loading channels...</p>}>
      <Show when={!loadError() || sortedChannels().length > 0} fallback={<p class="error">{loadError()}</p>}>
        <Show when={sortedChannels().length > 0} fallback={<p class="placeholder">No channels available</p>}>
          <ul class="channel-items">
            <For each={sortedChannels()}>
              {(channel) => (
                <li class="channel-row">
                  <div class="channel-row-main">
                    <button
                      type="button"
                      class={`channel-item${activeChannelId() === channel.id ? " is-active" : ""}${joinedVoiceChannelId() === channel.id ? " is-voice-connected" : ""}`}
                      onClick={() => selectChannel(channel)}
                    >
                      <span class="channel-prefix">{channel.kind === "voice" ? "~" : "#"}</span>
                      <span class="channel-name">{channel.name}</span>
                      <Show when={unreadCount(channel.id) > 0}>
                        <span class={`channel-badge${pulsingByChannel()[channel.id] ? " is-pulsing" : ""}`}>
                          {formatUnreadBadge(channel.id)}
                        </span>
                      </Show>
                    </button>
                    <button
                      type="button"
                      class="channel-delete"
                      onClick={() => void handleDeleteChannel(channel)}
                      disabled={isSaving()}
                      title="Delete channel"
                    >
                      x
                    </button>
                  </div>
                  <Show
                    when={
                      channel.kind === "voice"
                      && voiceMembers(channel.id).length > 0
                    }
                  >
                    <ul class="channel-voice-members">
                      <For each={voiceMembers(channel.id)}>
                        {(username) => (
                          <li class="channel-voice-member">
                            <span
                              class={`channel-voice-member-dot${isVoiceMemberSpeaking(channel.id, username) ? " is-speaking" : ""}`}
                              aria-hidden="true"
                            />
                            <span>{username}</span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <form class="channel-create" onSubmit={(e) => void handleCreateChannel(e)}>
          <input
            type="text"
            value={newChannelName()}
            onInput={(e) => setNewChannelName(e.currentTarget.value)}
            placeholder="New channel"
            maxlength={100}
            disabled={isSaving()}
          />
          <select
            value={newChannelKind()}
            onInput={(e) => setNewChannelKind(e.currentTarget.value as Channel["kind"])}
            disabled={isSaving()}
          >
            <option value="text">text</option>
            <option value="voice">voice</option>
          </select>
          <button type="submit" disabled={isSaving()}>Create</button>
        </form>

        <div class="channel-footer">
          <Show when={voiceRejoinNotice() && !joinedVoiceChannelId()}>
            <div class="channel-footer-banner" role="status" aria-live="polite">
              <span>Voice disconnected after profile update. Click a voice channel to rejoin.</span>
              <button
                type="button"
                class="channel-footer-banner-dismiss"
                onClick={clearVoiceRejoinNotice}
                aria-label="Dismiss voice rejoin notice"
              >
                Dismiss
              </button>
            </div>
          </Show>
          <Show when={joinedVoiceChannelId()}>
            <div class="voice-dock">
              <div class="voice-dock-actions">
                <button
                  type="button"
                  class="voice-dock-icon voice-dock-disconnect"
                  onClick={leaveVoiceChannel}
                  disabled={voiceActionState() !== "idle"}
                  title={voiceActionState() === "leaving" ? "Disconnecting..." : "Disconnect"}
                  aria-label={voiceActionState() === "leaving" ? "Disconnecting..." : "Disconnect"}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path d="M7 9a5 5 0 0 1 10 0v4h2V9a7 7 0 1 0-14 0v4h2z" fill="currentColor" />
                    <path d="M12 22 8 18h3v-5h2v5h3z" fill="currentColor" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="voice-dock-icon voice-dock-toggle"
                  onClick={handleToggleMicMuted}
                  title={micMuted() ? "Unmute microphone" : "Mute microphone"}
                  aria-label={micMuted() ? "Unmute microphone" : "Mute microphone"}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3z" fill="currentColor" />
                    <path d="M18 11v1a6 6 0 0 1-12 0v-1H4v1a8 8 0 0 0 7 7.94V23h2v-3.06A8 8 0 0 0 20 12v-1z" fill="currentColor" />
                    <Show when={micMuted()}>
                      <path d="M4 4 20 20" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
                    </Show>
                  </svg>
                </button>
                <button
                  type="button"
                  class="voice-dock-icon voice-dock-toggle"
                  onClick={handleToggleSpeakerMuted}
                  title={speakerMuted() ? "Unmute speakers" : "Mute speakers"}
                  aria-label={speakerMuted() ? "Unmute speakers" : "Mute speakers"}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path d="M5 10v4h4l5 4V6l-5 4z" fill="currentColor" />
                    <Show when={!speakerMuted()}>
                      <path d="M16.5 8.5a5 5 0 0 1 0 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
                    </Show>
                    <Show when={speakerMuted()}>
                      <path d="M16 8 21 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
                      <path d="M21 8 16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
                    </Show>
                  </svg>
                </button>
                <button
                  type="button"
                  class={`voice-dock-icon voice-dock-toggle voice-dock-camera${cameraEnabled() ? " is-active" : ""}`}
                  onClick={() => void handleToggleCamera()}
                  disabled={cameraActionPending() || voiceActionState() !== "idle"}
                  title={cameraEnabled() ? "Turn camera off" : "Turn camera on"}
                  aria-label={cameraEnabled() ? "Turn camera off" : "Turn camera on"}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h9A1.5 1.5 0 0 1 16 7.5v2.1l3.86-2.18A1 1 0 0 1 21.4 8.3v7.4a1 1 0 0 1-1.54.87L16 14.4v2.1a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 16.5z" fill="currentColor" />
                    <Show when={cameraEnabled()}>
                      <path d="M5 5 19 19" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
                    </Show>
                  </svg>
                </button>
              </div>
              <p class="voice-dock-channel">Connected: {connectedVoiceChannelName()}</p>
              <Show when={cameraError()}>
                <p class="voice-dock-error">{cameraError()}</p>
              </Show>
            </div>
          </Show>
          <UserSettingsDock />
        </div>
      </Show>
      </Show>
      <Show when={toastError()}>
        <div class="toast toast-error" role="status" aria-live="polite">{toastError()}</div>
      </Show>
    </div>
  );
}
