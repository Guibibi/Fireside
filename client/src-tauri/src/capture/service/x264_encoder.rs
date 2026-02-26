use super::encoder_backend::{split_annex_b_nals, CodecDescriptor, VideoEncoderBackend};
use super::metrics::NativeSenderSharedMetrics;

use std::io::{BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::Ordering;
use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::thread::{self, JoinHandle};
use std::time::Duration;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const DEFAULT_FFMPEG_BIN: &str = "ffmpeg";
const DEFAULT_TARGET_FPS: u32 = 30;
const DEFAULT_TARGET_BITRATE_KBPS: u32 = 8_000;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// x264 pipeline has no lookahead (zerolatency), so output appears immediately.
/// Allow a small window for transient empty frames.
const CONSECUTIVE_EMPTY_THRESHOLD: u64 = 5;

struct X264Process {
    child: Child,
    stdin: ChildStdin,
    stdout_rx: Receiver<Vec<u8>>,
    stdout_thread: JoinHandle<()>,
    pending_output: Vec<u8>,
    submitted_frames: u64,
    consecutive_empty_outputs: u64,
    target_fps: u32,
    width: u32,
    height: u32,
}

impl X264Process {
    fn drain_channel(&mut self) {
        loop {
            match self.stdout_rx.try_recv() {
                Ok(chunk) => self.pending_output.extend_from_slice(&chunk),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => break,
            }
        }
    }

    fn collect_available_output(&mut self) -> Result<Vec<u8>, String> {
        self.drain_channel();

        if self.pending_output.is_empty() {
            let wait_ms = 2 * 1000 / self.target_fps.max(1) as u64;
            match self.stdout_rx.recv_timeout(Duration::from_millis(wait_ms)) {
                Ok(chunk) => self.pending_output.extend_from_slice(&chunk),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {}
            }
            self.drain_channel();
        }

        Ok(std::mem::take(&mut self.pending_output))
    }

    fn shutdown(mut self) {
        let _ = self.stdin.flush();
        drop(self.stdin);
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = self.stdout_thread.join();
    }
}

pub struct X264EncoderBackend {
    ffmpeg_bin: String,
    target_fps: u32,
    target_bitrate_kbps: u32,
    process: Option<X264Process>,
}

impl X264EncoderBackend {
    fn new(target_fps: Option<u32>, target_bitrate_kbps: Option<u32>) -> Result<Self, String> {
        let ffmpeg_bin = resolve_ffmpeg_bin();
        ensure_x264_encoder_available(&ffmpeg_bin)?;

        Ok(Self {
            ffmpeg_bin,
            target_fps: target_fps.unwrap_or(DEFAULT_TARGET_FPS).max(1),
            target_bitrate_kbps: target_bitrate_kbps
                .unwrap_or(DEFAULT_TARGET_BITRATE_KBPS)
                .max(1_000),
            process: None,
        })
    }

    fn restart_process(&mut self) {
        if let Some(process) = self.process.take() {
            process.shutdown();
        }
    }

    fn ensure_process(&mut self, width: u32, height: u32) -> Result<&mut X264Process, String> {
        let need_restart = self
            .process
            .as_ref()
            .map(|p| p.width != width || p.height != height)
            .unwrap_or(false);

        if need_restart {
            self.restart_process();
        }

        if self.process.is_none() {
            self.process = Some(spawn_x264_process(
                &self.ffmpeg_bin,
                self.target_fps,
                self.target_bitrate_kbps,
                width,
                height,
            )?);
        }

        self.process
            .as_mut()
            .ok_or_else(|| "x264 process unavailable".to_string())
    }

    fn encode_once(
        &mut self,
        bgra: &[u8],
        width: u32,
        height: u32,
    ) -> Result<Vec<Vec<u8>>, String> {
        let frame_size = width as usize * height as usize * 4;
        if frame_size != bgra.len() {
            return Err("x264 input frame size mismatch".to_string());
        }

        let process = self.ensure_process(width, height)?;

        process
            .stdin
            .write_all(bgra)
            .map_err(|e| format!("failed to write frame to x264 stdin: {e}"))?;
        process
            .stdin
            .flush()
            .map_err(|e| format!("failed to flush x264 stdin: {e}"))?;

        process.submitted_frames = process.submitted_frames.saturating_add(1);
        let encoded = process.collect_available_output()?;
        let nals = split_annex_b_nals(&encoded);

        if nals.is_empty() {
            process.consecutive_empty_outputs = process.consecutive_empty_outputs.saturating_add(1);
            if process.consecutive_empty_outputs >= CONSECUTIVE_EMPTY_THRESHOLD {
                return Err(format!(
                    "ffmpeg x264 produced no NAL units ({} consecutive empties)",
                    process.consecutive_empty_outputs,
                ));
            }
            return Ok(Vec::new());
        }

        process.consecutive_empty_outputs = 0;
        Ok(nals)
    }
}

impl VideoEncoderBackend for X264EncoderBackend {
    fn codec_descriptor(&self) -> CodecDescriptor {
        CodecDescriptor {
            mime_type: "video/H264",
            clock_rate: 90_000,
            packetization_mode: Some(1),
            profile_level_id: Some("42e01f"),
        }
    }

    fn encode_frame(
        &mut self,
        bgra: &[u8],
        width: u32,
        height: u32,
        shared: &NativeSenderSharedMetrics,
    ) -> Option<Vec<Vec<u8>>> {
        if width == 0 || height == 0 || !width.is_multiple_of(2) || !height.is_multiple_of(2) {
            shared.encode_errors.fetch_add(1, Ordering::Relaxed);
            return None;
        }

        match self.encode_once(bgra, width, height) {
            Ok(nals) if nals.is_empty() => None,
            Ok(nals) => Some(nals),
            Err(error) => {
                shared.encode_errors.fetch_add(1, Ordering::Relaxed);
                eprintln!(
                    "[native-sender] event=encode_error backend=x264 detail=\"{}\"",
                    error
                );
                None
            }
        }
    }

    fn request_keyframe(&mut self) -> bool {
        false
    }
}

impl Drop for X264EncoderBackend {
    fn drop(&mut self) {
        self.restart_process();
    }
}

pub fn try_build_x264_backend(
    target_fps: Option<u32>,
    target_bitrate_kbps: Option<u32>,
) -> Result<Box<dyn VideoEncoderBackend>, String> {
    let backend = X264EncoderBackend::new(target_fps, target_bitrate_kbps)?;
    Ok(Box::new(backend))
}

fn ensure_x264_encoder_available(ffmpeg_bin: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let output = Command::new(ffmpeg_bin)
        .creation_flags(CREATE_NO_WINDOW)
        .arg("-hide_banner")
        .arg("-encoders")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("failed to execute ffmpeg encoder probe: {e}"))?;

    #[cfg(not(target_os = "windows"))]
    let output = Command::new(ffmpeg_bin)
        .arg("-hide_banner")
        .arg("-encoders")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("failed to execute ffmpeg encoder probe: {e}"))?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "ffmpeg encoder probe failed".to_string()
        } else {
            format!("ffmpeg encoder probe failed: {detail}")
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stdout.contains("libx264") {
        return Err(
            "ffmpeg is available but libx264 encoder is missing (ffmpeg build lacks --enable-libx264)"
                .to_string(),
        );
    }

    Ok(())
}

fn resolve_ffmpeg_bin() -> String {
    if let Some(configured) = std::env::var("YANKCORD_NATIVE_X264_FFMPEG_PATH")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
    {
        return configured;
    }

    for candidate in bundled_ffmpeg_candidates() {
        if candidate.is_file() {
            return candidate.to_string_lossy().to_string();
        }
    }

    DEFAULT_FFMPEG_BIN.to_string()
}

fn bundled_ffmpeg_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            #[cfg(target_os = "windows")]
            {
                candidates.push(exe_dir.join("ffmpeg.exe"));
                candidates.push(exe_dir.join("resources").join("ffmpeg.exe"));
                candidates.push(exe_dir.join("resources").join("bin").join("ffmpeg.exe"));
            }
            #[cfg(not(target_os = "windows"))]
            {
                candidates.push(exe_dir.join("ffmpeg"));
                candidates.push(exe_dir.join("resources").join("ffmpeg"));
            }
        }
    }

    #[cfg(target_os = "windows")]
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("bin")
            .join("ffmpeg.exe"),
    );

    candidates
}

fn spawn_x264_process(
    ffmpeg_bin: &str,
    target_fps: u32,
    target_bitrate_kbps: u32,
    width: u32,
    height: u32,
) -> Result<X264Process, String> {
    let mut command = Command::new(ffmpeg_bin);

    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    command
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-nostats")
        .arg("-f")
        .arg("rawvideo")
        .arg("-pix_fmt")
        .arg("bgra")
        .arg("-s:v")
        .arg(format!("{}x{}", width, height))
        .arg("-r")
        .arg(target_fps.to_string())
        .arg("-i")
        .arg("pipe:0")
        .arg("-an")
        .arg("-c:v")
        .arg("libx264")
        .arg("-profile:v")
        .arg("baseline")
        .arg("-level")
        .arg("3.1")
        .arg("-preset")
        .arg("ultrafast")
        .arg("-tune")
        .arg("zerolatency")
        .arg("-g")
        .arg(target_fps.to_string())
        .arg("-keyint_min")
        .arg(target_fps.to_string())
        .arg("-bf")
        .arg("0")
        .arg("-b:v")
        .arg(format!("{}k", target_bitrate_kbps))
        .arg("-maxrate")
        .arg(format!("{}k", target_bitrate_kbps))
        .arg("-bufsize")
        .arg(format!("{}k", target_bitrate_kbps.saturating_mul(2)))
        .arg("-flush_packets")
        .arg("1")
        .arg("-f")
        .arg("h264")
        .arg("pipe:1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to spawn ffmpeg for x264: {e}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "ffmpeg x264 stdin unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "ffmpeg x264 stdout unavailable".to_string())?;

    let (stdout_tx, stdout_rx) = mpsc::channel::<Vec<u8>>();
    let stdout_thread = thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut chunk = vec![0u8; 32 * 1024];
        loop {
            match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(count) => {
                    if stdout_tx.send(chunk[..count].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    Ok(X264Process {
        child,
        stdin,
        stdout_rx,
        stdout_thread,
        pending_output: Vec::new(),
        submitted_frames: 0,
        consecutive_empty_outputs: 0,
        target_fps,
        width,
        height,
    })
}
