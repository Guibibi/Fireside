import { createSignal, For, onMount, Show, type JSX } from "solid-js";
import type { CaptureSourceKind, EnumeratedSources } from "../api/media/nativeBridge";
import { enumerateSources } from "../api/media/nativeBridge";

interface ScreenShareModalProps {
  onClose: () => void;
  onStartSharing: (source: CaptureSourceKind) => Promise<void>;
}

type SourceTab = "monitors" | "windows";

export default function ScreenShareModal(props: ScreenShareModalProps): JSX.Element {
  const [tab, setTab] = createSignal<SourceTab>("monitors");
  const [sources, setSources] = createSignal<EnumeratedSources | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<CaptureSourceKind | null>(null);
  const [starting, setStarting] = createSignal(false);

  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  onMount(async () => {
    if (!isTauri) {
      setLoading(false);
      setError("Screen sharing requires the desktop app.");
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
  });

  async function handleStart() {
    const src = selected();
    if (!src) return;
    setStarting(true);
    try {
      await props.onStartSharing(src);
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start screen share.");
    } finally {
      setStarting(false);
    }
  }

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      props.onClose();
    }
  }

  const currentSources = () => {
    const s = sources();
    if (!s) return [];
    return tab() === "monitors" ? s.monitors : s.windows;
  };

  return (
    <div class="modal-overlay" onClick={handleOverlayClick} role="dialog" aria-modal="true" aria-label="Share screen">
      <div class="modal screen-share-modal">
        <div class="modal-header">
          <h2 class="modal-title">Share Your Screen</h2>
          <button type="button" class="modal-close" onClick={props.onClose} aria-label="Close">×</button>
        </div>

        <Show when={!isTauri}>
          <div class="screen-share-notice">
            <p>Screen sharing requires the Fireside desktop app.</p>
          </div>
        </Show>

        <Show when={isTauri}>
          <div class="screen-share-tabs">
            <button
              type="button"
              class={`screen-share-tab${tab() === "monitors" ? " is-active" : ""}`}
              onClick={() => { setTab("monitors"); setSelected(null); }}
            >
              Monitors
            </button>
            <button
              type="button"
              class={`screen-share-tab${tab() === "windows" ? " is-active" : ""}`}
              onClick={() => { setTab("windows"); setSelected(null); }}
            >
              Windows
            </button>
          </div>

          <div class="screen-share-source-list">
            <Show when={loading()}>
              <p class="screen-share-loading">Loading sources…</p>
            </Show>

            <Show when={!loading() && currentSources().length === 0 && !error()}>
              <p class="screen-share-empty">No {tab()} found.</p>
            </Show>

            <Show when={!loading()}>
              <For each={currentSources()}>
                {(source) => {
                  const label = source.kind === "monitor" ? source.name : source.title;
                  const isSelected = () => selected() === source;
                  return (
                    <button
                      type="button"
                      class={`screen-share-source-item${isSelected() ? " is-selected" : ""}`}
                      onClick={() => setSelected(source)}
                    >
                      <span class="screen-share-source-label">{label}</span>
                      {source.kind === "monitor" && source.is_primary && (
                        <span class="screen-share-badge">Primary</span>
                      )}
                    </button>
                  );
                }}
              </For>
            </Show>
          </div>

          <Show when={error()}>
            <p class="screen-share-error">{error()}</p>
          </Show>

          <div class="modal-actions">
            <button type="button" class="settings-secondary" onClick={props.onClose}>
              Cancel
            </button>
            <button
              type="button"
              class="settings-primary"
              disabled={!selected() || starting()}
              onClick={handleStart}
            >
              {starting() ? "Starting…" : "Start Sharing"}
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}
