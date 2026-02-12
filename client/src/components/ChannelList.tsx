import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { del, get, post } from "../api/http";
import { connect, onMessage } from "../api/ws";
import {
  activeChannelId,
  Channel,
  clearUnread,
  incrementUnread,
  removeUnreadChannel,
  setActiveChannelId,
  unreadCount,
} from "../stores/chat";

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

  function selectChannel(channelId: string) {
    setActiveChannelId(channelId);
    clearUnread(channelId);
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
      }
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
    });
  });

  const sortedChannels = () => [...channels()].sort((a, b) => a.position - b.position);

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
                  <button
                    type="button"
                    class={`channel-item${activeChannelId() === channel.id ? " is-active" : ""}`}
                    onClick={() => selectChannel(channel.id)}
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
      </Show>
      </Show>
      <Show when={toastError()}>
        <div class="toast toast-error" role="status" aria-live="polite">{toastError()}</div>
      </Show>
    </div>
  );
}
