import type { NativeCaptureSource, NativeCodecCapability } from "../../api/nativeCapture";
import type {
  ScreenShareBitrateMode,
  ScreenShareCodecPreference,
  ScreenShareFps,
  ScreenShareResolution,
} from "../../stores/settings";

export function autoBitrateKbps(resolution: ScreenShareResolution, fps: ScreenShareFps): number {
  const at60 = fps >= 60;
  if (resolution === "720p") {
    return at60 ? 6000 : 4500;
  }

  if (resolution === "1080p") {
    return at60 ? 12000 : 8000;
  }

  if (resolution === "1440p") {
    return at60 ? 18000 : 12000;
  }

  return at60 ? 30000 : 20000;
}

export function manualBitrateKbps(mode: ScreenShareBitrateMode, resolution: ScreenShareResolution): number {
  if (mode === "balanced") {
    if (resolution === "720p") {
      return 4000;
    }
    if (resolution === "1080p") {
      return 7000;
    }
    if (resolution === "1440p") {
      return 10000;
    }

    return 14000;
  }

  if (mode === "high") {
    if (resolution === "720p") {
      return 5500;
    }
    if (resolution === "1080p") {
      return 10000;
    }
    if (resolution === "1440p") {
      return 15000;
    }

    return 22000;
  }

  if (mode === "ultra") {
    if (resolution === "720p") {
      return 7000;
    }
    if (resolution === "1080p") {
      return 14000;
    }
    if (resolution === "1440p") {
      return 20000;
    }

    return 30000;
  }

  return 14000;
}

export function formatUnreadBadge(count: number): string {
  if (count <= 0) {
    return "";
  }

  return count > 99 ? "99+" : String(count);
}

export function nativeSourceLabel(source: NativeCaptureSource): string {
  const appName = source.app_name?.trim();
  const size = source.width && source.height ? `${source.width}x${source.height}` : null;
  if (appName && size) {
    return `${source.title} (${appName}, ${size})`;
  }

  if (appName) {
    return `${source.title} (${appName})`;
  }

  if (size) {
    return `${source.title} (${size})`;
  }

  return source.title;
}

export function friendlyCodecUnavailableReason(
  detail: string | null | undefined,
  preference: ScreenShareCodecPreference,
): string {
  const codecLabel = preference.toUpperCase();
  if (!detail) {
    return `${codecLabel} unavailable on this client`;
  }

  const normalized = detail.toLowerCase();
  if (normalized.includes("failed to execute ffmpeg encoder probe") || normalized.includes("failed to spawn ffmpeg")) {
    return `${codecLabel} unavailable: FFmpeg is missing or not executable`;
  }
  if (normalized.includes("libaom-av1 encoder is missing")) {
    return "AV1 unavailable: FFmpeg is missing libaom-av1";
  }
  if (normalized.includes("libvpx-vp9 encoder is missing")) {
    return "VP9 unavailable: FFmpeg is missing libvpx-vp9";
  }
  if (normalized.includes("libvpx vp8 encoder is missing")) {
    return "VP8 unavailable: FFmpeg is missing libvpx";
  }
  if (normalized.includes("h264_nvenc encoder is missing")) {
    return "H264 NVENC unavailable: GPU/driver/FFmpeg support missing";
  }
  if (normalized.includes("native-nvenc feature")) {
    return "H264 NVENC unavailable: build missing native-nvenc feature";
  }

  return `${codecLabel} unavailable on this client`;
}

export function previewResolutionConstraints(resolution: ScreenShareResolution): { width: { ideal: number }; height: { ideal: number } } {
  if (resolution === "720p") {
    return { width: { ideal: 1280 }, height: { ideal: 720 } };
  }
  if (resolution === "1080p") {
    return { width: { ideal: 1920 }, height: { ideal: 1080 } };
  }
  if (resolution === "1440p") {
    return { width: { ideal: 2560 }, height: { ideal: 1440 } };
  }

  return { width: { ideal: 3840 }, height: { ideal: 2160 } };
}

export function codecPreferenceDisabled(
  preference: ScreenShareCodecPreference,
  capabilities: Record<string, NativeCodecCapability> | null,
): boolean {
  if (preference === "auto") {
    return false;
  }

  if (!capabilities) {
    return false;
  }

  const capability = capabilities[`video/${preference.toUpperCase()}`] ?? null;
  return !(capability?.available ?? false);
}

export function codecPreferenceUnavailableReason(
  preference: ScreenShareCodecPreference,
  capabilities: Record<string, NativeCodecCapability> | null,
): string | undefined {
  if (preference === "auto") {
    return undefined;
  }

  if (!capabilities) {
    return undefined;
  }

  const capability = capabilities[`video/${preference.toUpperCase()}`] ?? null;
  if (capability?.available) {
    return undefined;
  }

  return friendlyCodecUnavailableReason(capability?.detail, preference);
}

export function supportsSelectedCodecPreference(
  preference: ScreenShareCodecPreference,
  capabilities: Record<string, NativeCodecCapability> | null,
): boolean {
  if (preference === "auto") {
    return true;
  }

  if (!capabilities) {
    return true;
  }

  const capability = capabilities[`video/${preference.toUpperCase()}`] ?? null;
  return capability?.available ?? false;
}

export function formatNativeSenderRate(value: number): string {
  if (value < 1000) {
    return `${value} B`;
  }
  if (value < 1000 * 1000) {
    return `${(value / 1000).toFixed(1)} KB`;
  }
  return `${(value / (1000 * 1000)).toFixed(2)} MB`;
}

export function connectionStatusLabel(status: string): string {
  if (status === "connected") {
    return "Connection: Connected";
  }

  if (status === "connecting") {
    return "Connection: Connecting...";
  }

  if (status === "reconnecting") {
    return "Connection: Reconnecting...";
  }

  if (status === "failed") {
    return "Connection: Failed";
  }

  return "Connection: Disconnected";
}

export function effectiveScreenShareBitrateLabel(kbps: number): string {
  const mbps = kbps / 1000;
  if (mbps >= 10) {
    return `${mbps.toFixed(0)} Mbps`;
  }

  return `${mbps.toFixed(1)} Mbps`;
}
