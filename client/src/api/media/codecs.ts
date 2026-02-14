import type { ProducerOptions } from "mediasoup-client/types";
import { device } from "./state";

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

export function isWindowsPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = userAgentData?.platform ?? navigator.platform ?? "";
  return platform.toLowerCase().includes("win");
}

export function selectScreenShareCodecForPlatform(): ProduceCodec | undefined {
  if (!device) {
    return undefined;
  }

  const codecs = device.rtpCapabilities.codecs;
  if (!Array.isArray(codecs) || codecs.length === 0) {
    console.debug("[media] No router codecs available for screen share");
    return undefined;
  }

  // Always prefer H264 for maximum compatibility and NVENC hardware acceleration
  const preferredOrder = ["video/h264", "video/vp8", "video/vp9"];
  for (const preferredMimeType of preferredOrder) {
    const match = codecs.find((codec) => codecMimeType(codec)?.toLowerCase() === preferredMimeType);
    if (match) {
      const selectedMimeType = codecMimeType(match) ?? preferredMimeType;
      console.debug("[media] Selected screen share codec", {
        mimeType: selectedMimeType,
        platform: isWindowsPlatform() ? "windows" : "other",
      });
      return match as ProduceCodec;
    }
  }

  console.debug("[media] Preferred screen codec unavailable; using runtime default");
  return undefined;
}

export function nativePreferredCodecsFor(): string[] {
  // Always use H264 for native capture - universal hardware decode support
  return ["video/H264"];
}
