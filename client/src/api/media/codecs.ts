import type { ProducerOptions } from "mediasoup-client/types";
import type { ScreenShareCodecPreference } from "../../stores/settings";
import { device } from "./state";
import type { ScreenShareStartOptions } from "./types";

type ProduceCodec = NonNullable<ProducerOptions["codec"]>;

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function codecMimeType(codec: unknown): string | null {
  if (!isObject(codec)) {
    return null;
  }

  const mimeType = codec.mimeType;
  return typeof mimeType === "string" && mimeType.length > 0 ? mimeType : null;
}

export function codecPreferenceMimeType(preference: ScreenShareCodecPreference): string | null {
  if (preference === "av1") {
    return "video/av1";
  }
  if (preference === "vp9") {
    return "video/vp9";
  }
  if (preference === "vp8") {
    return "video/vp8";
  }
  if (preference === "h264") {
    return "video/h264";
  }

  return null;
}

export function requestedCodecMimeType(preference: ScreenShareCodecPreference | undefined): string {
  const preferredMimeType = codecPreferenceMimeType(preference ?? "auto");
  return preferredMimeType ?? "auto";
}

export function strictCodecModeEnabled(options?: ScreenShareStartOptions): boolean {
  return options?.strictCodec === true && (options.codecPreference ?? "auto") !== "auto";
}

export function preferredScreenShareCodecOrder(preference: ScreenShareCodecPreference): string[] {
  // H264 first for maximum compatibility (universal WebRTC support, NVENC hardware acceleration)
  const baseOrder = ["video/h264", "video/vp8", "video/vp9", "video/av1"];
  const preferredMimeType = codecPreferenceMimeType(preference);
  if (!preferredMimeType) {
    return baseOrder;
  }

  return [
    preferredMimeType,
    ...baseOrder.filter((mimeType) => mimeType !== preferredMimeType),
  ];
}

export function isWindowsPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = userAgentData?.platform ?? navigator.platform ?? "";
  return platform.toLowerCase().includes("win");
}

export function selectScreenShareCodecForPlatform(preference: ScreenShareCodecPreference = "auto"): ProduceCodec | undefined {
  if (!device) {
    return undefined;
  }

  const codecs = device.rtpCapabilities.codecs;
  if (!Array.isArray(codecs) || codecs.length === 0) {
    console.debug("[media] No router codecs available for screen share preference");
    return undefined;
  }

  if (!isWindowsPlatform() && preference === "auto") {
    return undefined;
  }

  const preferredOrder = preference === "auto"
    ? ["video/h264", "video/vp8", "video/vp9"]
    : preferredScreenShareCodecOrder(preference);
  for (const preferredMimeType of preferredOrder) {
    const match = codecs.find((codec) => codecMimeType(codec)?.toLowerCase() === preferredMimeType);
    if (match) {
      const selectedMimeType = codecMimeType(match) ?? preferredMimeType;
      console.debug("[media] Selected screen share codec", {
        mimeType: selectedMimeType,
        platform: isWindowsPlatform() ? "windows" : "other",
        preference,
      });
      return match as ProduceCodec;
    }
  }

  console.debug("[media] Preferred screen codec unavailable; using runtime default", { preference });
  return undefined;
}

export function nativePreferredCodecsFor(preference: ScreenShareCodecPreference = "auto"): string[] {
  return preferredScreenShareCodecOrder(preference).map((mimeType) => {
    if (mimeType === "video/av1") {
      return "video/AV1";
    }
    if (mimeType === "video/vp9") {
      return "video/VP9";
    }
    if (mimeType === "video/vp8") {
      return "video/VP8";
    }
    return "video/H264";
  });
}
