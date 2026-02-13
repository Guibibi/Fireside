use serde::Serialize;
use tauri::Window;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
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

    Ok(sources)
}

#[cfg(target_os = "windows")]
pub fn start_capture(window: &Window, request: &NativeCaptureStartRequest) -> Result<(), String> {
    let sources = list_sources(window)?;
    if !sources.iter().any(|source| source.id == request.source_id) {
        return Err(
            "Selected capture source is no longer available. Refresh and try again.".to_string(),
        );
    }

    Ok(())
}

#[cfg(target_os = "windows")]
pub fn stop_capture() -> Result<(), String> {
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
