import { For, Show, type JSX, type Accessor } from "solid-js";
import type { NativeCaptureSource } from "../../api/nativeCapture";
import {
  preferredScreenShareBitrateMode,
  preferredScreenShareFps,
  preferredScreenShareResolution,
  preferredScreenShareSourceKind,
  savePreferredScreenShareBitrateMode,
  savePreferredScreenShareCustomBitrateKbps,
  savePreferredScreenShareFps,
  savePreferredScreenShareResolution,
  savePreferredScreenShareSourceKind,
  preferredScreenShareCustomBitrateKbps,
  type ScreenShareBitrateMode,
  type ScreenShareFps,
} from "../../stores/settings";
import { voiceActionState } from "../../stores/voice";
import Modal from "../Modal";
import {
  autoBitrateKbps,
  effectiveScreenShareBitrateLabel,
  manualBitrateKbps,
  nativeSourceLabel,
} from "./helpers";

export interface ScreenShareModalProps {
  open: boolean;
  onClose: () => void;
  nativeSourcesLoading: boolean;
  nativeSourcesError: string;
  nativeSources: NativeCaptureSource[];
  selectedNativeSourceId: string | null;
  onSelectNativeSource: (id: string) => void;
  screenSharePreviewStream: MediaStream | null;
  screenSharePreviewError: string;
  screenSharePreviewVideoRef: Accessor<HTMLVideoElement | undefined>;
  onRefreshSources: () => void;
  onStartPreview: () => void;
  onStopPreview: () => void;
  onConfirm: () => void;
  screenActionPending: boolean;
}

function selectedScreenShareBitrateKbps(): number {
  const mode = preferredScreenShareBitrateMode();
  const resolution = preferredScreenShareResolution();
  const fps = preferredScreenShareFps();
  if (mode === "auto") {
    return autoBitrateKbps(resolution, fps);
  }

  if (mode === "custom") {
    return preferredScreenShareCustomBitrateKbps();
  }

  return manualBitrateKbps(mode, resolution);
}

export default function ScreenShareModal(props: ScreenShareModalProps): JSX.Element {
  function handleScreenShareSourceKindInput(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value === "screen" || value === "window" || value === "application") {
      savePreferredScreenShareSourceKind(value);
    }
  }

  function handleNativeCaptureSourceInput(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (!value) {
      return;
    }

    props.onSelectNativeSource(value);
    const selected = props.nativeSources.find((source) => source.id === value);
    if (selected) {
      savePreferredScreenShareSourceKind(
        selected.kind === "screen" ? "screen" : selected.kind === "application" ? "application" : "window",
      );
    }
  }

  function handleScreenShareResolutionInput(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value === "720p" || value === "1080p" || value === "1440p" || value === "4k") {
      savePreferredScreenShareResolution(value);
    }
  }

  function handleScreenShareFpsInput(event: Event) {
    const value = Number((event.currentTarget as HTMLSelectElement).value);
    if (value === 30 || value === 60) {
      savePreferredScreenShareFps(value as ScreenShareFps);
    }
  }

  function handleScreenShareBitrateModeInput(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value === "auto" || value === "balanced" || value === "high" || value === "ultra" || value === "custom") {
      savePreferredScreenShareBitrateMode(value as ScreenShareBitrateMode);
    }
  }

  function handleScreenShareCustomBitrateInput(event: Event) {
    const value = Number.parseInt((event.currentTarget as HTMLInputElement).value, 10);
    if (!Number.isFinite(value)) {
      return;
    }

    savePreferredScreenShareCustomBitrateKbps(value);
  }

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Share Screen"
      ariaLabel="Share screen"
      backdropClass="voice-share-modal-backdrop"
      modalClass="voice-share-modal"
    >
      <section class="settings-section">
        <h5>Capture Source</h5>
        <Show when={!props.nativeSourcesLoading} fallback={<p class="settings-help">Loading native sources...</p>}>
          <Show when={props.nativeSources.length > 0} fallback={(
            <>
              <label class="settings-label" for="voice-share-source-kind">Source preference</label>
              <select
                id="voice-share-source-kind"
                value={preferredScreenShareSourceKind()}
                onInput={handleScreenShareSourceKindInput}
              >
                <option value="screen">Entire screen</option>
                <option value="window">Window</option>
                <option value="application">Application</option>
              </select>
            </>
          )}>
            <label class="settings-label" for="voice-share-native-source">Native source</label>
            <select
              id="voice-share-native-source"
              value={props.selectedNativeSourceId ?? ""}
              onInput={handleNativeCaptureSourceInput}
            >
              <For each={props.nativeSources}>
                {(source) => (
                  <option value={source.id}>{nativeSourceLabel(source)}</option>
                )}
              </For>
            </select>
          </Show>
        </Show>

        <Show when={props.nativeSourcesError}>
          <p class="voice-dock-error">{props.nativeSourcesError}</p>
        </Show>

        <div class="settings-actions">
          <button
            type="button"
            class="settings-secondary"
            onClick={props.onRefreshSources}
          >
            Refresh sources
          </button>
        </div>

        <p class="settings-help">
          Source selection is native in Tauri. Confirm the same source in the OS share prompt if shown.
        </p>

        <label class="settings-label" for="voice-share-preview-video">Preview</label>
        <div class="voice-share-preview" role="status" aria-live="polite">
          <Show
            when={props.screenSharePreviewStream}
            fallback={<p class="settings-help">Preview is off. Use Preview source to verify what will be shared.</p>}
          >
            <video
              id="voice-share-preview-video"
              ref={props.screenSharePreviewVideoRef()}
              class="voice-share-preview-video"
              autoplay
              muted
              playsinline
            />
          </Show>
        </div>

        <Show when={props.screenSharePreviewError}>
          <p class="voice-dock-error">{props.screenSharePreviewError}</p>
        </Show>

        <h5>Quality</h5>
        <label class="settings-label" for="voice-share-resolution">Resolution</label>
        <select
          id="voice-share-resolution"
          value={preferredScreenShareResolution()}
          onInput={handleScreenShareResolutionInput}
        >
          <option value="720p">720p</option>
          <option value="1080p">1080p</option>
          <option value="1440p">1440p</option>
          <option value="4k">4k</option>
        </select>

        <label class="settings-label" for="voice-share-fps">FPS</label>
        <select
          id="voice-share-fps"
          value={String(preferredScreenShareFps())}
          onInput={handleScreenShareFpsInput}
        >
          <option value="30">30 FPS</option>
          <option value="60">60 FPS</option>
        </select>

        <label class="settings-label" for="voice-share-bitrate">Bitrate</label>
        <select
          id="voice-share-bitrate"
          value={preferredScreenShareBitrateMode()}
          onInput={handleScreenShareBitrateModeInput}
        >
          <option value="auto">Auto</option>
          <option value="balanced">Balanced</option>
          <option value="high">High</option>
          <option value="ultra">Ultra</option>
          <option value="custom">Custom</option>
        </select>

        <Show when={preferredScreenShareBitrateMode() === "custom"}>
          <label class="settings-label" for="voice-share-custom-bitrate">Custom bitrate (kbps)</label>
          <input
            id="voice-share-custom-bitrate"
            type="number"
            min="1500"
            max="50000"
            step="100"
            value={String(preferredScreenShareCustomBitrateKbps())}
            onInput={handleScreenShareCustomBitrateInput}
          />
        </Show>

        <p class="settings-help">Estimated target bitrate: {effectiveScreenShareBitrateLabel(selectedScreenShareBitrateKbps())}</p>

        <div class="settings-actions">
          <button
            type="button"
            class="settings-secondary"
            onClick={props.onStartPreview}
          >
            Preview source
          </button>
          <button
            type="button"
            class="settings-secondary"
            onClick={props.onStopPreview}
            disabled={!props.screenSharePreviewStream}
          >
            Stop preview
          </button>
          <button
            type="button"
            class="settings-secondary"
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={props.onConfirm}
            disabled={props.screenActionPending || voiceActionState() !== "idle"}
          >
            {props.screenActionPending ? "Starting..." : "Start sharing"}
          </button>
        </div>
      </section>
    </Modal>
  );
}
