use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{State, Window};

use super::windows_capture::{
    self, NativeCaptureSource, NativeCaptureSourceKind, NativeCaptureStartRequest,
};

#[derive(Debug, Clone)]
struct ActiveCaptureSession {
    source_id: String,
    source_kind: NativeCaptureSourceKind,
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
    fn current_status(&self) -> Result<NativeCaptureStatus, String> {
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

    let sources = windows_capture::list_sources(&window)?;
    let selected_source = sources
        .iter()
        .find(|source| source.id == normalized)
        .cloned()
        .ok_or_else(|| {
            "Selected capture source is no longer available. Refresh and try again.".to_string()
        })?;

    {
        let active_session = service
            .active_session
            .lock()
            .map_err(|_| "Native capture service lock was poisoned".to_string())?;

        if let Some(active) = active_session.as_ref() {
            if active.source_id == normalized
                && active.resolution == resolution
                && active.fps == fps
                && active.bitrate_kbps == bitrate_kbps
                && windows_capture::is_capture_active_for(normalized)?
            {
                drop(active_session);
                return service.current_status();
            }
        }
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
        source_kind: selected_source.kind,
        resolution,
        fps,
        bitrate_kbps,
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
