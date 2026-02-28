import { createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js";
import type { CaptureSourceKind, EnumeratedSources } from "../api/media/nativeBridge";
import { enumerateSources } from "../api/media/nativeBridge";
import Modal from "./Modal";

interface ScreenShareModalProps {
  open: boolean;
  onClose: () => void;
  onStartSharing: (source: CaptureSourceKind) => Promise<void>;
}

type SourceTab = "screen" | "window";

const SOURCE_TABS: ReadonlyArray<{ id: SourceTab; label: string }> = [
  { id: "screen", label: "Screen" },
  { id: "window", label: "Window" },
];

function sourceKey(source: CaptureSourceKind | null): string | null {
  if (!source) {
    return null;
  }

  if (source.kind === "monitor") {
    return `monitor:${source.index}`;
  }

  return `window:${source.id}`;
}

function sourceLabel(source: CaptureSourceKind): string {
  return source.kind === "monitor" ? source.name : source.title;
}

export default function ScreenShareModal(props: ScreenShareModalProps): JSX.Element {
  const [tab, setTab] = createSignal<SourceTab>("screen");
  const [sources, setSources] = createSignal<EnumeratedSources | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<CaptureSourceKind | null>(null);
  const [starting, setStarting] = createSignal(false);

  const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  const currentSources = createMemo<CaptureSourceKind[]>(() => {
    const available = sources();
    if (!available) {
      return [];
    }

    return tab() === "screen" ? available.monitors : available.windows;
  });

  const tabLabel = createMemo(() => (tab() === "screen" ? "screens" : "windows"));

  createEffect(() => {
    if (!props.open) {
      return;
    }

    setTab("screen");
    setSelected(null);
    setStarting(false);
    setError(null);

    if (!isTauri()) {
      setSources(null);
      setLoading(false);
      setError("Screen sharing requires the Fireside desktop app.");
      return;
    }

    void refreshSources();
  });

  async function refreshSources() {
    setLoading(true);
    setError(null);

    if (!isTauri()) {
      setSources(null);
      setLoading(false);
      setError("Screen sharing requires the Fireside desktop app.");
      return;
    }

    try {
      const result = await enumerateSources();
      setSources(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to enumerate sources.");
    } finally {
      setLoading(false);
    }
  }

  async function handleStart() {
    const source = selected();
    if (!source || starting()) {
      return;
    }

    setError(null);
    setStarting(true);

    try {
      await props.onStartSharing(source);
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start screen share.");
    } finally {
      setStarting(false);
    }
  }

  function sourceCount(sourceTab: SourceTab): number {
    const available = sources();
    if (!available) {
      return 0;
    }

    return sourceTab === "screen" ? available.monitors.length : available.windows.length;
  }

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Start Stream"
      ariaLabel="Start stream"
      backdropClass="screen-share-modal-backdrop"
      modalClass="screen-share-modal"
    >
      <div class="screen-share-content">
        <p class="screen-share-intro">Choose what you want to stream to the voice channel.</p>

        <Show when={isTauri()} fallback={(
          <p class="screen-share-notice">Screen sharing requires the Fireside desktop app.</p>
        )}>
          <div class="screen-share-tabs" role="tablist" aria-label="Stream source type">
            <For each={SOURCE_TABS}>
              {(entry) => {
                const isActive = () => tab() === entry.id;

                return (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive()}
                    class={`screen-share-tab${isActive() ? " is-active" : ""}`}
                    onClick={() => {
                      setTab(entry.id);
                      setSelected(null);
                    }}
                  >
                    <span>{entry.label}</span>
                    <span class="screen-share-tab-count">{sourceCount(entry.id)}</span>
                  </button>
                );
              }}
            </For>
          </div>

          <div class="screen-share-source-list" role="listbox" aria-label={`Available ${tabLabel()}`}>
            <Show when={loading()}>
              <p class="screen-share-source-state">Loading sources...</p>
            </Show>

            <Show when={!loading() && currentSources().length === 0 && !error()}>
              <p class="screen-share-source-state">No {tabLabel()} found right now.</p>
            </Show>

            <Show when={!loading()}>
              <For each={currentSources()}>
                {(source) => {
                  const isSelected = () => sourceKey(selected()) === sourceKey(source);
                  const sourceTypeLabel = source.kind === "monitor"
                    ? `Screen ${source.index + 1}`
                    : "Application window";

                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected()}
                      class={`screen-share-source-item${isSelected() ? " is-selected" : ""}`}
                      onClick={() => setSelected(source)}
                    >
                      <span class="screen-share-source-main">
                        <span class="screen-share-source-label">{sourceLabel(source)}</span>
                        <span class="screen-share-source-type">{sourceTypeLabel}</span>
                      </span>

                      <Show when={source.kind === "monitor" && source.is_primary}>
                        <span class="screen-share-badge">Primary</span>
                      </Show>
                    </button>
                  );
                }}
              </For>
            </Show>
          </div>

          <Show when={error()}>
            <p class="screen-share-error">{error()}</p>
          </Show>

          <div class="settings-actions screen-share-actions">
            <button
              type="button"
              class="settings-secondary"
              onClick={() => void refreshSources()}
              disabled={loading() || starting()}
            >
              {loading() ? "Refreshing..." : "Refresh"}
            </button>

            <button type="button" class="settings-secondary" onClick={props.onClose}>
              Cancel
            </button>

            <button
              type="button"
              disabled={!selected() || starting() || loading()}
              onClick={handleStart}
            >
              {starting() ? "Starting..." : "Start Stream"}
            </button>
          </div>
        </Show>
      </div>
    </Modal>
  );
}
