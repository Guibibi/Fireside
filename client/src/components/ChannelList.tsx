import { For, Show, createResource, createSignal, createEffect } from "solid-js";
import { get } from "../api/http";
import { activeChannelId, Channel, setActiveChannelId } from "../stores/chat";

async function fetchChannels() {
  return get<Channel[]>("/channels");
}

export default function ChannelList() {
  const [channels] = createResource(fetchChannels);
  const [loadError, setLoadError] = createSignal("");

  createEffect(() => {
    const error = channels.error;
    if (error instanceof Error) {
      setLoadError(error.message);
      return;
    }

    setLoadError("");

    const loadedChannels = channels();
    if (!loadedChannels || loadedChannels.length === 0) {
      return;
    }

    const selected = activeChannelId();
    const selectedStillExists = selected
      ? loadedChannels.some((channel) => channel.id === selected)
      : false;

    if (!selectedStillExists) {
      setActiveChannelId(loadedChannels[0].id);
    }
  });

  return (
    <div class="channel-list">
      <h3>Channels</h3>
      <Show when={!channels.loading} fallback={<p class="placeholder">Loading channels...</p>}>
        <Show when={!loadError()} fallback={<p class="error">{loadError()}</p>}>
          <Show
            when={(channels() || []).length > 0}
            fallback={<p class="placeholder">No channels available</p>}
          >
            <ul class="channel-items">
              <For each={channels() || []}>
                {(channel) => (
                  <li>
                    <button
                      type="button"
                      class={`channel-item${activeChannelId() === channel.id ? " is-active" : ""}`}
                      onClick={() => setActiveChannelId(channel.id)}
                    >
                      <span class="channel-prefix">#</span>
                      <span>{channel.name}</span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
