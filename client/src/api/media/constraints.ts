import {
  preferredAudioInputDeviceId,
  preferredCameraDeviceId,
  type ScreenShareResolution,
} from "../../stores/settings";
import type { ScreenShareStartOptions } from "./types";

export function audioInputConstraint(deviceId: string | null = preferredAudioInputDeviceId()): MediaTrackConstraints | boolean {
  const selectedDeviceId = deviceId;
  if (!selectedDeviceId) {
    return true;
  }

  return {
    deviceId: { exact: selectedDeviceId },
  };
}

export function cameraInputConstraint(deviceId: string | null = preferredCameraDeviceId()): MediaTrackConstraints | boolean {
  const selectedDeviceId = deviceId;
  if (!selectedDeviceId) {
    return true;
  }

  return {
    deviceId: { exact: selectedDeviceId },
  };
}

export function screenResolutionDimensions(resolution: ScreenShareResolution): { width: number; height: number } {
  switch (resolution) {
    case "720p":
      return { width: 1280, height: 720 };
    case "1080p":
      return { width: 1920, height: 1080 };
    case "1440p":
      return { width: 2560, height: 1440 };
    case "4k":
      return { width: 3840, height: 2160 };
    default:
      return { width: 1920, height: 1080 };
  }
}

export function screenShareVideoConstraints(options: ScreenShareStartOptions): MediaTrackConstraints {
  const dimensions = screenResolutionDimensions(options.resolution);
  const constraints: MediaTrackConstraints = {
    width: { ideal: dimensions.width },
    height: { ideal: dimensions.height },
    frameRate: { ideal: options.fps, max: options.fps },
  };

  const next = constraints as MediaTrackConstraints & {
    displaySurface?: "monitor" | "window" | "browser";
  };

  if (options.sourceKind === "screen") {
    next.displaySurface = "monitor";
  }

  if (options.sourceKind === "window" || options.sourceKind === "application") {
    next.displaySurface = "window";
  }

  return next;
}

export function screenContentHintFor(options: ScreenShareStartOptions): "motion" | "detail" {
  if (options.fps >= 60) {
    return "motion";
  }

  if (options.sourceKind === "application") {
    return "motion";
  }

  return "detail";
}
