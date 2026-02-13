import { invoke } from "@tauri-apps/api/core";

export type NativeCaptureSourceKind = "screen" | "window" | "application";

export interface NativeCaptureSource {
  id: string;
  kind: NativeCaptureSourceKind;
  title: string;
  app_name: string | null;
  width: number | null;
  height: number | null;
}

export interface StartNativeCaptureRequest {
  source_id: string;
  resolution?: "720p" | "1080p" | "1440p" | "4k";
  fps?: 30 | 60;
  bitrate_kbps?: number;
}

export interface NativeCaptureStatus {
  active: boolean;
  source_id: string | null;
  source_kind: NativeCaptureSourceKind | null;
  resolution: "720p" | "1080p" | "1440p" | "4k" | null;
  fps: 30 | 60 | null;
  bitrate_kbps: number | null;
}

export async function listNativeCaptureSources(): Promise<NativeCaptureSource[]> {
  const sources = await invoke<NativeCaptureSource[]>("list_native_capture_sources");
  return sources;
}

export async function startNativeCapture(request: StartNativeCaptureRequest): Promise<NativeCaptureStatus> {
  const status = await invoke<NativeCaptureStatus>("start_native_capture", { request });
  return status;
}

export async function stopNativeCapture(): Promise<NativeCaptureStatus> {
  const status = await invoke<NativeCaptureStatus>("stop_native_capture");
  return status;
}

export async function nativeCaptureStatus(): Promise<NativeCaptureStatus> {
  const status = await invoke<NativeCaptureStatus>("native_capture_status");
  return status;
}
