import { createSignal, createEffect, onCleanup } from "solid-js";
import type { NativeCaptureSource, NativeCaptureStatus } from "../../../api/nativeCapture";
import { listNativeCaptureSources, nativeCaptureStatus } from "../../../api/nativeCapture";
import {
  preferredScreenShareBitrateMode,
  preferredScreenShareCustomBitrateKbps,
  preferredScreenShareFps,
  preferredScreenShareResolution,
  preferredScreenShareSourceKind,
} from "../../../stores/settings";
import { isTauriRuntime } from "../../../utils/platform";
import { errorMessage } from "../../../utils/error";
import type { ScreenShareStartOptions } from "../../../api/media";
import { autoBitrateKbps, manualBitrateKbps, previewResolutionConstraints } from "../helpers";

export interface UseScreenShareModalReturn {
  nativeSources: () => NativeCaptureSource[];
  nativeSourcesLoading: () => boolean;
  nativeSourcesError: () => string;
  selectedNativeSourceId: () => string | null;
  screenSharePreviewStream: () => MediaStream | null;
  screenSharePreviewError: () => string;
  nativeSenderMetrics: () => NativeCaptureStatus["native_sender"] | null;
  loadNativeCaptureSources: () => Promise<void>;
  setSelectedNativeSourceId: (id: string | null) => void;
  startScreenSharePreview: () => Promise<void>;
  stopScreenSharePreview: () => void;
  buildScreenShareOptions: () => ScreenShareStartOptions;
  selectedScreenShareSourceKind: () => "screen" | "window" | "application";
  selectedScreenShareBitrateKbps: () => number;
}

export function useScreenShareModal(): UseScreenShareModalReturn {
  const [nativeSources, setNativeSources] = createSignal<NativeCaptureSource[]>([]);
  const [nativeSourcesLoading, setNativeSourcesLoading] = createSignal(false);
  const [nativeSourcesError, setNativeSourcesError] = createSignal("");
  const [selectedNativeSourceId, setSelectedNativeSourceId] = createSignal<string | null>(null);
  const [screenSharePreviewStream, setScreenSharePreviewStream] = createSignal<MediaStream | null>(null);
  const [screenSharePreviewError, setScreenSharePreviewError] = createSignal("");
  const [nativeSenderMetrics, setNativeSenderMetrics] = createSignal<NativeCaptureStatus["native_sender"] | null>(null);

  const tauriRuntime = isTauriRuntime();
  const nativeDebugEnabled =
    tauriRuntime &&
    (import.meta.env.DEV || window.localStorage.getItem("yankcord_debug_native_sender") === "1");

  async function loadNativeCaptureSources() {
    if (!tauriRuntime) return;

    setNativeSourcesLoading(true);
    setNativeSourcesError("");

    try {
      const sources = await listNativeCaptureSources();
      setNativeSources(sources);

      const selectedId = selectedNativeSourceId();
      if (selectedId && sources.some((source) => source.id === selectedId)) {
        return;
      }

      const preferredKind = preferredScreenShareSourceKind();
      const preferredSource = sources.find((source) => source.kind === preferredKind);
      setSelectedNativeSourceId(preferredSource?.id ?? sources[0]?.id ?? null);
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
      return selected.kind === "screen" ? "screen" : selected.kind === "application" ? "application" : "window";
    }
    return preferredScreenShareSourceKind();
  }

  function selectedScreenShareBitrateKbps(): number {
    const mode = preferredScreenShareBitrateMode();
    const resolution = preferredScreenShareResolution();
    const fps = preferredScreenShareFps();
    if (mode === "auto") return autoBitrateKbps(resolution, fps);
    if (mode === "custom") return preferredScreenShareCustomBitrateKbps();
    return manualBitrateKbps(mode, resolution);
  }

  function buildScreenShareOptions(): ScreenShareStartOptions {
    const selected = nativeSources().find((source) => source.id === selectedNativeSourceId()) ?? null;
    const sourceKind = selected
      ? selected.kind === "screen"
        ? "screen"
        : selected.kind === "application"
          ? "application"
          : "window"
      : preferredScreenShareSourceKind();

    return {
      resolution: preferredScreenShareResolution(),
      fps: preferredScreenShareFps(),
      bitrateKbps: selectedScreenShareBitrateKbps(),
      sourceKind,
      sourceId: selected?.id,
      sourceTitle: selected?.title,
    };
  }

  createEffect(() => {
    if (!tauriRuntime || !nativeDebugEnabled) {
      setNativeSenderMetrics(null);
      return;
    }

    let cancelled = false;

    const pollStatus = async () => {
      try {
        const status = await nativeCaptureStatus();
        if (!cancelled) {
          setNativeSenderMetrics(status.native_sender);
        }
      } catch {
        if (!cancelled) {
          setNativeSenderMetrics(null);
        }
      }
    };

    void pollStatus();
    const timer = window.setInterval(() => {
      void pollStatus();
    }, 1000);

    onCleanup(() => {
      cancelled = true;
      window.clearInterval(timer);
    });
  });

  return {
    nativeSources,
    nativeSourcesLoading,
    nativeSourcesError,
    selectedNativeSourceId,
    screenSharePreviewStream,
    screenSharePreviewError,
    nativeSenderMetrics,
    loadNativeCaptureSources,
    setSelectedNativeSourceId,
    startScreenSharePreview,
    stopScreenSharePreview,
    buildScreenShareOptions,
    selectedScreenShareSourceKind,
    selectedScreenShareBitrateKbps,
  };
}
