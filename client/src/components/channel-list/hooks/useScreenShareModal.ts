import { createEffect, createSignal, untrack } from "solid-js";
import type { NativeCaptureSource } from "../../../api/nativeCapture";
import { listNativeCaptureSources } from "../../../api/nativeCapture";
import type { ScreenShareStartOptions } from "../../../api/media";
import {
  preferredScreenShareBitrateMode,
  preferredScreenShareCustomBitrateKbps,
  preferredScreenShareFps,
  preferredScreenShareResolution,
  preferredScreenShareSourceKind,
  type ScreenShareSourceKind,
} from "../../../stores/settings";
import { errorMessage } from "../../../utils/error";
import { isTauriRuntime } from "../../../utils/platform";
import {
  autoBitrateKbps,
  manualBitrateKbps,
  normalizeNativeSourceKind,
  previewResolutionConstraints,
} from "../helpers";

export interface UseScreenShareModalReturn {
  nativeSources: () => NativeCaptureSource[];
  nativeSourcesLoading: () => boolean;
  nativeSourcesError: () => string;
  selectedNativeSourceId: () => string | null;
  screenSharePreviewStream: () => MediaStream | null;
  screenSharePreviewError: () => string;
  loadNativeCaptureSources: () => Promise<void>;
  setSelectedNativeSourceId: (id: string | null) => void;
  startScreenSharePreview: () => Promise<void>;
  stopScreenSharePreview: () => void;
  buildScreenShareOptions: () => ScreenShareStartOptions;
  selectedScreenShareSourceKind: () => "screen" | "window" | "application";
  selectedScreenShareBitrateKbps: () => number;
}

function pickSourceIdForPreferredKind(
  sources: NativeCaptureSource[],
  selectedId: string | null,
  preferredKind: ScreenShareSourceKind,
): string | null {
  if (sources.length === 0) {
    return null;
  }

  const selected = selectedId ? sources.find((source) => source.id === selectedId) ?? null : null;
  if (selected && normalizeNativeSourceKind(selected.kind) === preferredKind) {
    return selected.id;
  }

  const preferred = sources.find((source) => normalizeNativeSourceKind(source.kind) === preferredKind);
  if (preferred) {
    return preferred.id;
  }

  return selected?.id ?? sources[0]?.id ?? null;
}

export function useScreenShareModal(): UseScreenShareModalReturn {
  const [nativeSources, setNativeSources] = createSignal<NativeCaptureSource[]>([]);
  const [nativeSourcesLoading, setNativeSourcesLoading] = createSignal(false);
  const [nativeSourcesError, setNativeSourcesError] = createSignal("");
  const [selectedNativeSourceId, setSelectedNativeSourceId] = createSignal<string | null>(null);
  const [screenSharePreviewStream, setScreenSharePreviewStream] = createSignal<MediaStream | null>(null);
  const [screenSharePreviewError, setScreenSharePreviewError] = createSignal("");

  const tauriRuntime = isTauriRuntime();

  async function loadNativeCaptureSources() {
    if (!tauriRuntime) {
      return;
    }

    setNativeSourcesLoading(true);
    setNativeSourcesError("");

    try {
      const sources = await listNativeCaptureSources();
      setNativeSources(sources);
      setSelectedNativeSourceId((current) =>
        pickSourceIdForPreferredKind(sources, current, preferredScreenShareSourceKind())
      );
    } catch (error) {
      setNativeSources([]);
      setSelectedNativeSourceId(null);
      setNativeSourcesError(errorMessage(error, "Failed to load native capture sources"));
    } finally {
      setNativeSourcesLoading(false);
    }
  }

  function stopScreenSharePreview() {
    const stream = screenSharePreviewStream();
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setScreenSharePreviewStream(null);
    }
    setScreenSharePreviewError("");
  }

  async function startScreenSharePreview() {
    setScreenSharePreviewError("");
    stopScreenSharePreview();

    const sourceKind = selectedScreenShareSourceKind();
    const displaySurface = sourceKind === "screen" ? "monitor" : "window";

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          ...previewResolutionConstraints(preferredScreenShareResolution()),
          frameRate: {
            ideal: preferredScreenShareFps(),
            max: preferredScreenShareFps(),
          },
          displaySurface,
        },
        audio: false,
      });

      const [track] = stream.getVideoTracks();
      if (track) {
        track.addEventListener("ended", () => {
          if (screenSharePreviewStream() === stream) {
            stopScreenSharePreview();
          }
        });
      }

      setScreenSharePreviewStream(stream);
    } catch (error) {
      setScreenSharePreviewError(errorMessage(error, "Failed to start preview"));
    }
  }

  function selectedScreenShareSourceKind(): "screen" | "window" | "application" {
    const selected = nativeSources().find((source) => source.id === selectedNativeSourceId()) ?? null;
    if (selected) {
      return normalizeNativeSourceKind(selected.kind);
    }

    return preferredScreenShareSourceKind();
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

  function buildScreenShareOptions(): ScreenShareStartOptions {
    const selected = nativeSources().find((source) => source.id === selectedNativeSourceId()) ?? null;

    return {
      resolution: preferredScreenShareResolution(),
      fps: preferredScreenShareFps(),
      bitrateKbps: selectedScreenShareBitrateKbps(),
      sourceKind: selected ? normalizeNativeSourceKind(selected.kind) : preferredScreenShareSourceKind(),
      sourceId: selected?.id,
      sourceTitle: selected?.title,
    };
  }

  createEffect(() => {
    const sources = nativeSources();
    const preferredKind = preferredScreenShareSourceKind();

    setSelectedNativeSourceId((current) => {
      const next = pickSourceIdForPreferredKind(sources, current, preferredKind);
      return current === next ? current : next;
    });
  });

  createEffect(() => {
    selectedNativeSourceId();
    preferredScreenShareSourceKind();
    untrack(() => stopScreenSharePreview());
  });

  return {
    nativeSources,
    nativeSourcesLoading,
    nativeSourcesError,
    selectedNativeSourceId,
    screenSharePreviewStream,
    screenSharePreviewError,
    loadNativeCaptureSources,
    setSelectedNativeSourceId,
    startScreenSharePreview,
    stopScreenSharePreview,
    buildScreenShareOptions,
    selectedScreenShareSourceKind,
    selectedScreenShareBitrateKbps,
  };
}
