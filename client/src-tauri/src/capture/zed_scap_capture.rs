#[cfg(target_os = "windows")]
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
#[cfg(target_os = "windows")]
use std::thread;
#[cfg(target_os = "windows")]
use std::time::Duration;

#[cfg(target_os = "windows")]
use zed_scap::{
    capturer::{Capturer, Options as CaptureOptions, Resolution as CaptureResolution},
    frame::Frame,
    Target,
};

#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

#[cfg(target_os = "windows")]
use super::unix_timestamp_ms;
use super::windows_capture::NativeCaptureSource;
#[cfg(target_os = "windows")]
use super::windows_capture::{self, NativeCaptureSourceKind, NativeFrameData, NativeFramePacket};

#[cfg(target_os = "windows")]
#[derive(Debug, Clone)]
struct ApplicationCandidate {
    process_id: u32,
    window_id: u32,
    title: String,
    is_foreground: bool,
}

#[cfg(target_os = "windows")]
impl ApplicationCandidate {
    fn is_better_than(&self, other: &Self) -> bool {
        if self.is_foreground != other.is_foreground {
            return self.is_foreground;
        }

        self.title.len() > other.title.len()
    }
}

#[cfg(target_os = "windows")]
fn current_foreground_window_id() -> Option<u32> {
    let hwnd = unsafe { GetForegroundWindow() };
    let raw = hwnd.0;
    if raw == 0 {
        return None;
    }

    u32::try_from(raw as usize).ok()
}

#[cfg(target_os = "windows")]
fn process_id_for_window(raw_handle: windows::Win32::Foundation::HWND) -> Option<u32> {
    let mut process_id = 0u32;
    unsafe {
        let _ = GetWindowThreadProcessId(raw_handle, Some(&mut process_id));
    }
    if process_id == 0 {
        None
    } else {
        Some(process_id)
    }
}

#[cfg(target_os = "windows")]
fn parse_application_source_id(raw: &str) -> Result<(u32, Option<u32>), String> {
    let mut parts = raw.split(':');
    let process_id = parts
        .next()
        .ok_or_else(|| "Invalid application source id. Refresh sources and try again.".to_string())?
        .parse::<u32>()
        .map_err(|_| "Invalid application source id. Refresh sources and try again.".to_string())?;

    let preferred_window_id = match parts.next() {
        Some(value) if !value.trim().is_empty() => {
            Some(value.trim().parse::<u32>().map_err(|_| {
                "Invalid application source id. Refresh sources and try again.".to_string()
            })?)
        }
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

    Ok((process_id, preferred_window_id))
}

#[cfg(target_os = "windows")]
fn resolve_capture_target(source_id: &str) -> Result<Target, String> {
    let targets = zed_scap::get_all_targets()
        .map_err(|error| format!("Failed to enumerate capture targets: {error}"))?;

    if let Some(raw_screen_id) = source_id.strip_prefix("screen:") {
        let screen_id = raw_screen_id
            .trim()
            .parse::<u32>()
            .map_err(|_| "Invalid screen source id. Refresh sources and try again.".to_string())?;

        let target = targets
            .into_iter()
            .find(|target| match target {
                Target::Display(display) => display.id == screen_id,
                _ => false,
            })
            .ok_or_else(|| {
                "Selected capture source is no longer available. Refresh and try again.".to_string()
            })?;

        return Ok(target);
    }

    if let Some(raw_window_id) = source_id.strip_prefix("window:") {
        let window_id = raw_window_id
            .trim()
            .parse::<u32>()
            .map_err(|_| "Invalid window source id. Refresh sources and try again.".to_string())?;

        let target = targets
            .into_iter()
            .find(|target| match target {
                Target::Window(window) => window.id == window_id,
                _ => false,
            })
            .ok_or_else(|| {
                "Selected capture source is no longer available. Refresh and try again.".to_string()
            })?;

        return Ok(target);
    }

    if let Some(raw_application) = source_id.strip_prefix("application:") {
        let (process_id, preferred_window_id) = parse_application_source_id(raw_application)?;
        let foreground_window_id = current_foreground_window_id();

        let mut best_match: Option<(bool, Target)> = None;
        for target in targets {
            let Target::Window(window) = target else {
                continue;
            };

            let Some(window_process_id) = process_id_for_window(window.raw_handle) else {
                continue;
            };
            if window_process_id != process_id {
                continue;
            }

            let exact = preferred_window_id == Some(window.id);
            if exact {
                return Ok(Target::Window(window));
            }

            let is_foreground = foreground_window_id == Some(window.id);
            match &best_match {
                Some((existing_foreground, _)) if *existing_foreground && !is_foreground => {}
                _ => {
                    best_match = Some((is_foreground, Target::Window(window)));
                }
            }
        }

        if let Some((_, target)) = best_match {
            return Ok(target);
        }

        return Err(
            "Selected capture source is no longer available. Refresh and try again.".to_string(),
        );
    }

    Err("Unsupported native capture source id. Refresh sources and try again.".to_string())
}

#[cfg(target_os = "windows")]
pub fn list_sources() -> Result<Vec<NativeCaptureSource>, String> {
    let targets = zed_scap::get_all_targets()
        .map_err(|error| format!("Failed to enumerate capture targets: {error}"))?;
    if targets.is_empty() {
        return Err("No native capture sources are available.".to_string());
    }

    let foreground_window_id = current_foreground_window_id();
    let mut sources = Vec::new();
    let mut applications: HashMap<u32, ApplicationCandidate> = HashMap::new();

    for target in targets {
        match target {
            Target::Display(display) => {
                sources.push(NativeCaptureSource {
                    id: format!("screen:{}", display.id),
                    kind: NativeCaptureSourceKind::Screen,
                    title: display.title,
                    app_name: None,
                    width: Some(u32::from(display.width)),
                    height: Some(u32::from(display.height)),
                });
            }
            Target::Window(window) => {
                let title = window.title.trim().to_string();
                if title.is_empty() {
                    continue;
                }

                sources.push(NativeCaptureSource {
                    id: format!("window:{}", window.id),
                    kind: NativeCaptureSourceKind::Window,
                    title: title.clone(),
                    app_name: None,
                    width: None,
                    height: None,
                });

                let Some(process_id) = process_id_for_window(window.raw_handle) else {
                    continue;
                };

                let candidate = ApplicationCandidate {
                    process_id,
                    window_id: window.id,
                    title,
                    is_foreground: foreground_window_id == Some(window.id),
                };

                match applications.get(&process_id) {
                    Some(existing) if !candidate.is_better_than(existing) => {}
                    _ => {
                        applications.insert(process_id, candidate);
                    }
                }
            }
        }
    }

    for candidate in applications.into_values() {
        sources.push(NativeCaptureSource {
            id: format!(
                "application:{}:{}",
                candidate.process_id, candidate.window_id
            ),
            kind: NativeCaptureSourceKind::Application,
            title: format!("Application {} ({})", candidate.process_id, candidate.title),
            app_name: Some(format!("Application {}", candidate.process_id)),
            width: None,
            height: None,
        });
    }

    sources.sort_by(|left, right| left.title.to_lowercase().cmp(&right.title.to_lowercase()));
    Ok(sources)
}

#[cfg(target_os = "windows")]
fn normalize_frame_to_bgra(frame: Frame) -> Option<(u32, u32, Vec<u8>)> {
    match frame {
        Frame::BGRA(frame) => {
            let width = u32::try_from(frame.width).ok()?;
            let height = u32::try_from(frame.height).ok()?;
            Some((width, height, frame.data))
        }
        Frame::BGRx(frame) => {
            let width = u32::try_from(frame.width).ok()?;
            let height = u32::try_from(frame.height).ok()?;
            let mut data = frame.data;
            for chunk in data.chunks_exact_mut(4) {
                chunk[3] = 255;
            }
            Some((width, height, data))
        }
        Frame::RGBx(frame) => {
            let width = u32::try_from(frame.width).ok()?;
            let height = u32::try_from(frame.height).ok()?;
            let mut data = frame.data;
            for chunk in data.chunks_exact_mut(4) {
                let r = chunk[0];
                let g = chunk[1];
                let b = chunk[2];
                chunk[0] = b;
                chunk[1] = g;
                chunk[2] = r;
                chunk[3] = 255;
            }
            Some((width, height, data))
        }
        Frame::XBGR(frame) => {
            let width = u32::try_from(frame.width).ok()?;
            let height = u32::try_from(frame.height).ok()?;
            let mut out = Vec::with_capacity(frame.data.len());
            for chunk in frame.data.chunks_exact(4) {
                out.push(chunk[1]);
                out.push(chunk[2]);
                out.push(chunk[3]);
                out.push(255);
            }
            Some((width, height, out))
        }
        _ => None,
    }
}

#[cfg(target_os = "windows")]
pub fn run_capture_loop(source_id: &str, stop_signal: Arc<AtomicBool>, target_fps: Option<u32>) {
    let target = match resolve_capture_target(source_id) {
        Ok(target) => target,
        Err(error) => {
            eprintln!(
                "[native-capture] event=init_failed source={} detail=\"{}\"",
                source_id, error
            );
            return;
        }
    };

    let mut capturer = match Capturer::build(CaptureOptions {
        fps: target_fps.unwrap_or(30).max(1),
        show_cursor: true,
        show_highlight: false,
        target: Some(target),
        crop_area: None,
        output_type: zed_scap::frame::FrameType::BGRAFrame,
        output_resolution: CaptureResolution::Captured,
        excluded_targets: None,
    }) {
        Ok(capturer) => capturer,
        Err(error) => {
            eprintln!(
                "[native-capture] event=init_failed source={} detail=\"{}\"",
                source_id, error
            );
            return;
        }
    };

    capturer.start_capture();
    eprintln!("[native-capture] event=started source={}", source_id);

    while !stop_signal.load(std::sync::atomic::Ordering::Relaxed) {
        let frame = match capturer.get_next_frame() {
            Ok(frame) => frame,
            Err(error) => {
                eprintln!(
                    "[native-capture] event=frame_error source={} detail=\"{}\"",
                    source_id, error
                );
                thread::sleep(Duration::from_millis(20));
                continue;
            }
        };

        let Some((width, height, bgra)) = normalize_frame_to_bgra(frame) else {
            continue;
        };

        if width == 0 || height == 0 {
            continue;
        }

        let packet = NativeFramePacket {
            source_id: source_id.to_string(),
            width,
            height,
            timestamp_ms: unix_timestamp_ms(),
            pixel_format: "bgra8".to_string(),
            bgra_len: Some(bgra.len()),
            frame_data: Some(NativeFrameData::CpuBgra(bgra)),
        };
        windows_capture::dispatch_frame_external(packet);
    }

    capturer.stop_capture();
    eprintln!("[native-capture] event=stopped source={}", source_id);
}

#[cfg(not(target_os = "windows"))]
pub fn list_sources() -> Result<Vec<NativeCaptureSource>, String> {
    Err(
        "Native capture is currently supported on Windows only. Falling back to browser-based sharing."
            .to_string(),
    )
}

#[cfg(not(target_os = "windows"))]
pub fn run_capture_loop(_source_id: &str, _stop_signal: Arc<AtomicBool>, _target_fps: Option<u32>) {
}
