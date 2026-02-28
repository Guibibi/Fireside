use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::AppHandle;
use tauri::Emitter;

use super::metrics::{new_shared_metrics, CaptureMetricsSnapshot, SharedMetrics};
use super::{
    CaptureError, CaptureState, CaptureStateSnapshot, EnumeratedSources, StartCaptureRequest,
};

/// Shared inner state of a running capture session.
struct SessionInner {
    state: CaptureState,
    error: Option<CaptureError>,
    local_rtp_port: Option<u16>,
}

/// Handle to an active (or recently stopped) capture session.
pub struct CaptureSession {
    inner: Arc<Mutex<SessionInner>>,
    metrics: SharedMetrics,
    /// Used to signal the pipeline threads to stop.
    stop_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl CaptureSession {
    /// Start a new capture session.
    pub async fn start(app: AppHandle, request: StartCaptureRequest) -> Result<Self, String> {
        let inner = Arc::new(Mutex::new(SessionInner {
            state: CaptureState::Starting,
            error: None,
            local_rtp_port: None,
        }));
        let metrics = new_shared_metrics();
        metrics.reset();

        let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();

        // Emit initial state.
        emit_state_event(&app, CaptureState::Starting, None);

        // Spawn the pipeline on a background thread.
        let inner_clone = inner.clone();
        let metrics_clone = metrics.clone();
        let app_clone = app.clone();

        tokio::task::spawn_blocking(move || {
            run_pipeline(app_clone, inner_clone, metrics_clone, request, stop_rx);
        });

        Ok(Self {
            inner,
            metrics,
            stop_tx: Some(stop_tx),
        })
    }

    /// Signal the pipeline to stop and wait briefly.
    pub async fn stop(mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
        // Give the pipeline a moment to clean up (non-blocking wait).
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    pub fn snapshot(&self) -> CaptureStateSnapshot {
        let inner = self.inner.lock().unwrap();
        CaptureStateSnapshot {
            state: inner.state.clone(),
            error: inner.error.clone(),
            local_rtp_port: inner.local_rtp_port,
        }
    }

    pub fn metrics(&self) -> Option<CaptureMetricsSnapshot> {
        Some(self.metrics.snapshot())
    }
}

fn emit_state_event(app: &AppHandle, state: CaptureState, error: Option<CaptureError>) {
    let _ = app.emit(
        "capture-state-changed",
        serde_json::json!({
            "state": state,
            "error": error,
        }),
    );
}

fn transition(
    app: &AppHandle,
    inner: &Arc<Mutex<SessionInner>>,
    new_state: CaptureState,
    error: Option<CaptureError>,
    local_rtp_port: Option<u16>,
) {
    {
        let mut guard = inner.lock().unwrap();
        guard.state = new_state.clone();
        guard.error = error.clone();
        if let Some(port) = local_rtp_port {
            guard.local_rtp_port = Some(port);
        }
    }
    emit_state_event(app, new_state, error);
}

/// Main pipeline runner (runs on a dedicated OS thread via `spawn_blocking`).
fn run_pipeline(
    app: AppHandle,
    inner: Arc<Mutex<SessionInner>>,
    _metrics: SharedMetrics,
    _request: StartCaptureRequest,
    _stop_rx: tokio::sync::oneshot::Receiver<()>,
) {
    #[cfg(target_os = "windows")]
    {
        run_pipeline_windows(app, inner, _metrics, _request, _stop_rx);
        return;
    }

    #[cfg(not(target_os = "windows"))]
    {
        // On non-Windows, immediately fail since capture is unsupported.
        transition(
            &app,
            &inner,
            CaptureState::Failed,
            Some(CaptureError {
                code: "unsupported_platform".into(),
                message: "Screen capture is only supported on Windows.".into(),
            }),
            None,
        );
    }
}

#[cfg(target_os = "windows")]
fn run_pipeline_windows(
    app: AppHandle,
    inner: Arc<Mutex<SessionInner>>,
    metrics: SharedMetrics,
    request: StartCaptureRequest,
    stop_rx: tokio::sync::oneshot::Receiver<()>,
) {
    use super::capture_loop::{start_capture_loop, CaptureFrame};
    use super::encoder::H264Encoder;
    use super::sender::RtpSender;
    use crossbeam_channel::bounded;
    use ring_channel::ring_channel;
    use std::num::NonZeroUsize;
    use std::sync::atomic::Ordering;
    use tokio::sync::oneshot::error::TryRecvError;

    let bitrate_kbps = request.bitrate_kbps.unwrap_or(4000);

    // Phase 1: Start UDP sender (binds local socket).
    let sender = match RtpSender::new(&request.server_ip, request.server_port) {
        Ok(s) => s,
        Err(e) => {
            transition(
                &app,
                &inner,
                CaptureState::Failed,
                Some(CaptureError {
                    code: "sender_init_failed".into(),
                    message: e,
                }),
                None,
            );
            return;
        }
    };

    let local_port = sender.local_port();
    transition(&app, &inner, CaptureState::Running, None, Some(local_port));

    // Phase 2: Set up channels.
    let (frame_tx, frame_rx) = ring_channel::<CaptureFrame>(NonZeroUsize::new(1).unwrap());
    let (encoded_tx, encoded_rx) = bounded::<Vec<u8>>(2);

    // Phase 3: Start capture loop.
    let stop_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop_flag_capture = stop_flag.clone();
    let metrics_capture = metrics.clone();
    let app_capture = app.clone();
    let inner_capture = inner.clone();

    let capture_handle = std::thread::spawn(move || {
        if let Err(error_message) = start_capture_loop(
            request.source,
            frame_tx,
            stop_flag_capture.clone(),
            metrics_capture,
        ) {
            transition(
                &app_capture,
                &inner_capture,
                CaptureState::Failed,
                Some(CaptureError {
                    code: "capture_loop_failed".into(),
                    message: error_message,
                }),
                None,
            );
            stop_flag_capture.store(true, Ordering::Relaxed);
        }
    });

    // Phase 4: Start encode thread.
    let metrics_encode = metrics.clone();
    let encode_handle = std::thread::spawn(move || {
        let mut encoder = match H264Encoder::new(bitrate_kbps) {
            Ok(e) => e,
            Err(e) => {
                eprintln!("[capture_v2] Encoder init failed: {e}");
                return;
            }
        };

        while let Ok(frame) = frame_rx.recv() {
            match encoder.encode_frame(&frame) {
                Ok(Some(nalu_data)) => {
                    metrics_encode
                        .frames_encoded
                        .fetch_add(1, Ordering::Relaxed);
                    if encoded_tx.send(nalu_data).is_err() {
                        break;
                    }
                }
                Ok(None) => {}
                Err(e) => {
                    eprintln!("[capture_v2] Encode error: {e}");
                    metrics_encode
                        .frames_dropped
                        .fetch_add(1, Ordering::Relaxed);
                }
            }
        }
    });

    // Phase 5: Start send thread.
    let metrics_send = metrics.clone();
    let send_handle = std::thread::spawn(move || {
        let mut seq: u16 = 0;
        let mut ts: u32 = 0;
        const SSRC: u32 = 0x12345678;

        while let Ok(nalu_data) = encoded_rx.recv() {
            let packets = super::rtp_packetizer::packetize(&nalu_data, seq, ts, SSRC);
            let pkt_count = packets.len();
            for pkt in packets {
                if let Err(e) = sender.send_packet(&pkt) {
                    eprintln!("[capture_v2] Send error: {e}");
                    metrics_send.send_errors.fetch_add(1, Ordering::Relaxed);
                }
            }
            seq = seq.wrapping_add(pkt_count as u16);
            // 90 kHz clock at ~30 fps: 90000/30 = 3000 ticks per frame.
            ts = ts.wrapping_add(3000);
        }
    });

    // Telemetry loop — emits metrics every 2s until stop is signalled.
    let app_telemetry = app.clone();
    let metrics_telemetry = metrics.clone();
    let inner_telemetry = inner.clone();

    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(2));
        {
            let guard = inner_telemetry.lock().unwrap();
            if guard.state == CaptureState::Stopping
                || guard.state == CaptureState::Stopped
                || guard.state == CaptureState::Failed
            {
                break;
            }
        }
        let snapshot = metrics_telemetry.snapshot();
        let _ = app_telemetry.emit("capture-telemetry", snapshot);
    });

    // Wait for explicit stop or early capture failure.
    let mut stop_rx = stop_rx;
    loop {
        match stop_rx.try_recv() {
            Ok(()) | Err(TryRecvError::Closed) => break,
            Err(TryRecvError::Empty) => {}
        }

        if stop_flag.load(Ordering::Relaxed) {
            break;
        }

        std::thread::sleep(Duration::from_millis(20));
    }
    stop_flag.store(true, Ordering::Relaxed);

    let failed = {
        let guard = inner.lock().unwrap();
        guard.state == CaptureState::Failed
    };

    if !failed {
        transition(&app, &inner, CaptureState::Stopping, None, None);
    }

    // Join threads (with timeout).
    let _ = capture_handle.join();
    let _ = encode_handle.join();
    let _ = send_handle.join();

    if !failed {
        transition(&app, &inner, CaptureState::Stopped, None, None);
    }
}

/// Enumerate available capture sources.
pub fn enumerate_sources_impl() -> Result<EnumeratedSources, String> {
    #[cfg(target_os = "windows")]
    {
        use windows_capture::monitor::Monitor;
        use windows_capture::window::Window;

        let monitors: Vec<super::CaptureSource> = Monitor::enumerate()
            .map_err(|e| format!("Failed to enumerate monitors: {e}"))?
            .into_iter()
            .enumerate()
            .map(|(idx, m)| super::CaptureSource::Monitor {
                index: idx as u32,
                name: m.name().unwrap_or_else(|_| format!("Display {idx}")),
                is_primary: m.is_primary().unwrap_or(false),
            })
            .collect();

        let windows: Vec<super::CaptureSource> = Window::enumerate()
            .map_err(|e| format!("Failed to enumerate windows: {e}"))?
            .into_iter()
            .filter_map(|w| {
                let title = w.title().ok()?;
                if title.is_empty() {
                    return None;
                }
                Some(super::CaptureSource::Window {
                    id: format!("{:?}", w.as_raw_hwnd()),
                    title,
                })
            })
            .collect();

        Ok(EnumeratedSources { monitors, windows })
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(EnumeratedSources {
            monitors: vec![],
            windows: vec![],
        })
    }
}
