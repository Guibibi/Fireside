use std::ffi::c_void;

use windows_capture::window::Window as WinWindow;

use super::session::{CropRect, DxgiOutputInfo, RectI32};

#[derive(Debug, Clone)]
pub(super) struct WindowCaptureRegion {
    pub(super) monitor_device_name: String,
    pub(super) crop_rect: CropRect,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum WindowRegionIssue {
    WindowUnavailable,
    MonitorUnavailable,
    CropUnavailable,
}

impl WindowRegionIssue {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::WindowUnavailable => "window_unavailable",
            Self::MonitorUnavailable => "monitor_unavailable",
            Self::CropUnavailable => "crop_unavailable",
        }
    }
}

#[derive(Debug, Clone)]
pub(super) enum DxgiCaptureTarget {
    Screen {
        monitor_device_name: String,
    },
    Window {
        hwnd: usize,
        process_id: Option<u32>,
    },
}

impl DxgiCaptureTarget {
    pub(super) fn from_source_id(source_id: &str) -> Result<Self, String> {
        if let Some(device_name) = source_id.strip_prefix("screen:") {
            let monitor_device_name = device_name.trim();
            if monitor_device_name.is_empty() {
                return Err("DXGI: monitor source id was empty".to_string());
            }
            return Ok(Self::Screen {
                monitor_device_name: monitor_device_name.to_string(),
            });
        }

        if let Some(raw_hwnd) = source_id.strip_prefix("window:") {
            let hwnd = raw_hwnd
                .trim()
                .parse::<usize>()
                .map_err(|_| "DXGI: invalid window source id".to_string())?;
            return Ok(Self::Window {
                hwnd,
                process_id: None,
            });
        }

        if let Some(raw_pid) = source_id.strip_prefix("application:") {
            let (process_id, preferred_hwnd) = parse_application_source_id(raw_pid)?;
            let hwnd = resolve_application_hwnd(process_id, preferred_hwnd)?;
            return Ok(Self::Window {
                hwnd,
                process_id: Some(process_id),
            });
        }

        Err("DXGI: unsupported source id (expected screen:, window:, or application:)".to_string())
    }

    pub(super) fn initial_monitor(
        &self,
        outputs: &[DxgiOutputInfo],
    ) -> Result<(String, Option<WindowCaptureRegion>), String> {
        match self {
            Self::Screen {
                monitor_device_name,
            } => Ok((monitor_device_name.clone(), None)),
            Self::Window { hwnd, .. } => {
                if let Ok(region) = resolve_window_capture_region(*hwnd, outputs) {
                    return Ok((region.monitor_device_name.clone(), Some(region)));
                }

                let first_monitor = outputs
                    .first()
                    .map(|output| output.device_name.clone())
                    .ok_or_else(|| "DXGI: no outputs available for window capture".to_string())?;
                Ok((first_monitor, None))
            }
        }
    }

    pub(super) fn resolve_window_region(
        &self,
        outputs: &[DxgiOutputInfo],
    ) -> Option<Result<WindowCaptureRegion, WindowRegionIssue>> {
        match self {
            Self::Screen { .. } => None,
            Self::Window { hwnd, .. } => Some(resolve_window_capture_region(*hwnd, outputs)),
        }
    }

    pub(super) fn monitor_label(&self) -> String {
        match self {
            Self::Screen {
                monitor_device_name,
            } => format!("screen:{monitor_device_name}"),
            Self::Window { hwnd, process_id } => {
                if let Some(pid) = process_id {
                    format!("application:{pid} hwnd:{hwnd}")
                } else {
                    format!("window:{hwnd}")
                }
            }
        }
    }
}

fn window_from_hwnd(hwnd: usize) -> WinWindow {
    WinWindow::from_raw_hwnd(hwnd as *mut c_void)
}

fn parse_application_source_id(raw: &str) -> Result<(u32, Option<usize>), String> {
    let mut parts = raw.split(':');
    let process_id = parts
        .next()
        .ok_or_else(|| "DXGI: invalid application source id".to_string())?
        .trim()
        .parse::<u32>()
        .map_err(|_| "DXGI: invalid application source id".to_string())?;

    let preferred_hwnd = match parts.next() {
        Some(value) if !value.trim().is_empty() => Some(
            value
                .trim()
                .parse::<usize>()
                .map_err(|_| "DXGI: invalid application source id".to_string())?,
        ),
        Some(_) => {
            return Err("DXGI: invalid application source id".to_string());
        }
        None => None,
    };

    if parts.next().is_some() {
        return Err("DXGI: invalid application source id".to_string());
    }

    Ok((process_id, preferred_hwnd))
}

fn resolve_application_hwnd(
    process_id: u32,
    preferred_hwnd: Option<usize>,
) -> Result<usize, String> {
    if let Some(hwnd) = preferred_hwnd {
        let window = window_from_hwnd(hwnd);
        if window.is_valid() && window.process_id().ok() == Some(process_id) {
            return Ok(hwnd);
        }
        return Err("DXGI: selected application window is no longer available".to_string());
    }

    let windows = WinWindow::enumerate()
        .map_err(|error| format!("DXGI: failed to enumerate windows: {error}"))?;

    let foreground_hwnd = WinWindow::foreground()
        .ok()
        .map(|window| window.as_raw_hwnd() as usize);
    let mut best: Option<(u64, usize)> = None;

    for window in windows {
        if !window.is_valid() {
            continue;
        }

        if window.process_id().ok() != Some(process_id) {
            continue;
        }

        let title = window.title().unwrap_or_default();
        if title.trim().is_empty() {
            continue;
        }

        let hwnd = window.as_raw_hwnd() as usize;
        let area = window
            .rect()
            .ok()
            .and_then(|rect| {
                let width = u32::try_from(rect.right.saturating_sub(rect.left)).ok()?;
                let height = u32::try_from(rect.bottom.saturating_sub(rect.top)).ok()?;
                Some(u64::from(width) * u64::from(height))
            })
            .unwrap_or(0);
        let score = ((foreground_hwnd == Some(hwnd)) as u64) << 63 | area;

        match &best {
            Some((best_score, _)) if *best_score >= score => {}
            _ => {
                best = Some((score, hwnd));
            }
        }
    }

    best.map(|(_, hwnd)| hwnd)
        .ok_or_else(|| "DXGI: application source has no capturable window".to_string())
}

fn crop_rect_for_window_on_output(window_rect: RectI32, output_rect: RectI32) -> Option<CropRect> {
    let left = window_rect.left.max(output_rect.left);
    let top = window_rect.top.max(output_rect.top);
    let right = window_rect.right.min(output_rect.right);
    let bottom = window_rect.bottom.min(output_rect.bottom);

    if right <= left || bottom <= top {
        return None;
    }

    let local_left = (left - output_rect.left).max(0) as u32;
    let local_top = (top - output_rect.top).max(0) as u32;
    let mut local_right = (right - output_rect.left).max(0) as u32;
    let mut local_bottom = (bottom - output_rect.top).max(0) as u32;

    if (local_right - local_left) % 2 != 0 {
        local_right = local_right.saturating_sub(1);
    }
    if (local_bottom - local_top) % 2 != 0 {
        local_bottom = local_bottom.saturating_sub(1);
    }

    if local_right <= local_left || local_bottom <= local_top {
        return None;
    }

    if local_right - local_left < 2 || local_bottom - local_top < 2 {
        return None;
    }

    Some(CropRect {
        left: local_left,
        top: local_top,
        right: local_right,
        bottom: local_bottom,
    })
}

fn resolve_window_capture_region(
    hwnd: usize,
    outputs: &[DxgiOutputInfo],
) -> Result<WindowCaptureRegion, WindowRegionIssue> {
    let window = window_from_hwnd(hwnd);
    if !window.is_valid() {
        return Err(WindowRegionIssue::WindowUnavailable);
    }

    let monitor = window
        .monitor()
        .ok_or(WindowRegionIssue::MonitorUnavailable)?;
    let monitor_device_name = monitor
        .device_name()
        .map_err(|_| WindowRegionIssue::MonitorUnavailable)?;
    let output = outputs
        .iter()
        .find(|candidate| candidate.device_name == monitor_device_name)
        .ok_or(WindowRegionIssue::MonitorUnavailable)?;

    let rect = window
        .rect()
        .map_err(|_| WindowRegionIssue::WindowUnavailable)?;
    let window_rect = RectI32 {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
    };

    let crop_rect = crop_rect_for_window_on_output(window_rect, output.desktop_rect)
        .ok_or(WindowRegionIssue::CropUnavailable)?;

    Ok(WindowCaptureRegion {
        monitor_device_name,
        crop_rect,
    })
}
