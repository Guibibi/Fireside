/**
 * Typed bridge for Tauri capture_v2 commands.
 *
 * All functions check whether the Tauri runtime is available and throw a
 * descriptive error if called from a browser/non-Tauri context.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type CaptureSourceKind =
  | { kind: "monitor"; index: number; name: string; is_primary: boolean }
  | { kind: "window"; id: string; title: string };

export interface EnumeratedSources {
  monitors: CaptureSourceKind[];
  windows: CaptureSourceKind[];
}

export type CaptureState =
  | "starting"
  | "running"
  | "degraded"
  | "stopping"
  | "stopped"
  | "failed";

export interface CaptureError {
  code: string;
  message: string;
}

export interface CaptureStateSnapshot {
  state: CaptureState;
  error: CaptureError | null;
  /** Local UDP port the sender is bound to (available once Running). */
  local_rtp_port: number | null;
}

export interface StartCaptureRequest {
  source: CaptureSourceKind;
  server_ip: string;
  server_port: number;
  bitrate_kbps?: number;
}

export interface CaptureMetricsSnapshot {
  frames_captured: number;
  frames_encoded: number;
  frames_dropped: number;
  send_errors: number;
  capture_fps: number;
  encode_fps: number;
  queue_depth: number;
}

// ── Tauri detection ───────────────────────────────────────────────────────────

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function requireTauri(): void {
  if (!isTauri()) {
    throw new Error("capture_v2: Tauri runtime is not available");
  }
}

// ── Bridge functions ──────────────────────────────────────────────────────────

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

/** Enumerate available monitors and windows for capture. */
export async function enumerateSources(): Promise<EnumeratedSources> {
  requireTauri();
  return invoke<EnumeratedSources>("enumerate_sources");
}

/** Start capturing the given source and streaming to the server PlainTransport. */
export async function startCapture(
  request: StartCaptureRequest,
): Promise<CaptureStateSnapshot> {
  requireTauri();
  return invoke<CaptureStateSnapshot>("start_capture", { request });
}

/** Stop the active capture session. */
export async function stopCapture(): Promise<CaptureStateSnapshot> {
  requireTauri();
  return invoke<CaptureStateSnapshot>("stop_capture");
}

/** Get the current capture lifecycle state. */
export async function getCaptureState(): Promise<CaptureStateSnapshot> {
  requireTauri();
  return invoke<CaptureStateSnapshot>("get_capture_state");
}

/** Get the current capture telemetry metrics. */
export async function getCaptureMetrics(): Promise<CaptureMetricsSnapshot> {
  requireTauri();
  return invoke<CaptureMetricsSnapshot>("get_capture_metrics");
}

/** Subscribe to `capture-state-changed` Tauri events. Returns an unsubscribe function. */
export async function onCaptureStateChanged(
  handler: (snapshot: { state: CaptureState; error: CaptureError | null }) => void,
): Promise<() => void> {
  if (!isTauri()) {
    return () => {};
  }
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<{ state: CaptureState; error: CaptureError | null }>(
    "capture-state-changed",
    (event) => handler(event.payload),
  );
  return unlisten;
}

/** Subscribe to `capture-telemetry` Tauri events. Returns an unsubscribe function. */
export async function onCaptureTelemetry(
  handler: (metrics: CaptureMetricsSnapshot) => void,
): Promise<() => void> {
  if (!isTauri()) {
    return () => {};
  }
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<CaptureMetricsSnapshot>(
    "capture-telemetry",
    (event) => handler(event.payload),
  );
  return unlisten;
}
