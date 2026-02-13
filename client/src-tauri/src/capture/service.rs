use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{State, Window};

use super::windows_capture::{
    self, NativeCaptureSource, NativeCaptureSourceKind, NativeCaptureStartRequest,
};

#[derive(Debug, Clone)]
struct ActiveCaptureSession {
    source_id: String,
    resolution: Option<String>,
    fps: Option<u32>,
    bitrate_kbps: Option<u32>,
}

#[derive(Default)]
pub struct NativeCaptureService {
    active_session: Mutex<Option<ActiveCaptureSession>>,
}

#[derive(Debug, Deserialize)]
pub struct StartNativeCaptureRequest {
    pub source_id: String,
    pub resolution: Option<String>,
    pub fps: Option<u32>,
    pub bitrate_kbps: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeCaptureStatus {
    pub active: bool,
    pub source_id: Option<String>,
    pub source_kind: Option<NativeCaptureSourceKind>,
    pub resolution: Option<String>,
    pub fps: Option<u32>,
    pub bitrate_kbps: Option<u32>,
}

impl NativeCaptureService {
    fn source_kind_from_id(source_id: &str) -> Option<NativeCaptureSourceKind> {
        if source_id.starts_with("screen-") {
            return Some(NativeCaptureSourceKind::Screen);
        }

        if source_id.starts_with("window-") {
            return Some(NativeCaptureSourceKind::Window);
        }

        if source_id.starts_with("application-") {
            return Some(NativeCaptureSourceKind::Application);
        }

        None
    }

    fn current_status(&self) -> Result<NativeCaptureStatus, String> {
        let session = self
            .active_session
            .lock()
            .map_err(|_| "Native capture service lock was poisoned".to_string())?;

        let status = match session.as_ref() {
            Some(active) => NativeCaptureStatus {
                active: true,
                source_id: Some(active.source_id.clone()),
                source_kind: Self::source_kind_from_id(&active.source_id),
                resolution: active.resolution.clone(),
                fps: active.fps,
                bitrate_kbps: active.bitrate_kbps,
            },
            None => NativeCaptureStatus {
                active: false,
                source_id: None,
                source_kind: None,
                resolution: None,
                fps: None,
                bitrate_kbps: None,
            },
        };

        Ok(status)
    }
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

    windows_capture::start_capture(
        &window,
        &NativeCaptureStartRequest {
            source_id: normalized.to_string(),
        },
    )?;

    let mut active_session = service
        .active_session
        .lock()
        .map_err(|_| "Native capture service lock was poisoned".to_string())?;

    *active_session = Some(ActiveCaptureSession {
        source_id: normalized.to_string(),
        resolution: request.resolution,
        fps: request.fps,
        bitrate_kbps: request.bitrate_kbps,
    });

    drop(active_session);
    service.current_status()
}

#[tauri::command]
pub fn stop_native_capture(
    service: State<NativeCaptureService>,
) -> Result<NativeCaptureStatus, String> {
    windows_capture::stop_capture()?;

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
