use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::Ordering;
use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use super::encoder_backend::{CodecDescriptor, VideoEncoderBackend};
use super::metrics::NativeSenderSharedMetrics;

const DEFAULT_FFMPEG_BIN: &str = "ffmpeg";
const DEFAULT_TARGET_FPS: u32 = 30;
const DEFAULT_TARGET_BITRATE_KBPS: u32 = 8_000;
const FRAME_ENCODE_TIMEOUT_MS: u64 = 1_500;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct FfmpegIvfCodecConfig {
    /// ffmpeg `-c:v` value (e.g. `"libvpx"`, `"libvpx-vp9"`, `"libaom-av1"`)
    ffmpeg_codec: &'static str,
    /// Environment variable for overriding the ffmpeg binary path
    env_var: &'static str,
    /// Encoder probe: exact token matched as the second whitespace-delimited
    /// field in `ffmpeg -encoders` output (e.g. `"libvpx"`, `"libaom-av1"`)
    encoder_probe_token: &'static str,
    /// Name of the realtime flag (`"-deadline"` or `"-usage"`)
    realtime_flag: &'static str,
    /// `-cpu-used` value
    cpu_used: &'static str,
    /// Extra codec-specific args appended after the common block
    extra_args: &'static [&'static str],
    /// MIME type for the codec descriptor
    mime_type: &'static str,
    /// Label used in log messages and backend selection
    log_label: &'static str,
}

static VP8_CONFIG: FfmpegIvfCodecConfig = FfmpegIvfCodecConfig {
    ffmpeg_codec: "libvpx",
    env_var: "YANKCORD_NATIVE_VP8_FFMPEG_PATH",
    encoder_probe_token: "libvpx",
    realtime_flag: "-deadline",
    cpu_used: "6",
    extra_args: &["-auto-alt-ref", "0"],
    mime_type: "video/VP8",
    log_label: "ffmpeg-vp8",
};

static VP9_CONFIG: FfmpegIvfCodecConfig = FfmpegIvfCodecConfig {
    ffmpeg_codec: "libvpx-vp9",
    env_var: "YANKCORD_NATIVE_VP9_FFMPEG_PATH",
    encoder_probe_token: "libvpx-vp9",
    realtime_flag: "-deadline",
    cpu_used: "6",
    extra_args: &["-tile-columns", "1", "-frame-parallel", "0"],
    mime_type: "video/VP9",
    log_label: "ffmpeg-vp9",
};

static AV1_CONFIG: FfmpegIvfCodecConfig = FfmpegIvfCodecConfig {
    ffmpeg_codec: "libaom-av1",
    env_var: "YANKCORD_NATIVE_AV1_FFMPEG_PATH",
    encoder_probe_token: "libaom-av1",
    realtime_flag: "-usage",
    cpu_used: "8",
    extra_args: &[],
    mime_type: "video/AV1",
    log_label: "ffmpeg-av1",
};

struct FfmpegIvfProcess {
    child: Child,
    stdin: ChildStdin,
    stdout_rx: Receiver<Vec<u8>>,
    stdout_thread: JoinHandle<()>,
    pending_output: Vec<u8>,
    ivf_header_seen: bool,
    width: u32,
    height: u32,
}

impl FfmpegIvfProcess {
    fn drain_stdout(&mut self) {
        loop {
            match self.stdout_rx.try_recv() {
                Ok(chunk) => self.pending_output.extend_from_slice(&chunk),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => break,
            }
        }
    }

    fn next_ivf_frame(&mut self, label: &str) -> Result<Option<Vec<u8>>, String> {
        if !self.ivf_header_seen {
            if self.pending_output.len() < 32 {
                return Ok(None);
            }

            if &self.pending_output[..4] != b"DKIF" {
                return Err(format!(
                    "ffmpeg {label} output is not IVF (DKIF header missing)"
                ));
            }

            self.pending_output.drain(0..32);
            self.ivf_header_seen = true;
        }

        if self.pending_output.len() < 12 {
            return Ok(None);
        }

        let frame_size = u32::from_le_bytes([
            self.pending_output[0],
            self.pending_output[1],
            self.pending_output[2],
            self.pending_output[3],
        ]) as usize;
        let total_len = 12usize.saturating_add(frame_size);
        if self.pending_output.len() < total_len {
            return Ok(None);
        }

        let frame = self.pending_output[12..total_len].to_vec();
        self.pending_output.drain(0..total_len);
        Ok(Some(frame))
    }

    fn wait_for_frame_output(&mut self, label: &str) -> Result<Vec<u8>, String> {
        let started = Instant::now();
        let timeout = Duration::from_millis(FRAME_ENCODE_TIMEOUT_MS);

        loop {
            self.drain_stdout();
            if let Some(frame) = self.next_ivf_frame(label)? {
                return Ok(frame);
            }

            if started.elapsed() >= timeout {
                return Err(format!("timed out waiting for {label} frame output"));
            }

            thread::sleep(Duration::from_millis(2));
        }
    }

    fn shutdown(mut self) {
        let _ = self.stdin.flush();
        drop(self.stdin);
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = self.stdout_thread.join();
    }
}

pub struct FfmpegIvfEncoderBackend {
    config: &'static FfmpegIvfCodecConfig,
    ffmpeg_bin: String,
    target_fps: u32,
    target_bitrate_kbps: u32,
    process: Option<FfmpegIvfProcess>,
}

impl FfmpegIvfEncoderBackend {
    fn new(
        config: &'static FfmpegIvfCodecConfig,
        target_fps: Option<u32>,
        target_bitrate_kbps: Option<u32>,
    ) -> Result<Self, String> {
        let ffmpeg_bin = std::env::var(config.env_var)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_FFMPEG_BIN.to_string());

        ensure_encoder_available(&ffmpeg_bin, config)?;

        Ok(Self {
            config,
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

    fn ensure_process(&mut self, width: u32, height: u32) -> Result<&mut FfmpegIvfProcess, String> {
        let need_restart = self
            .process
            .as_ref()
            .map(|process| process.width != width || process.height != height)
            .unwrap_or(false);
        if need_restart {
            self.restart_process();
        }

        if self.process.is_none() {
            self.process = Some(spawn_ffmpeg_ivf_process(
                self.config,
                &self.ffmpeg_bin,
                self.target_fps,
                self.target_bitrate_kbps,
                width,
                height,
            )?);
        }

        self.process.as_mut().ok_or_else(|| {
            format!("{} encoder process unavailable", self.config.log_label)
        })
    }

    fn encode_once(
        &mut self,
        bgra: &[u8],
        width: u32,
        height: u32,
    ) -> Result<Vec<Vec<u8>>, String> {
        let frame_size = width as usize * height as usize * 4;
        if frame_size != bgra.len() {
            return Err(format!("{} input frame size mismatch", self.config.log_label));
        }

        let label = self.config.log_label;
        let process = self.ensure_process(width, height)?;
        process
            .stdin
            .write_all(bgra)
            .map_err(|error| format!("failed to write frame to {label} encoder stdin: {error}"))?;
        process
            .stdin
            .flush()
            .map_err(|error| format!("failed to flush {label} encoder stdin: {error}"))?;

        let frame = process.wait_for_frame_output(label)?;
        if frame.is_empty() {
            return Err(format!("ffmpeg {label} encoder produced an empty frame"));
        }

        Ok(vec![frame])
    }
}

impl VideoEncoderBackend for FfmpegIvfEncoderBackend {
    fn codec_descriptor(&self) -> CodecDescriptor {
        CodecDescriptor {
            mime_type: self.config.mime_type,
            clock_rate: 90_000,
            packetization_mode: None,
            profile_level_id: None,
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
            Ok(frames) => Some(frames),
            Err(error) => {
                shared.encode_errors.fetch_add(1, Ordering::Relaxed);
                eprintln!(
                    "[native-sender] event=encode_error backend={} detail=\"{}\"",
                    self.config.log_label, error
                );
                None
            }
        }
    }

    fn request_keyframe(&mut self) -> bool {
        false
    }
}

impl Drop for FfmpegIvfEncoderBackend {
    fn drop(&mut self) {
        self.restart_process();
    }
}

pub fn try_build_vp8_backend(
    target_fps: Option<u32>,
    target_bitrate_kbps: Option<u32>,
) -> Result<Box<dyn VideoEncoderBackend>, String> {
    Ok(Box::new(FfmpegIvfEncoderBackend::new(
        &VP8_CONFIG,
        target_fps,
        target_bitrate_kbps,
    )?))
}

pub fn try_build_vp9_backend(
    target_fps: Option<u32>,
    target_bitrate_kbps: Option<u32>,
) -> Result<Box<dyn VideoEncoderBackend>, String> {
    Ok(Box::new(FfmpegIvfEncoderBackend::new(
        &VP9_CONFIG,
        target_fps,
        target_bitrate_kbps,
    )?))
}

pub fn try_build_av1_backend(
    target_fps: Option<u32>,
    target_bitrate_kbps: Option<u32>,
) -> Result<Box<dyn VideoEncoderBackend>, String> {
    Ok(Box::new(FfmpegIvfEncoderBackend::new(
        &AV1_CONFIG,
        target_fps,
        target_bitrate_kbps,
    )?))
}

fn ensure_encoder_available(
    ffmpeg_bin: &str,
    config: &FfmpegIvfCodecConfig,
) -> Result<(), String> {
    let output = Command::new(ffmpeg_bin)
        .arg("-hide_banner")
        .arg("-encoders")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("failed to execute ffmpeg encoder probe: {error}"))?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "ffmpeg encoder probe failed".to_string()
        } else {
            format!("ffmpeg encoder probe failed: {detail}")
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let found = stdout.lines().any(|line| {
        let trimmed = line.trim_start();
        if trimmed.is_empty() {
            return false;
        }
        let mut tokens = trimmed.split_whitespace();
        let first = tokens.next();
        let second = tokens.next();
        matches!(first, Some(flags) if flags.len() == 6)
            && second == Some(config.encoder_probe_token)
    });
    if !found {
        return Err(format!(
            "ffmpeg is available but {} encoder is missing",
            config.ffmpeg_codec
        ));
    }

    Ok(())
}

fn spawn_ffmpeg_ivf_process(
    config: &FfmpegIvfCodecConfig,
    ffmpeg_bin: &str,
    target_fps: u32,
    target_bitrate_kbps: u32,
    width: u32,
    height: u32,
) -> Result<FfmpegIvfProcess, String> {
    let mut command = Command::new(ffmpeg_bin);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        command.creation_flags(CREATE_NO_WINDOW);
    }

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
        .arg(config.ffmpeg_codec)
        .arg(config.realtime_flag)
        .arg("realtime")
        .arg("-cpu-used")
        .arg(config.cpu_used)
        .arg("-row-mt")
        .arg("1")
        .arg("-threads")
        .arg("4")
        .arg("-lag-in-frames")
        .arg("0");

    for arg in config.extra_args {
        command.arg(arg);
    }

    command
        .arg("-error-resilient")
        .arg("1")
        .arg("-g")
        .arg(target_fps.to_string())
        .arg("-keyint_min")
        .arg(target_fps.to_string())
        .arg("-b:v")
        .arg(format!("{}k", target_bitrate_kbps))
        .arg("-maxrate")
        .arg(format!("{}k", target_bitrate_kbps))
        .arg("-bufsize")
        .arg(format!("{}k", target_bitrate_kbps.saturating_mul(2)))
        .arg("-f")
        .arg("ivf")
        .arg("pipe:1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to spawn ffmpeg for {}: {error}", config.log_label))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| format!("ffmpeg {} stdin unavailable", config.log_label))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("ffmpeg {} stdout unavailable", config.log_label))?;

    let (stdout_tx, stdout_rx) = mpsc::channel::<Vec<u8>>();
    let stdout_thread = thread::spawn(move || {
        let mut reader = std::io::BufReader::new(stdout);
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

    Ok(FfmpegIvfProcess {
        child,
        stdin,
        stdout_rx,
        stdout_thread,
        pending_output: Vec::new(),
        ivf_header_seen: false,
        width,
        height,
    })
}
