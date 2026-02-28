//! Windows Graphics Capture frame acquisition loop.
//!
//! Uses the `windows-capture` crate to capture frames from a monitor or window
//! and delivers BGRA pixel buffers to a `ring_channel` sender.

use ring_channel::RingSender;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use windows_capture::{
    capture::GraphicsCaptureApiHandler,
    frame::Frame,
    graphics_capture_api::InternalCaptureControl,
    monitor::Monitor,
    settings::{ColorFormat, CursorCaptureSettings, DrawBorderSettings, Settings},
    window::Window,
};

use super::metrics::SharedMetrics;
use super::CaptureSource;

/// BGRA frame buffer delivered from the capture loop.
pub struct CaptureFrame {
    pub width: u32,
    pub height: u32,
    /// Raw BGRA8 pixels (width * height * 4 bytes).
    pub data: Vec<u8>,
    pub timestamp_ms: u64,
}

// ── Capture handler ────────────────────────────────────────────────────────────

struct CaptureHandler {
    frame_tx: RingSender<CaptureFrame>,
    stop_flag: Arc<AtomicBool>,
    metrics: SharedMetrics,
    start_ms: std::time::Instant,
}

impl GraphicsCaptureApiHandler for CaptureHandler {
    type Flags = ();
    type Error = Box<dyn std::error::Error + Send + Sync>;

    fn new(_: Self::Flags) -> Result<Self, Self::Error> {
        unreachable!("use CaptureHandler::with_channel instead");
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if self.stop_flag.load(Ordering::Relaxed) {
            control.stop();
            return Ok(());
        }

        self.metrics.frames_captured.fetch_add(1, Ordering::Relaxed);

        let width = frame.width();
        let height = frame.height();

        // Get BGRA pixel buffer.
        let mut buffer = frame
            .buffer()
            .map_err(|e| format!("Failed to get frame buffer: {e}"))?;

        let data = buffer
            .as_raw_nopadding_buffer()
            .map_err(|e| format!("Failed to get raw buffer: {e}"))?
            .to_vec();

        let timestamp_ms = self.start_ms.elapsed().as_millis() as u64;

        let capture_frame = CaptureFrame {
            width,
            height,
            data,
            timestamp_ms,
        };

        // ring_channel overwrites if the receiver hasn't consumed yet — intentional.
        let _ = self.frame_tx.send(capture_frame);

        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        Ok(())
    }
}

// The handler is created via internal factory. We work around the `new()` constraint
// by using a thread-local to pass construction parameters.

thread_local! {
    static HANDLER_PARAMS: std::cell::RefCell<Option<HandlerParams>> = std::cell::RefCell::new(None);
}

struct HandlerParams {
    frame_tx: RingSender<CaptureFrame>,
    stop_flag: Arc<AtomicBool>,
    metrics: SharedMetrics,
}

// We need a separate handler type that reads from thread-local.
struct CapturingHandler {
    inner: CaptureHandler,
}

impl GraphicsCaptureApiHandler for CapturingHandler {
    type Flags = ();
    type Error = Box<dyn std::error::Error + Send + Sync>;

    fn new(_: Self::Flags) -> Result<Self, Self::Error> {
        let params = HANDLER_PARAMS
            .with(|p| p.borrow_mut().take())
            .ok_or("No capture handler parameters set")?;
        Ok(Self {
            inner: CaptureHandler {
                frame_tx: params.frame_tx,
                stop_flag: params.stop_flag,
                metrics: params.metrics,
                start_ms: std::time::Instant::now(),
            },
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        self.inner.on_frame_arrived(frame, control)
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        self.inner.on_closed()
    }
}

/// Start the capture loop. Blocks until `stop_flag` is set or the source is lost.
pub fn start_capture_loop(
    source: CaptureSource,
    frame_tx: RingSender<CaptureFrame>,
    stop_flag: Arc<AtomicBool>,
    metrics: SharedMetrics,
) -> Result<(), String> {
    HANDLER_PARAMS.with(|p| {
        *p.borrow_mut() = Some(HandlerParams {
            frame_tx,
            stop_flag,
            metrics,
        });
    });

    let settings = match build_settings(&source) {
        Ok(s) => s,
        Err(e) => {
            return Err(format!("Failed to build capture settings: {e}"));
        }
    };

    if let Err(e) = CapturingHandler::start(settings) {
        return Err(format!("Capture loop error: {e}"));
    }

    Ok(())
}

fn build_settings(
    source: &CaptureSource,
) -> Result<
    Settings<impl windows_capture::capture::WindowsCaptureItem, ()>,
    Box<dyn std::error::Error + Send + Sync>,
> {
    let settings = match source {
        CaptureSource::Monitor { index, .. } => {
            let monitors = Monitor::enumerate()?;
            let monitor = monitors
                .into_iter()
                .nth(*index as usize)
                .ok_or_else(|| format!("Monitor index {} not found", index))?;
            Settings::new(
                monitor,
                CursorCaptureSettings::Default,
                DrawBorderSettings::Default,
                ColorFormat::Bgra8,
                (),
            )
        }
        CaptureSource::Window { id, title } => {
            let hwnd_value: isize = id.parse().map_err(|_| format!("Invalid window id: {id}"))?;
            let windows = Window::enumerate()?;
            let window = windows
                .into_iter()
                .find(|w| format!("{:?}", w.as_raw_hwnd()) == *id)
                .ok_or_else(|| format!("Window '{}' not found", title))?;
            Settings::new(
                window,
                CursorCaptureSettings::Default,
                DrawBorderSettings::Default,
                ColorFormat::Bgra8,
                (),
            )
        }
    };
    Ok(settings)
}
