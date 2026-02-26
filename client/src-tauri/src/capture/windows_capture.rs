use serde::Serialize;
#[cfg(target_os = "windows")]
use std::collections::HashMap;
#[cfg(target_os = "windows")]
use std::ffi::c_void;
#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(target_os = "windows")]
use std::sync::mpsc::TrySendError;
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
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

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct NativeCaptureStartRequest {
    pub source_id: String,
}

use super::gpu_frame::GpuTextureHandle;

/// Frame payload: either CPU bytes or a GPU-resident texture.
#[allow(dead_code)]
pub enum NativeFrameData {
    CpuBgra(Vec<u8>),
    GpuTexture(GpuTextureHandle),
}

impl std::fmt::Debug for NativeFrameData {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CpuBgra(data) => f.debug_tuple("CpuBgra").field(&data.len()).finish(),
            Self::GpuTexture(_) => f.debug_tuple("GpuTexture").finish(),
        }
    }
}

pub struct NativeFramePacket {
    pub source_id: String,
    pub width: u32,
    pub height: u32,
    pub timestamp_ms: u64,
    pub pixel_format: String,
    pub bgra_len: Option<usize>,
    pub frame_data: Option<NativeFrameData>,
}

impl std::fmt::Debug for NativeFramePacket {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NativeFramePacket")
            .field("source_id", &self.source_id)
            .field("width", &self.width)
            .field("height", &self.height)
            .field("timestamp_ms", &self.timestamp_ms)
            .field("frame_data", &self.frame_data)
            .finish()
    }
}

impl NativeFramePacket {
    /// Get the CPU BGRA bytes, performing GPU readback if needed.
    #[allow(dead_code)]
    pub fn as_cpu_bgra(&self) -> Option<&[u8]> {
        match &self.frame_data {
            Some(NativeFrameData::CpuBgra(data)) => Some(data),
            _ => None,
        }
    }

    /// Get a reference to the GPU texture handle, if this frame is GPU-resident.
    #[allow(dead_code)]
    pub fn gpu_texture(&self) -> Option<&GpuTextureHandle> {
        match &self.frame_data {
            Some(NativeFrameData::GpuTexture(handle)) => Some(handle),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeFrameDispatchStats {
    pub queued_frames: u64,
    pub dropped_full: u64,
    pub dropped_disconnected: u64,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Default)]
struct NativeFrameDispatchStatsAtomic {
    queued_frames: AtomicU64,
    dropped_full: AtomicU64,
    dropped_disconnected: AtomicU64,
}

#[cfg(target_os = "windows")]
fn frame_dispatch_stats() -> &'static NativeFrameDispatchStatsAtomic {
    static STATS: OnceLock<NativeFrameDispatchStatsAtomic> = OnceLock::new();
    STATS.get_or_init(NativeFrameDispatchStatsAtomic::default)
}

#[cfg(target_os = "windows")]
fn frame_sink() -> &'static Mutex<Option<SyncSender<NativeFramePacket>>> {
    static SINK: OnceLock<Mutex<Option<SyncSender<NativeFramePacket>>>> = OnceLock::new();
    SINK.get_or_init(|| Mutex::new(None))
}

#[cfg(target_os = "windows")]
use super::unix_timestamp_ms;

#[cfg(target_os = "windows")]
fn dispatch_frame(packet: NativeFramePacket) {
    let sender = {
        let Ok(sink) = frame_sink().lock() else {
            return;
        };
        sink.as_ref().cloned()
    };

    let Some(sender) = sender else {
        return;
    };

    let stats = frame_dispatch_stats();
    match sender.try_send(packet) {
        Ok(()) => {
            stats.queued_frames.fetch_add(1, Ordering::Relaxed);
        }
        Err(TrySendError::Full(_)) => {
            stats.dropped_full.fetch_add(1, Ordering::Relaxed);
        }
        Err(TrySendError::Disconnected(_)) => {
            stats.dropped_disconnected.fetch_add(1, Ordering::Relaxed);
        }
    }
}

/// Dispatch a frame from an external capture source (e.g. DXGI DD)
/// into the shared frame channel.
#[cfg(target_os = "windows")]
pub fn dispatch_frame_external(packet: NativeFramePacket) {
    dispatch_frame(packet);
}

#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
pub fn dispatch_frame_external(_packet: NativeFramePacket) {}

#[cfg(target_os = "windows")]
pub fn install_frame_sink(sender: SyncSender<NativeFramePacket>) -> Result<(), String> {
    let mut sink = frame_sink()
        .lock()
        .map_err(|_| "Native capture frame sink lock was poisoned".to_string())?;
    *sink = Some(sender);
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn clear_frame_sink() -> Result<(), String> {
    let mut sink = frame_sink()
        .lock()
        .map_err(|_| "Native capture frame sink lock was poisoned".to_string())?;
    *sink = None;
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn reset_frame_dispatch_stats() {
    let stats = frame_dispatch_stats();
    stats.queued_frames.store(0, Ordering::Relaxed);
    stats.dropped_full.store(0, Ordering::Relaxed);
    stats.dropped_disconnected.store(0, Ordering::Relaxed);
}

#[cfg(target_os = "windows")]
pub fn read_frame_dispatch_stats() -> NativeFrameDispatchStats {
    let stats = frame_dispatch_stats();
    NativeFrameDispatchStats {
        queued_frames: stats.queued_frames.load(Ordering::Relaxed),
        dropped_full: stats.dropped_full.load(Ordering::Relaxed),
        dropped_disconnected: stats.dropped_disconnected.load(Ordering::Relaxed),
    }
}

#[cfg(not(target_os = "windows"))]
pub fn install_frame_sink(_sender: SyncSender<NativeFramePacket>) -> Result<(), String> {
    Err("Native capture frame sink is supported on Windows only.".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn clear_frame_sink() -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn reset_frame_dispatch_stats() {}

#[cfg(not(target_os = "windows"))]
pub fn read_frame_dispatch_stats() -> NativeFrameDispatchStats {
    NativeFrameDispatchStats {
        queued_frames: 0,
        dropped_full: 0,
        dropped_disconnected: 0,
    }
}

pub fn create_frame_channel(
    capacity: usize,
) -> (SyncSender<NativeFramePacket>, Receiver<NativeFramePacket>) {
    sync_channel(capacity)
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
struct ActiveCapture {
    source_id: String,
    control: CaptureControl<NativeFrameHandler, String>,
}

#[cfg(target_os = "windows")]
impl std::fmt::Debug for ActiveCapture {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ActiveCapture")
            .field("source_id", &self.source_id)
            .finish()
    }
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

        let (frame_data, bgra_len) = match frame.buffer() {
            Ok(mut buffer) => match buffer.as_nopadding_buffer() {
                Ok(bytes) => {
                    let copied = bytes.to_vec();
                    let len = copied.len();
                    (Some(NativeFrameData::CpuBgra(copied)), Some(len))
                }
                Err(error) => {
                    emit_event(NativeCaptureEvent {
                        kind: NativeCaptureEventKind::Error,
                        source_id: Some(self.source_id.clone()),
                        detail: Some(format!(
                            "Failed to map native frame buffer without padding: {error}"
                        )),
                    });
                    (None, None)
                }
            },
            Err(error) => {
                emit_event(NativeCaptureEvent {
                    kind: NativeCaptureEventKind::Error,
                    source_id: Some(self.source_id.clone()),
                    detail: Some(format!("Failed to map native frame buffer: {error}")),
                });
                (None, None)
            }
        };

        dispatch_frame(NativeFramePacket {
            source_id: self.source_id.clone(),
            width: frame.width(),
            height: frame.height(),
            timestamp_ms: unix_timestamp_ms(),
            pixel_format: "bgra8".to_string(),
            bgra_len,
            frame_data,
        });

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
#[derive(Debug, Clone)]
struct ApplicationCandidate {
    process_id: u32,
    hwnd: usize,
    window_title: String,
    app_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    area: u64,
    is_foreground: bool,
}

#[cfg(target_os = "windows")]
impl ApplicationCandidate {
    fn from_window(
        process_id: u32,
        hwnd: usize,
        window_title: String,
        app_name: Option<String>,
        width: Option<u32>,
        height: Option<u32>,
        foreground_hwnd: Option<usize>,
    ) -> Self {
        let area = match (width, height) {
            (Some(w), Some(h)) => u64::from(w) * u64::from(h),
            _ => 0,
        };

        Self {
            process_id,
            hwnd,
            window_title,
            app_name,
            width,
            height,
            area,
            is_foreground: foreground_hwnd == Some(hwnd),
        }
    }

    fn is_better_than(&self, other: &Self) -> bool {
        if self.is_foreground != other.is_foreground {
            return self.is_foreground;
        }

        if self.area != other.area {
            return self.area > other.area;
        }

        self.window_title.len() > other.window_title.len()
    }
}

#[cfg(target_os = "windows")]
fn parse_application_source_id(raw: &str) -> Result<(u32, Option<usize>), String> {
    let mut parts = raw.split(':');
    let process_id = parts
        .next()
        .ok_or_else(|| "Invalid application source id. Refresh sources and try again.".to_string())?
        .parse::<u32>()
        .map_err(|_| "Invalid application source id. Refresh sources and try again.".to_string())?;

    let preferred_hwnd = match parts.next() {
        Some(value) if !value.trim().is_empty() => Some(value.parse::<usize>().map_err(|_| {
            "Invalid application source id. Refresh sources and try again.".to_string()
        })?),
        Some(_) => {
            return Err(
                "Invalid application source id. Refresh sources and try again.".to_string(),
            );
        }
        None => None,
    };

    if parts.next().is_some() {
        return Err("Invalid application source id. Refresh sources and try again.".to_string());
    }

    Ok((process_id, preferred_hwnd))
}

#[cfg(target_os = "windows")]
fn resolve_application_window(process_id: u32, preferred_hwnd: Option<usize>) -> Option<WinWindow> {
    if let Some(hwnd) = preferred_hwnd {
        let window = WinWindow::from_raw_hwnd(hwnd as *mut c_void);
        if window.is_valid() && window.process_id().ok() == Some(process_id) {
            return Some(window);
        }
        return None;
    }

    let windows = WinWindow::enumerate().ok()?;
    let foreground_hwnd = WinWindow::foreground()
        .ok()
        .map(|window| window.as_raw_hwnd() as usize);
    let mut best: Option<(u64, usize, WinWindow)> = None;

    for window in windows {
        if !window.is_valid() || window.process_id().ok() != Some(process_id) {
            continue;
        }

        let title = window.title().unwrap_or_default().trim().to_string();
        if title.is_empty() {
            continue;
        }

        let hwnd = window.as_raw_hwnd() as usize;
        let (width, height) = safe_window_dimensions(window);
        let area = match (width, height) {
            (Some(w), Some(h)) => u64::from(w) * u64::from(h),
            _ => 0,
        };
        let score = ((foreground_hwnd == Some(hwnd)) as u64) << 63 | area;

        match &best {
            Some((best_score, _, _)) if *best_score >= score => {}
            _ => {
                best = Some((score, hwnd, window));
            }
        }
    }

    best.map(|(_, _, window)| window)
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
    let foreground_hwnd = WinWindow::foreground()
        .ok()
        .map(|window| window.as_raw_hwnd() as usize);

    let mut sources = Vec::new();
    let mut applications: HashMap<u32, ApplicationCandidate> = HashMap::new();

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
            let candidate = ApplicationCandidate::from_window(
                pid,
                hwnd,
                title.clone(),
                app_name.clone(),
                width,
                height,
                foreground_hwnd,
            );

            match applications.get(&pid) {
                Some(existing) if !candidate.is_better_than(existing) => {}
                _ => {
                    applications.insert(pid, candidate);
                }
            }
        }
    }

    sources.extend(applications.into_values().map(|candidate| {
        let app_label = candidate
            .app_name
            .clone()
            .unwrap_or_else(|| format!("Application {}", candidate.process_id));

        NativeCaptureSource {
            id: format!("application:{}:{}", candidate.process_id, candidate.hwnd),
            kind: NativeCaptureSourceKind::Application,
            title: format!("{} ({})", app_label, candidate.window_title),
            app_name: Some(app_label),
            width: candidate.width,
            height: candidate.height,
        }
    }));
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

    if let Some(raw_application) = source_id.strip_prefix("application:") {
        let (process_id, preferred_hwnd) = parse_application_source_id(raw_application)?;
        let window = resolve_application_window(process_id, preferred_hwnd).ok_or_else(|| {
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
#[allow(dead_code)]
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
#[allow(dead_code)]
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
