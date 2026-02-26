use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::session::{enumerate_dxgi_outputs, DxgiCaptureSession};
use super::target::{DxgiCaptureTarget, WindowRegionIssue};
use crate::capture::unix_timestamp_ms;
use crate::capture::windows_capture::{
    NativeCaptureSource, NativeCaptureSourceKind, NativeFrameData, NativeFramePacket,
};

pub fn run_dxgi_capture_loop(
    source_id: &str,
    stop_signal: Arc<AtomicBool>,
    target_fps: Option<u32>,
    dispatch_fn: impl Fn(NativeFramePacket),
) {
    let capture_target = match DxgiCaptureTarget::from_source_id(source_id) {
        Ok(target) => target,
        Err(e) => {
            eprintln!("[dxgi-capture] event=init_failed source={source_id} detail=\"{e}\"");
            return;
        }
    };

    let mut outputs = match enumerate_dxgi_outputs() {
        Ok(value) if !value.is_empty() => value,
        Ok(_) => {
            eprintln!(
                "[dxgi-capture] event=init_failed source={source_id} detail=\"no outputs available\""
            );
            return;
        }
        Err(e) => {
            eprintln!("[dxgi-capture] event=init_failed source={source_id} detail=\"{e}\"");
            return;
        }
    };

    let (mut active_monitor_device_name, mut seeded_window_region) =
        match capture_target.initial_monitor(&outputs) {
            Ok(value) => value,
            Err(e) => {
                eprintln!("[dxgi-capture] event=init_failed source={source_id} detail=\"{e}\"");
                return;
            }
        };

    let mut session = match DxgiCaptureSession::new(&active_monitor_device_name) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[dxgi-capture] event=init_failed source={source_id} detail=\"{e}\"");
            return;
        }
    };

    eprintln!(
        "[dxgi-capture] event=started source={source_id} target={} monitor={} size={}x{}",
        capture_target.monitor_label(),
        active_monitor_device_name,
        session.width(),
        session.height(),
    );

    let mut frame_count: u64 = 0;
    let start = Instant::now();
    let mut last_report = start;
    let mut reported_frames: u64 = 0;
    let fps = target_fps.unwrap_or(60).max(1);
    let min_frame_interval = Duration::from_micros(1_000_000 / fps as u64);
    let mut last_frame_at = Instant::now();
    let mut last_window_issue: Option<WindowRegionIssue> = None;

    while !stop_signal.load(Ordering::Relaxed) {
        let elapsed_since_last = last_frame_at.elapsed();
        if elapsed_since_last < min_frame_interval {
            std::thread::sleep(min_frame_interval - elapsed_since_last);
        }

        let window_region = if let Some(window_region_result) =
            capture_target.resolve_window_region(&outputs)
        {
            let mut resolved = window_region_result;
            if matches!(resolved, Err(WindowRegionIssue::MonitorUnavailable)) {
                if let Ok(refreshed_outputs) = enumerate_dxgi_outputs() {
                    if !refreshed_outputs.is_empty() {
                        outputs = refreshed_outputs;
                    }
                }
                resolved = capture_target
                    .resolve_window_region(&outputs)
                    .unwrap_or(Err(WindowRegionIssue::MonitorUnavailable));
            }

            match resolved {
                Ok(region) => {
                    if let Some(previous_issue) = last_window_issue.take() {
                        eprintln!(
                            "[dxgi-capture] event=target_recovered source={source_id} previous_issue={}",
                            previous_issue.as_str(),
                        );
                    }

                    if region.monitor_device_name != active_monitor_device_name {
                        match DxgiCaptureSession::new(&region.monitor_device_name) {
                            Ok(new_session) => {
                                active_monitor_device_name = region.monitor_device_name.clone();
                                session = new_session;
                                eprintln!(
                                    "[dxgi-capture] event=target_monitor_changed source={source_id} monitor={}",
                                    active_monitor_device_name,
                                );
                            }
                            Err(e) => {
                                eprintln!(
                                    "[dxgi-capture] event=monitor_switch_failed source={source_id} monitor={} detail=\"{}\"",
                                    region.monitor_device_name, e,
                                );
                                std::thread::sleep(Duration::from_millis(100));
                                continue;
                            }
                        }
                    }

                    Some(region)
                }
                Err(issue) => {
                    if last_window_issue != Some(issue) {
                        eprintln!(
                            "[dxgi-capture] event=target_unavailable source={source_id} issue={}",
                            issue.as_str(),
                        );
                        last_window_issue = Some(issue);
                    }
                    seeded_window_region = None;
                    continue;
                }
            }
        } else {
            None
        };

        let window_region = window_region.or_else(|| seeded_window_region.take());

        match session.acquire_frame(100) {
            Ok(Some(handle)) => {
                last_frame_at = Instant::now();

                let output_handle = if let Some(region) = window_region {
                    match session.crop_frame(&handle, region.crop_rect) {
                        Ok(cropped) => cropped,
                        Err(e) => {
                            eprintln!(
                                "[dxgi-capture] event=crop_error source={source_id} detail=\"{e}\""
                            );
                            continue;
                        }
                    }
                } else {
                    handle
                };

                frame_count += 1;
                let width = output_handle.width;
                let height = output_handle.height;

                dispatch_fn(NativeFramePacket {
                    source_id: source_id.to_string(),
                    width,
                    height,
                    timestamp_ms: unix_timestamp_ms(),
                    pixel_format: "bgra8".to_string(),
                    bgra_len: Some((width as usize) * (height as usize) * 4),
                    frame_data: Some(NativeFrameData::GpuTexture(output_handle)),
                });

                let now = Instant::now();
                if now.duration_since(last_report) >= Duration::from_secs(1) {
                    let delta = frame_count - reported_frames;
                    let elapsed = now.duration_since(last_report).as_secs_f64();
                    let fps = if elapsed > 0.0 {
                        delta as f64 / elapsed
                    } else {
                        0.0
                    };
                    eprintln!(
                        "[dxgi-capture] event=stats source={source_id} fps={fps:.1} frames={frame_count} uptime_ms={}",
                        start.elapsed().as_millis(),
                    );
                    last_report = now;
                    reported_frames = frame_count;
                }
            }
            Ok(None) => {}
            Err(e) if e.contains("ACCESS_LOST") => {
                eprintln!(
                    "[dxgi-capture] event=access_lost source={source_id} monitor={} — recreating session",
                    active_monitor_device_name,
                );

                const MAX_RETRIES: u32 = 5;
                const INITIAL_DELAY_MS: u64 = 100;
                let mut retry_count = 0u32;
                let mut recreated = false;
                while retry_count < MAX_RETRIES && !stop_signal.load(Ordering::Relaxed) {
                    let delay_ms = INITIAL_DELAY_MS * (1u64 << retry_count.min(4));
                    std::thread::sleep(Duration::from_millis(delay_ms));
                    match DxgiCaptureSession::new(&active_monitor_device_name) {
                        Ok(new_session) => {
                            session = new_session;
                            recreated = true;
                            eprintln!(
                                "[dxgi-capture] event=session_recreated source={source_id} monitor={} retries={retry_count}",
                                active_monitor_device_name,
                            );
                            break;
                        }
                        Err(retry_error) => {
                            retry_count += 1;
                            if retry_count < MAX_RETRIES {
                                eprintln!(
                                    "[dxgi-capture] event=recreate_retry source={source_id} monitor={} attempt={retry_count} detail=\"{}\"",
                                    active_monitor_device_name, retry_error,
                                );
                            } else {
                                eprintln!(
                                    "[dxgi-capture] event=recreate_failed source={source_id} monitor={} attempts={MAX_RETRIES} detail=\"{}\"",
                                    active_monitor_device_name, retry_error,
                                );
                            }
                        }
                    }
                }

                if !recreated {
                    break;
                }
            }
            Err(e) => {
                eprintln!("[dxgi-capture] event=acquire_error source={source_id} detail=\"{e}\"");
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    }

    eprintln!("[dxgi-capture] event=stopped source={source_id} frames={frame_count}");
}

#[allow(dead_code)]
pub fn list_dxgi_monitors() -> Result<Vec<NativeCaptureSource>, String> {
    let mut sources = enumerate_dxgi_outputs()?
        .into_iter()
        .map(|output| {
            let width = output.width();
            let height = output.height();
            let device_name = output.device_name;

            NativeCaptureSource {
                id: format!("screen:{device_name}"),
                kind: NativeCaptureSourceKind::Screen,
                title: device_name,
                app_name: None,
                width: Some(width),
                height: Some(height),
            }
        })
        .collect::<Vec<_>>();

    sources.sort_by(|left, right| left.title.to_lowercase().cmp(&right.title.to_lowercase()));
    Ok(sources)
}
