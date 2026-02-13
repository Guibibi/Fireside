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

#[cfg(target_os = "linux")]
fn linux_window_sources() -> Vec<NativeCaptureSource> {
    use std::process::Command;

    let output = Command::new("wmctrl").arg("-lx").output();
    let Ok(output) = output else {
        return Vec::new();
    };

    if !output.status.success() {
        return Vec::new();
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .enumerate()
        .filter_map(|(index, line)| {
            let mut parts = line.split_whitespace();
            let _window_id = parts.next()?;
            let _desktop = parts.next()?;
            let wm_class = parts.next().unwrap_or("");
            let _host = parts.next();
            let title = parts.collect::<Vec<_>>().join(" ").trim().to_string();
            if title.is_empty() {
                return None;
            }

            let app_name = wm_class
                .split('.')
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);

            Some(NativeCaptureSource {
                id: format!("window-linux-{index}"),
                kind: NativeCaptureSourceKind::Window,
                title,
                app_name,
                width: None,
                height: None,
            })
        })
        .collect()
}

#[cfg(not(target_os = "linux"))]
fn linux_window_sources() -> Vec<NativeCaptureSource> {
    Vec::new()
}

#[tauri::command]
pub fn list_native_capture_sources(window: Window) -> Result<Vec<NativeCaptureSource>, String> {
    let mut sources: Vec<NativeCaptureSource> = Vec::new();

    let monitors = window
        .available_monitors()
        .map_err(|error| format!("Failed to list displays: {error}"))?;

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

    let windows = linux_window_sources();
    if windows.is_empty() {
        sources.push(NativeCaptureSource {
            id: "application-fallback".to_string(),
            kind: NativeCaptureSourceKind::Application,
            title: "Application Window".to_string(),
            app_name: None,
            width: None,
            height: None,
        });
    } else {
        sources.extend(windows);
    }

    Ok(sources)
}
