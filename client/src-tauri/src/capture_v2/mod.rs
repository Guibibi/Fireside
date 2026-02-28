pub mod metrics;
pub mod session;

#[cfg(target_os = "windows")]
pub mod capture_loop;
#[cfg(target_os = "windows")]
pub mod encoder;
#[cfg(target_os = "windows")]
pub mod rtp_packetizer;
#[cfg(target_os = "windows")]
pub mod sender;

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

pub use session::CaptureSession;

/// Identifies a capture source — either a monitor or a window.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CaptureSource {
    Monitor {
        /// Display index (0-based).
        index: u32,
        /// Human-readable display name.
        name: String,
        /// Whether this is the primary monitor.
        is_primary: bool,
    },
    Window {
        /// Platform-specific window identifier (encoded as string for JSON compatibility).
        id: String,
        /// Window title.
        title: String,
    },
}

/// Lifecycle state of an active capture session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptureState {
    Starting,
    Running,
    Degraded,
    Stopping,
    Stopped,
    Failed,
}

/// Error details attached to a `Failed` state transition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureError {
    pub code: String,
    pub message: String,
}

/// Result of the `enumerate_sources` command.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnumeratedSources {
    pub monitors: Vec<CaptureSource>,
    pub windows: Vec<CaptureSource>,
}

/// Parameters for `start_capture`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartCaptureRequest {
    /// The source to capture.
    pub source: CaptureSource,
    /// Server PlainTransport IP.
    pub server_ip: String,
    /// Server PlainTransport RTP port.
    pub server_port: u16,
    /// Target bitrate in kbps (default 4000).
    pub bitrate_kbps: Option<u32>,
}

/// State snapshot returned by `get_capture_state`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureStateSnapshot {
    pub state: CaptureState,
    pub error: Option<CaptureError>,
    /// Local UDP port the sender is bound to (available once Running).
    pub local_rtp_port: Option<u16>,
}

/// Global active capture session (singleton per process).
pub type SharedCaptureSession = Arc<Mutex<Option<CaptureSession>>>;

pub fn new_shared_session() -> SharedCaptureSession {
    Arc::new(Mutex::new(None))
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Enumerate available capture sources (monitors and windows).
#[tauri::command]
pub async fn enumerate_sources() -> Result<EnumeratedSources, String> {
    #[cfg(target_os = "windows")]
    {
        session::enumerate_sources_impl()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(EnumeratedSources {
            monitors: vec![],
            windows: vec![],
        })
    }
}

/// Start a capture session for the given source and server PlainTransport address.
#[tauri::command]
pub async fn start_capture(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedCaptureSession>,
    request: StartCaptureRequest,
) -> Result<CaptureStateSnapshot, String> {
    let mut session_guard = state.lock().await;

    // Stop any existing session first.
    if let Some(existing) = session_guard.take() {
        existing.stop().await;
    }

    let session = CaptureSession::start(app, request).await?;
    let snapshot = session.snapshot();
    *session_guard = Some(session);
    Ok(snapshot)
}

/// Stop the active capture session.
#[tauri::command]
pub async fn stop_capture(
    state: tauri::State<'_, SharedCaptureSession>,
) -> Result<CaptureStateSnapshot, String> {
    let mut session_guard = state.lock().await;
    if let Some(session) = session_guard.take() {
        session.stop().await;
    }
    Ok(CaptureStateSnapshot {
        state: CaptureState::Stopped,
        error: None,
        local_rtp_port: None,
    })
}

/// Return the current capture state without modifying it.
#[tauri::command]
pub async fn get_capture_state(
    state: tauri::State<'_, SharedCaptureSession>,
) -> Result<CaptureStateSnapshot, String> {
    let session_guard = state.lock().await;
    Ok(session_guard
        .as_ref()
        .map(|s| s.snapshot())
        .unwrap_or(CaptureStateSnapshot {
            state: CaptureState::Stopped,
            error: None,
            local_rtp_port: None,
        }))
}

/// Return the current capture telemetry metrics snapshot.
#[tauri::command]
pub async fn get_capture_metrics(
    state: tauri::State<'_, SharedCaptureSession>,
) -> Result<metrics::CaptureMetricsSnapshot, String> {
    let session_guard = state.lock().await;
    Ok(session_guard
        .as_ref()
        .and_then(|s| s.metrics())
        .unwrap_or_default())
}
