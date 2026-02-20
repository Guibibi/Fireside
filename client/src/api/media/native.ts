import { nativeCaptureStatus, startNativeCapture, stopNativeCapture } from "../nativeCapture";
import { isTauriRuntime } from "../../utils/platform";
import {
  nativeFallbackMonitorTimer,
  setNativeFallbackMonitorTimer,
  setNativeFallbackMonitorRunning,
} from "./state";
import type { ScreenShareStartOptions } from "./types";

export function clearNativeFallbackMonitor() {
  if (nativeFallbackMonitorTimer !== null) {
    window.clearInterval(nativeFallbackMonitorTimer);
    setNativeFallbackMonitorTimer(null);
  }
  setNativeFallbackMonitorRunning(false);
}

export async function readNativeSenderBackendStatus(): Promise<{
  backend: string;
  requestedBackend: string;
  fallbackReason: string;
}> {
  const maxAttempts = 10;
  const retryDelayMs = 50;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await nativeCaptureStatus().catch(() => null);
    if (!status) {
      continue;
    }

    const backend = status.native_sender.encoder_backend;
    const requestedBackend = status.native_sender.encoder_backend_requested;
    const fallbackReason = status.native_sender.encoder_backend_fallback_reason ?? "none";

    if (backend && requestedBackend) {
      return {
        backend,
        requestedBackend,
        fallbackReason,
      };
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, retryDelayMs));
    }
  }

  return {
    backend: "unknown",
    requestedBackend: "unknown",
    fallbackReason: "none",
  };
}

export async function armNativeCapture(
  options: ScreenShareStartOptions,
  codecMimeType: string,
  rtpTarget: string,
  payloadType: number,
  ssrc: number,
): Promise<void> {
  await startNativeCapture({
    source_id: options.sourceId!,
    resolution: options.resolution,
    fps: options.fps,
    bitrate_kbps: options.bitrateKbps,
    encoder_backend: options.encoderBackend,
    codec_mime_type: codecMimeType,
    rtp_target: rtpTarget,
    payload_type: payloadType,
    ssrc,
  });
}

export async function disarmNativeCapture(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  clearNativeFallbackMonitor();

  try {
    await stopNativeCapture();
  } catch {
    // best effort only
  }
}
