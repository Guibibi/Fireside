use serde::Serialize;
#[cfg(target_os = "windows")]
use std::collections::HashMap;
#[cfg(target_os = "windows")]
use std::ffi::c_void;
#[cfg(target_os = "windows")]
use std::sync::{Mutex, OnceLock};
#[cfg(target_os = "windows")]
use std::time::{Duration, Instant};
use tauri::Window;

#[cfg(target_os = "windows")]
use windows_capture::capture::{CaptureControl, Context, GraphicsCaptureApiHandler};
#[cfg(target_os = "windows")]
use windows_capture::frame::Frame;
#[cfg(target_os = "windows")]
use windows_capture::graphics_capture_api::InternalCaptureControl;
#[cfg(target_os = "windows")]
use windows_capture::monitor::Monitor;
#[cfg(target_os = "windows")]
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};
#[cfg(target_os = "windows")]
use windows_capture::window::Window as WinWindow;

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
#[derive(Debug)]
struct ActiveCapture {
    source_id: String,
    control: CaptureControl<NativeFrameHandler, String>,
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
fn clear_active_capture_for_source(source_id: &str) -> Result<bool, String> {
    let mut state = adapter_state()
        .lock()
        .map_err(|_| "Native capture adapter lock was poisoned".to_string())?;

    let Some(active) = state.active.as_ref() else {
        return Ok(false);
    };

    if active.source_id != source_id {
        return Ok(false);
    }

    state.active = None;
    Ok(true)
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone)]
struct NativeFrameHandlerFlags {
    source_id: String,
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
struct NativeFrameHandler {
    source_id: String,
    start: Instant,
    last_report: Instant,
    frame_count: u64,
    reported_frames: u64,
}

#[cfg(target_os = "windows")]
impl GraphicsCaptureApiHandler for NativeFrameHandler {
    type Flags = NativeFrameHandlerFlags;
    type Error = String;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        let now = Instant::now();
        Ok(Self {
            source_id: ctx.flags.source_id,
            start: now,
            last_report: now,
            frame_count: 0,
            reported_frames: 0,
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        _capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        self.frame_count = self.frame_count.saturating_add(1);

        let now = Instant::now();
        let elapsed = now.saturating_duration_since(self.last_report);
        if elapsed < Duration::from_secs(1) {
            return Ok(());
        }

        let delta_frames = self.frame_count.saturating_sub(self.reported_frames);
        let fps = if elapsed.as_secs_f64() > 0.0 {
            delta_frames as f64 / elapsed.as_secs_f64()
        } else {
            0.0
        };

        self.last_report = now;
        self.reported_frames = self.frame_count;

        emit_event(NativeCaptureEvent {
            kind: NativeCaptureEventKind::Frame,
            source_id: Some(self.source_id.clone()),
            detail: Some(format!(
                "{{\"width\":{},\"height\":{},\"fps\":{:.1},\"frames\":{},\"uptime_ms\":{}}}",
                frame.width(),
                frame.height(),
                fps,
                self.frame_count,
                self.start.elapsed().as_millis()
            )),
        });

        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        let cleared = clear_active_capture_for_source(&self.source_id)?;
        emit_event(NativeCaptureEvent {
            kind: NativeCaptureEventKind::SourceLost,
            source_id: Some(self.source_id.clone()),
            detail: Some(if cleared {
                "Capture source was closed by the OS; adapter state reset".to_string()
            } else {
                "Capture source was closed by the OS".to_string()
            }),
        });
        Ok(())
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
enum SelectedCaptureItem {
    Screen(Monitor),
    Window(WinWindow),
}

#[cfg(target_os = "windows")]
fn safe_window_dimensions(window: WinWindow) -> (Option<u32>, Option<u32>) {
    let Ok(rect) = window.rect() else {
        return (None, None);
    };

    let width = rect.right.saturating_sub(rect.left);
    let height = rect.bottom.saturating_sub(rect.top);

    let width = u32::try_from(width).ok().filter(|value| *value > 0);
    let height = u32::try_from(height).ok().filter(|value| *value > 0);
    (width, height)
}

#[cfg(target_os = "windows")]
fn monitor_sources() -> Result<Vec<NativeCaptureSource>, String> {
    let monitors =
        Monitor::enumerate().map_err(|error| format!("Failed to list displays: {error}"))?;
    let mut sources = Vec::with_capacity(monitors.len());

    for monitor in monitors {
        let device_name = monitor
            .device_name()
            .map_err(|error| format!("Failed to read monitor id: {error}"))?;
        let title = monitor.name().unwrap_or_else(|_| device_name.clone());

        let width = monitor.width().ok();
        let height = monitor.height().ok();

        sources.push(NativeCaptureSource {
            id: format!("screen:{device_name}"),
            kind: NativeCaptureSourceKind::Screen,
            title,
            app_name: None,
            width,
            height,
        });
    }

    Ok(sources)
}

#[cfg(target_os = "windows")]
fn window_and_application_sources() -> Result<Vec<NativeCaptureSource>, String> {
    let windows =
        WinWindow::enumerate().map_err(|error| format!("Failed to list windows: {error}"))?;

    let mut sources = Vec::new();
    let mut applications: HashMap<u32, NativeCaptureSource> = HashMap::new();

    for window in windows {
        if !window.is_valid() {
            continue;
        }

        let title = window.title().unwrap_or_default().trim().to_string();
        if title.is_empty() {
            continue;
        }

        let hwnd = window.as_raw_hwnd() as usize;
        let app_name = window
            .process_name()
            .ok()
            .filter(|name| !name.trim().is_empty());
        let process_id = window.process_id().ok();
        let (width, height) = safe_window_dimensions(window);

        sources.push(NativeCaptureSource {
            id: format!("window:{hwnd}"),
            kind: NativeCaptureSourceKind::Window,
            title: title.clone(),
            app_name: app_name.clone(),
            width,
            height,
        });

        if let Some(pid) = process_id {
            applications
                .entry(pid)
                .or_insert_with(|| NativeCaptureSource {
                    id: format!("application:{pid}"),
                    kind: NativeCaptureSourceKind::Application,
                    title: app_name
                        .clone()
                        .unwrap_or_else(|| format!("Application {pid}")),
                    app_name: app_name.clone(),
                    width: None,
                    height: None,
                });
        }
    }

    sources.extend(applications.into_values());
    Ok(sources)
}

#[cfg(target_os = "windows")]
fn resolve_capture_item(source_id: &str) -> Result<SelectedCaptureItem, String> {
    if let Some(device_name) = source_id.strip_prefix("screen:") {
        let monitors = Monitor::enumerate()
            .map_err(|error| format!("Failed to enumerate displays: {error}"))?;
        let monitor = monitors
            .into_iter()
            .find(|monitor| monitor.device_name().ok().as_deref() == Some(device_name))
            .ok_or_else(|| {
                "Selected capture source is no longer available. Refresh and try again.".to_string()
            })?;
        return Ok(SelectedCaptureItem::Screen(monitor));
    }

    if let Some(raw_hwnd) = source_id.strip_prefix("window:") {
        let hwnd = raw_hwnd
            .parse::<usize>()
            .map_err(|_| "Invalid window source id. Refresh sources and try again.".to_string())?;
        let window = WinWindow::from_raw_hwnd(hwnd as *mut c_void);
        if !window.is_valid() {
            return Err(
                "Selected capture source is no longer available. Refresh and try again."
                    .to_string(),
            );
        }
        return Ok(SelectedCaptureItem::Window(window));
    }

    if let Some(raw_pid) = source_id.strip_prefix("application:") {
        let process_id = raw_pid.parse::<u32>().map_err(|_| {
            "Invalid application source id. Refresh sources and try again.".to_string()
        })?;
        let windows = WinWindow::enumerate()
            .map_err(|error| format!("Failed to enumerate windows: {error}"))?;
        let window = windows
            .into_iter()
            .find(|window| window.is_valid() && window.process_id().ok() == Some(process_id))
            .ok_or_else(|| {
                "Selected capture source is no longer available. Refresh and try again.".to_string()
            })?;
        return Ok(SelectedCaptureItem::Window(window));
    }

    Err("Unsupported native capture source id. Refresh sources and try again.".to_string())
}

#[cfg(target_os = "windows")]
fn start_capture_control(
    source_id: &str,
    capture_item: SelectedCaptureItem,
) -> Result<CaptureControl<NativeFrameHandler, String>, String> {
    let flags = NativeFrameHandlerFlags {
        source_id: source_id.to_string(),
    };

    let result = match capture_item {
        SelectedCaptureItem::Screen(monitor) => {
            let settings = Settings::new(
                monitor,
                CursorCaptureSettings::Default,
                DrawBorderSettings::Default,
                SecondaryWindowSettings::Default,
                MinimumUpdateIntervalSettings::Default,
                DirtyRegionSettings::Default,
                ColorFormat::Bgra8,
                flags.clone(),
            );
            NativeFrameHandler::start_free_threaded(settings)
        }
        SelectedCaptureItem::Window(window) => {
            let settings = Settings::new(
                window,
                CursorCaptureSettings::Default,
                DrawBorderSettings::Default,
                SecondaryWindowSettings::Default,
                MinimumUpdateIntervalSettings::Default,
                DirtyRegionSettings::Default,
                ColorFormat::Bgra8,
                flags,
            );
            NativeFrameHandler::start_free_threaded(settings)
        }
    };

    result.map_err(|error| format!("Failed to start Windows native capture: {error}"))
}

#[cfg(target_os = "windows")]
fn stop_active_capture(active: ActiveCapture) -> Result<(), String> {
    let source_id = active.source_id.clone();
    match active.control.stop() {
        Ok(()) => {
            emit_event(NativeCaptureEvent {
                kind: NativeCaptureEventKind::Stopped,
                source_id: Some(source_id),
                detail: Some("Capture session stopped".to_string()),
            });
            Ok(())
        }
        Err(error) => {
            emit_event(NativeCaptureEvent {
                kind: NativeCaptureEventKind::Error,
                source_id: Some(source_id.clone()),
                detail: Some(format!("Failed to stop capture: {error}")),
            });
            Err(format!("Failed to stop active capture: {error}"))
        }
    }
}

#[cfg(target_os = "windows")]
pub fn list_sources(_window: &Window) -> Result<Vec<NativeCaptureSource>, String> {
    let mut sources = monitor_sources()?;
    sources.extend(window_and_application_sources()?);

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

    let previous = {
        let mut state = adapter_state()
            .lock()
            .map_err(|_| "Native capture adapter lock was poisoned".to_string())?;

        if let Some(active) = state.active.take() {
            if active.source_id == source_id {
                state.active = Some(active);

                emit_event(NativeCaptureEvent {
                    kind: NativeCaptureEventKind::Started,
                    source_id: Some(source_id.to_string()),
                    detail: Some("Capture already active for selected source".to_string()),
                });
                return Ok(());
            }

            Some(active)
        } else {
            None
        }
    };

    if let Some(active) = previous {
        stop_active_capture(active)?;
    }

    let _ = window;
    let capture_item = resolve_capture_item(source_id).map_err(|error| {
        emit_event(NativeCaptureEvent {
            kind: NativeCaptureEventKind::SourceLost,
            source_id: Some(source_id.to_string()),
            detail: Some(error.clone()),
        });
        error
    })?;

    let control = start_capture_control(source_id, capture_item).map_err(|error| {
        emit_event(NativeCaptureEvent {
            kind: NativeCaptureEventKind::Error,
            source_id: Some(source_id.to_string()),
            detail: Some(error.clone()),
        });
        error
    })?;

    {
        let mut state = adapter_state()
            .lock()
            .map_err(|_| "Native capture adapter lock was poisoned".to_string())?;

        state.active = Some(ActiveCapture {
            source_id: source_id.to_string(),
            control,
        });
    }

    emit_event(NativeCaptureEvent {
        kind: NativeCaptureEventKind::Started,
        source_id: Some(source_id.to_string()),
        detail: Some("Windows native capture session started".to_string()),
    });

    Ok(())
}

#[cfg(target_os = "windows")]
pub fn stop_capture() -> Result<(), String> {
    let active = {
        let mut state = adapter_state()
            .lock()
            .map_err(|_| "Native capture adapter lock was poisoned".to_string())?;
        state.active.take()
    };

    if let Some(active) = active {
        stop_active_capture(active)?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
pub fn is_capture_active_for(source_id: &str) -> Result<bool, String> {
    let state = adapter_state()
        .lock()
        .map_err(|_| "Native capture adapter lock was poisoned".to_string())?;

    Ok(state
        .active
        .as_ref()
        .map(|active| active.source_id == source_id)
        .unwrap_or(false))
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

#[cfg(not(target_os = "windows"))]
pub fn is_capture_active_for(_source_id: &str) -> Result<bool, String> {
    Ok(false)
}
