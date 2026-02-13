use serde::Serialize;
#[cfg(target_os = "windows")]
use std::sync::{Mutex, OnceLock};
use tauri::Window;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum NativeCaptureSourceKind {
    Screen,
    Window,
    Application,
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeCaptureSource {
    pub id: String,
    pub kind: NativeCaptureSourceKind,
    pub title: String,
    pub app_name: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct NativeCaptureStartRequest {
    pub source_id: String,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeCaptureEventKind {
    Started,
    Frame,
    SourceLost,
    Stopped,
    Error,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Serialize)]
pub struct NativeCaptureEvent {
    pub kind: NativeCaptureEventKind,
    pub source_id: Option<String>,
    pub detail: Option<String>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone)]
struct ActiveCapture {
    source_id: String,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Default)]
struct CaptureAdapterState {
    active: Option<ActiveCapture>,
}

#[cfg(target_os = "windows")]
fn adapter_state() -> &'static Mutex<CaptureAdapterState> {
    static STATE: OnceLock<Mutex<CaptureAdapterState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(CaptureAdapterState::default()))
}

#[cfg(target_os = "windows")]
fn emit_event(event: NativeCaptureEvent) {
    eprintln!("[native-capture] {:?}", event);
}

#[cfg(target_os = "windows")]
pub fn list_sources(window: &Window) -> Result<Vec<NativeCaptureSource>, String> {
    let monitors = window
        .available_monitors()
        .map_err(|error| format!("Failed to list displays: {error}"))?;

    let mut sources = Vec::new();
    for (index, monitor) in monitors.into_iter().enumerate() {
        let title = monitor
            .name()
            .cloned()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| format!("Display {}", index + 1));
        let size = monitor.size();

        sources.push(NativeCaptureSource {
            id: format!("screen-{index}"),
            kind: NativeCaptureSourceKind::Screen,
            title,
            app_name: None,
            width: Some(size.width),
            height: Some(size.height),
        });
    }

    if sources.is_empty() {
        return Err("No native capture sources are available.".to_string());
    }

    sources.sort_by(|left, right| left.title.to_lowercase().cmp(&right.title.to_lowercase()));

    Ok(sources)
}

#[cfg(target_os = "windows")]
pub fn start_capture(window: &Window, request: &NativeCaptureStartRequest) -> Result<(), String> {
    let source_id = request.source_id.trim();
    if source_id.is_empty() {
        emit_event(NativeCaptureEvent {
            kind: NativeCaptureEventKind::Error,
            source_id: None,
            detail: Some("Capture source id cannot be empty".to_string()),
        });
        return Err("Capture source id cannot be empty".to_string());
    }

    let sources = list_sources(window)?;
    if !sources.iter().any(|source| source.id == source_id) {
        emit_event(NativeCaptureEvent {
            kind: NativeCaptureEventKind::SourceLost,
            source_id: Some(source_id.to_string()),
            detail: Some("Selected source is no longer available".to_string()),
        });
        return Err(
            "Selected capture source is no longer available. Refresh and try again.".to_string(),
        );
    }

    let mut state = adapter_state()
        .lock()
        .map_err(|_| "Native capture adapter lock was poisoned".to_string())?;

    if let Some(active) = &state.active {
        if active.source_id == source_id {
            emit_event(NativeCaptureEvent {
                kind: NativeCaptureEventKind::Started,
                source_id: Some(source_id.to_string()),
                detail: Some("Capture already active for selected source".to_string()),
            });
            emit_event(NativeCaptureEvent {
                kind: NativeCaptureEventKind::Frame,
                source_id: Some(source_id.to_string()),
                detail: Some("Frame stream remains active".to_string()),
            });
            return Ok(());
        }

        emit_event(NativeCaptureEvent {
            kind: NativeCaptureEventKind::Stopped,
            source_id: Some(active.source_id.clone()),
            detail: Some("Stopping previous source before restart".to_string()),
        });
    }

    state.active = Some(ActiveCapture {
        source_id: source_id.to_string(),
    });

    emit_event(NativeCaptureEvent {
        kind: NativeCaptureEventKind::Started,
        source_id: Some(source_id.to_string()),
        detail: Some("Capture session started".to_string()),
    });

    emit_event(NativeCaptureEvent {
        kind: NativeCaptureEventKind::Frame,
        source_id: Some(source_id.to_string()),
        detail: Some("Frame pipeline initialized".to_string()),
    });

    Ok(())
}

#[cfg(target_os = "windows")]
pub fn stop_capture() -> Result<(), String> {
    let mut state = adapter_state()
        .lock()
        .map_err(|_| "Native capture adapter lock was poisoned".to_string())?;

    if let Some(active) = state.active.take() {
        emit_event(NativeCaptureEvent {
            kind: NativeCaptureEventKind::Stopped,
            source_id: Some(active.source_id),
            detail: Some("Capture session stopped".to_string()),
        });
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn list_sources(_window: &Window) -> Result<Vec<NativeCaptureSource>, String> {
    Err("Native capture is currently supported on Windows only. Falling back to browser-based sharing.".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn start_capture(_window: &Window, request: &NativeCaptureStartRequest) -> Result<(), String> {
    let _ = request.source_id.len();
    Err("Native capture is currently supported on Windows only. Falling back to browser-based sharing.".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn stop_capture() -> Result<(), String> {
    Ok(())
}
