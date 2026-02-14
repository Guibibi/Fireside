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
  encoder_backend?: "auto" | "openh264" | "nvenc";
  codec_mime_type?: string;
  rtp_target?: string;
  payload_type?: number;
  ssrc?: number;
}

export interface NativeCaptureStatus {
  active: boolean;
  source_id: string | null;
  source_kind: NativeCaptureSourceKind | null;
  resolution: "720p" | "1080p" | "1440p" | "4k" | null;
  fps: 30 | 60 | null;
  bitrate_kbps: number | null;
  native_sender: {
    worker_active: boolean;
    source_id: string | null;
    queue_capacity: number;
    target_fps: 30 | 60 | null;
    target_bitrate_kbps: number | null;
    worker_started_at_ms: number | null;
    received_packets: number;
    processed_packets: number;
    dropped_full: number;
    dropped_disconnected: number;
    worker_disconnect_events: number;
    encoded_frames: number;
    encoded_bytes: number;
    rtp_packets_sent: number;
    rtp_send_errors: number;
    encode_errors: number;
    keyframe_requests: number;
    dropped_missing_bgra: number;
    dropped_before_encode: number;
    dropped_during_send: number;
    rtp_target: string | null;
    estimated_queue_depth: number;
    last_frame_width: number | null;
    last_frame_height: number | null;
    last_frame_timestamp_ms: number | null;
    last_encode_latency_ms: number | null;
    recent_fallback_reason: string | null;
    degradation_level: "none" | "fps_reduced" | "resolution_reduced" | "bitrate_reduced";
    pressure_window_avg_depth: number;
    pressure_window_peak_depth: number;
    pressure_window_max_avg_depth: number;
    pressure_window_max_peak_depth: number;
    producer_connected: boolean;
    transport_connected: boolean;
    sender_started_events: number;
    sender_stopped_events: number;
    fallback_triggered_events: number;
    fallback_completed_events: number;
    encoder_backend_runtime_fallback_events: number;
    encoder_backend: "openh264" | "nvenc" | string | null;
    encoder_backend_requested: "auto" | "openh264" | "nvenc" | string | null;
    encoder_backend_fallback_reason: string | null;
  };
}

export interface NativeCodecCapability {
  mime_type: string;
  available: boolean;
  detail: string | null;
}

export async function listNativeCaptureSources(): Promise<NativeCaptureSource[]> {
  const sources = await invoke<NativeCaptureSource[]>("list_native_capture_sources");
  return sources;
}

export async function nativeCodecCapabilities(): Promise<NativeCodecCapability[]> {
  const capabilities = await invoke<NativeCodecCapability[]>("native_codec_capabilities");
  return capabilities;
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
