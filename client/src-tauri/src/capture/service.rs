mod encoder_backend;
mod h264_encoder;
mod metrics;
mod native_sender;
mod nvenc_encoder;
mod rtp_packetizer;
mod rtp_sender;

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use tauri::{State, Window};

use super::windows_capture::{
    self, NativeCaptureSource, NativeCaptureSourceKind, NativeCaptureStartRequest,
    NativeFramePacket,
};
use metrics::{NativeSenderMetrics, NativeSenderSharedMetrics, NativeSenderSnapshotInput};
use native_sender::{run_native_sender_worker, NativeSenderRuntimeConfig};

const DEFAULT_FRAME_QUEUE_CAPACITY: usize = 6;

fn frame_queue_capacity() -> usize {
    std::env::var("YANKCORD_NATIVE_FRAME_QUEUE_CAPACITY")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| (2..=64).contains(value))
        .unwrap_or(DEFAULT_FRAME_QUEUE_CAPACITY)
}

#[derive(Debug, Clone)]
struct ActiveCaptureSession {
    source_id: String,
    source_kind: NativeCaptureSourceKind,
    resolution: Option<String>,
    fps: Option<u32>,
    bitrate_kbps: Option<u32>,
    encoder_backend: Option<String>,
}

#[derive(Debug)]
struct NativeSenderWorker {
    source_id: String,
    queue_capacity: usize,
    target_fps: Option<u32>,
    target_bitrate_kbps: Option<u32>,
    rtp_target: Option<String>,
    stop_signal: Arc<AtomicBool>,
    shared: Arc<NativeSenderSharedMetrics>,
    handle: Option<JoinHandle<()>>,
}

#[derive(Default)]
pub struct NativeCaptureService {
    active_session: Mutex<Option<ActiveCaptureSession>>,
    sender_worker: Mutex<Option<NativeSenderWorker>>,
    last_sender_metrics: Mutex<Option<NativeSenderMetrics>>,
}

#[derive(Debug, Deserialize)]
pub struct StartNativeCaptureRequest {
    pub source_id: String,
    pub resolution: Option<String>,
    pub fps: Option<u32>,
    pub bitrate_kbps: Option<u32>,
    pub encoder_backend: Option<String>,
    pub rtp_target: Option<String>,
    pub payload_type: Option<u8>,
    pub ssrc: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeCaptureStatus {
    pub active: bool,
    pub source_id: Option<String>,
    pub source_kind: Option<NativeCaptureSourceKind>,
    pub resolution: Option<String>,
    pub fps: Option<u32>,
    pub bitrate_kbps: Option<u32>,
    pub native_sender: NativeSenderMetrics,
}

impl NativeCaptureService {
    fn remember_last_sender_metrics(&self, metrics: NativeSenderMetrics) {
        if let Ok(mut last) = self.last_sender_metrics.lock() {
            *last = Some(metrics);
        }
    }

    fn reap_finished_worker_if_needed(&self) -> Result<(), String> {
        let mut worker = self
            .sender_worker
            .lock()
            .map_err(|_| "Native capture sender-worker lock was poisoned".to_string())?;

        let Some(active_worker) = worker.as_mut() else {
            return Ok(());
        };

        let Some(handle) = active_worker.handle.as_ref() else {
            return Ok(());
        };

        if !handle.is_finished() {
            return Ok(());
        }

        let worker_active = false;
        let dispatch = windows_capture::read_frame_dispatch_stats();
        let metrics = active_worker.shared.snapshot(NativeSenderSnapshotInput {
            worker_active,
            source_id: Some(active_worker.source_id.clone()),
            queue_capacity: active_worker.queue_capacity,
            target_fps: active_worker.target_fps,
            target_bitrate_kbps: active_worker.target_bitrate_kbps,
            rtp_target: active_worker.rtp_target.clone(),
            dispatch,
        });
        self.remember_last_sender_metrics(metrics);

        if let Some(done_handle) = active_worker.handle.take() {
            done_handle
                .join()
                .map_err(|_| "Native sender worker thread panicked".to_string())?;
        }

        *worker = None;
        windows_capture::clear_frame_sink()?;

        Ok(())
    }

    fn sender_metrics(&self) -> Result<NativeSenderMetrics, String> {
        self.reap_finished_worker_if_needed()?;
        let dispatch = windows_capture::read_frame_dispatch_stats();

        let worker = self
            .sender_worker
            .lock()
            .map_err(|_| "Native capture sender-worker lock was poisoned".to_string())?;

        let Some(worker) = worker.as_ref() else {
            let last = self
                .last_sender_metrics
                .lock()
                .map_err(|_| "Native capture sender metrics lock was poisoned".to_string())?
                .clone();

            if let Some(mut metrics) = last {
                metrics.worker_active = false;
                metrics.source_id = None;
                metrics.rtp_target = None;
                metrics.estimated_queue_depth = dispatch.queued_frames;
                metrics.dropped_full = dispatch.dropped_full;
                metrics.dropped_disconnected = dispatch.dropped_disconnected;
                return Ok(metrics);
            }

            return Ok(NativeSenderMetrics {
                worker_active: false,
                source_id: None,
                queue_capacity: 0,
                target_fps: None,
                target_bitrate_kbps: None,
                worker_started_at_ms: None,
                received_packets: 0,
                processed_packets: 0,
                dropped_full: dispatch.dropped_full,
                dropped_disconnected: dispatch.dropped_disconnected,
                worker_disconnect_events: 0,
                encoded_frames: 0,
                encoded_bytes: 0,
                rtp_packets_sent: 0,
                rtp_send_errors: 0,
                encode_errors: 0,
                keyframe_requests: 0,
                dropped_missing_bgra: 0,
                dropped_before_encode: 0,
                dropped_during_send: 0,
                rtp_target: None,
                estimated_queue_depth: dispatch.queued_frames,
                last_frame_width: None,
                last_frame_height: None,
                last_frame_timestamp_ms: None,
                last_encode_latency_ms: None,
                recent_fallback_reason: None,
                degradation_level: "none".to_string(),
                pressure_window_avg_depth: 0,
                pressure_window_peak_depth: 0,
                pressure_window_max_avg_depth: 0,
                pressure_window_max_peak_depth: 0,
                producer_connected: false,
                transport_connected: false,
                sender_started_events: 0,
                sender_stopped_events: 0,
                fallback_triggered_events: 0,
                fallback_completed_events: 0,
                encoder_backend_runtime_fallback_events: 0,
                encoder_backend: None,
                encoder_backend_requested: None,
                encoder_backend_fallback_reason: None,
            });
        };

        Ok(worker.shared.snapshot(NativeSenderSnapshotInput {
            worker_active: worker
                .handle
                .as_ref()
                .map(|handle| !handle.is_finished())
                .unwrap_or(false),
            source_id: Some(worker.source_id.clone()),
            queue_capacity: worker.queue_capacity,
            target_fps: worker.target_fps,
            target_bitrate_kbps: worker.target_bitrate_kbps,
            rtp_target: worker.rtp_target.clone(),
            dispatch,
        }))
    }

    fn current_status(&self) -> Result<NativeCaptureStatus, String> {
        let sender_metrics = self.sender_metrics()?;
        let session = self
            .active_session
            .lock()
            .map_err(|_| "Native capture service lock was poisoned".to_string())?;

        let status = match session.as_ref() {
            Some(active) => NativeCaptureStatus {
                active: true,
                source_id: Some(active.source_id.clone()),
                source_kind: Some(active.source_kind.clone()),
                resolution: active.resolution.clone(),
                fps: active.fps,
                bitrate_kbps: active.bitrate_kbps,
                native_sender: sender_metrics,
            },
            None => NativeCaptureStatus {
                active: false,
                source_id: None,
                source_kind: None,
                resolution: None,
                fps: None,
                bitrate_kbps: None,
                native_sender: sender_metrics,
            },
        };

        Ok(status)
    }

    fn is_worker_active_for(&self, source_id: &str) -> Result<bool, String> {
        self.reap_finished_worker_if_needed()?;
        let worker = self
            .sender_worker
            .lock()
            .map_err(|_| "Native capture sender-worker lock was poisoned".to_string())?;

        Ok(worker
            .as_ref()
            .map(|active| {
                active.source_id == source_id
                    && active
                        .handle
                        .as_ref()
                        .map(|handle| !handle.is_finished())
                        .unwrap_or(false)
            })
            .unwrap_or(false))
    }

    fn stop_sender_worker(&self) -> Result<(), String> {
        let mut worker = self
            .sender_worker
            .lock()
            .map_err(|_| "Native capture sender-worker lock was poisoned".to_string())?;

        let Some(mut active_worker) = worker.take() else {
            windows_capture::clear_frame_sink()?;
            return Ok(());
        };

        active_worker.stop_signal.store(true, Ordering::Relaxed);
        windows_capture::clear_frame_sink()?;

        let metrics = active_worker.shared.snapshot(NativeSenderSnapshotInput {
            worker_active: false,
            source_id: Some(active_worker.source_id.clone()),
            queue_capacity: active_worker.queue_capacity,
            target_fps: active_worker.target_fps,
            target_bitrate_kbps: active_worker.target_bitrate_kbps,
            rtp_target: active_worker.rtp_target.clone(),
            dispatch: windows_capture::read_frame_dispatch_stats(),
        });
        self.remember_last_sender_metrics(metrics);

        if let Some(handle) = active_worker.handle.take() {
            handle
                .join()
                .map_err(|_| "Native sender worker thread panicked".to_string())?;
        }

        Ok(())
    }

    fn start_sender_worker(
        &self,
        source_id: String,
        fps: Option<u32>,
        bitrate_kbps: Option<u32>,
        encoder_backend: Option<String>,
        rtp_target: Option<String>,
        payload_type: u8,
        ssrc: u32,
    ) -> Result<(), String> {
        self.stop_sender_worker()?;
        windows_capture::reset_frame_dispatch_stats();

        let queue_capacity = frame_queue_capacity();
        let (sender, receiver) = windows_capture::create_frame_channel(queue_capacity);
        windows_capture::install_frame_sink(sender)?;

        let stop_signal = Arc::new(AtomicBool::new(false));
        let shared = Arc::new(NativeSenderSharedMetrics::default());
        let target_rtp = rtp_target.or_else(|| std::env::var("YANKCORD_NATIVE_RTP_TARGET").ok());

        let worker_stop_signal = Arc::clone(&stop_signal);
        let worker_shared = Arc::clone(&shared);
        let worker_source_id = source_id.clone();
        let worker_target_fps = fps;
        let worker_target_bitrate_kbps = bitrate_kbps;
        let worker_encoder_backend = encoder_backend.clone();
        let worker_target_rtp = target_rtp.clone();
        let handle = thread::Builder::new()
            .name("native-sender-worker".to_string())
            .spawn(move || {
                spawn_worker(
                    NativeSenderRuntimeConfig {
                        source_id: worker_source_id,
                        target_fps: worker_target_fps,
                        target_bitrate_kbps: worker_target_bitrate_kbps,
                        encoder_backend_preference: worker_encoder_backend,
                        target_rtp: worker_target_rtp,
                        payload_type,
                        ssrc,
                    },
                    receiver,
                    worker_stop_signal,
                    worker_shared,
                );
            })
            .map_err(|error| format!("Failed to start native sender worker: {error}"))?;

        let mut worker = self
            .sender_worker
            .lock()
            .map_err(|_| "Native capture sender-worker lock was poisoned".to_string())?;

        *worker = Some(NativeSenderWorker {
            source_id,
            queue_capacity,
            target_fps: fps,
            target_bitrate_kbps: bitrate_kbps,
            rtp_target: target_rtp,
            stop_signal,
            shared,
            handle: Some(handle),
        });

        Ok(())
    }
}

fn spawn_worker(
    config: NativeSenderRuntimeConfig,
    receiver: Receiver<NativeFramePacket>,
    stop_signal: Arc<AtomicBool>,
    shared: Arc<NativeSenderSharedMetrics>,
) {
    run_native_sender_worker(config, receiver, stop_signal, shared);
}

fn normalize_resolution(resolution: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = resolution else {
        return Ok(None);
    };

    let normalized = value.trim().to_lowercase();
    if normalized.is_empty() {
        return Ok(None);
    }

    match normalized.as_str() {
        "720p" | "1080p" | "1440p" | "4k" => Ok(Some(normalized)),
        _ => Err("Unsupported resolution. Use 720p, 1080p, 1440p, or 4k.".to_string()),
    }
}

fn normalize_fps(fps: Option<u32>) -> Result<Option<u32>, String> {
    match fps {
        None => Ok(None),
        Some(30) | Some(60) => Ok(fps),
        Some(_) => Err("Unsupported FPS. Use 30 or 60.".to_string()),
    }
}

fn normalize_bitrate_kbps(bitrate_kbps: Option<u32>) -> Result<Option<u32>, String> {
    let Some(value) = bitrate_kbps else {
        return Ok(None);
    };

    if (1500..=50000).contains(&value) {
        return Ok(Some(value));
    }

    Err("Bitrate out of range. Use a value between 1500 and 50000 kbps.".to_string())
}

fn normalize_encoder_backend(encoder_backend: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = encoder_backend else {
        return Ok(None);
    };

    let normalized = value.trim().to_lowercase();
    if normalized.is_empty() {
        return Ok(None);
    }

    match normalized.as_str() {
        "auto" | "openh264" | "nvenc" => Ok(Some(normalized)),
        _ => Err("Unsupported encoder backend. Use auto, openh264, or nvenc.".to_string()),
    }
}

fn normalize_payload_type(payload_type: Option<u8>) -> Result<u8, String> {
    let value = payload_type.unwrap_or(96);
    if value > 127 {
        return Err("Invalid RTP payload type. Expected a value between 0 and 127.".to_string());
    }
    Ok(value)
}

fn normalize_ssrc(ssrc: Option<u32>) -> Result<u32, String> {
    let value = ssrc.unwrap_or(0x4E41_5456);
    if value == 0 {
        return Err("Invalid RTP SSRC. Value must be non-zero.".to_string());
    }
    Ok(value)
}

#[tauri::command]
pub fn list_native_capture_sources(window: Window) -> Result<Vec<NativeCaptureSource>, String> {
    windows_capture::list_sources(&window)
}

#[tauri::command]
pub fn start_native_capture(
    window: Window,
    service: State<NativeCaptureService>,
    request: StartNativeCaptureRequest,
) -> Result<NativeCaptureStatus, String> {
    let normalized = request.source_id.trim();
    if normalized.is_empty() {
        return Err(
            "A native capture source must be selected before starting screen share.".to_string(),
        );
    }

    let resolution = normalize_resolution(request.resolution)?;
    let fps = normalize_fps(request.fps)?;
    let bitrate_kbps = normalize_bitrate_kbps(request.bitrate_kbps)?;
    let encoder_backend = normalize_encoder_backend(request.encoder_backend)?;
    let payload_type = normalize_payload_type(request.payload_type)?;
    let ssrc = normalize_ssrc(request.ssrc)?;

    let sources = windows_capture::list_sources(&window)?;
    let selected_source = sources
        .iter()
        .find(|source| source.id == normalized)
        .cloned()
        .ok_or_else(|| {
            "Selected capture source is no longer available. Refresh and try again.".to_string()
        })?;

    let active_session = {
        let active_session = service
            .active_session
            .lock()
            .map_err(|_| "Native capture service lock was poisoned".to_string())?;
        active_session.clone()
    };

    if let Some(active) = active_session.as_ref() {
        if active.source_id == normalized
            && active.resolution == resolution
            && active.fps == fps
            && active.bitrate_kbps == bitrate_kbps
            && active.encoder_backend == encoder_backend
            && service.is_worker_active_for(normalized)?
            && windows_capture::is_capture_active_for(normalized)?
        {
            return service.current_status();
        }
    }

    let rtp_target = request.rtp_target.map(|target| target.trim().to_string());
    let rtp_target = match rtp_target {
        Some(value) if value.is_empty() => None,
        Some(value) => {
            value.parse::<std::net::SocketAddr>().map_err(|_| {
                "Invalid RTP target. Expected host:port socket address.".to_string()
            })?;
            Some(value)
        }
        None => None,
    };

    service.start_sender_worker(
        normalized.to_string(),
        fps,
        bitrate_kbps,
        encoder_backend.clone(),
        rtp_target,
        payload_type,
        ssrc,
    )?;

    windows_capture::start_capture(
        &window,
        &NativeCaptureStartRequest {
            source_id: normalized.to_string(),
        },
    )
    .inspect_err(|_| {
        let _ = service.stop_sender_worker();
    })?;

    let mut active_session = service
        .active_session
        .lock()
        .map_err(|_| "Native capture service lock was poisoned".to_string())?;

    *active_session = Some(ActiveCaptureSession {
        source_id: normalized.to_string(),
        source_kind: selected_source.kind,
        resolution,
        fps,
        bitrate_kbps,
        encoder_backend,
    });

    drop(active_session);
    service.current_status()
}

#[tauri::command]
pub fn stop_native_capture(
    service: State<NativeCaptureService>,
) -> Result<NativeCaptureStatus, String> {
    windows_capture::stop_capture()?;
    service.stop_sender_worker()?;

    let mut active_session = service
        .active_session
        .lock()
        .map_err(|_| "Native capture service lock was poisoned".to_string())?;

    *active_session = None;
    drop(active_session);

    service.current_status()
}

#[tauri::command]
pub fn native_capture_status(
    service: State<NativeCaptureService>,
) -> Result<NativeCaptureStatus, String> {
    service.current_status()
}
