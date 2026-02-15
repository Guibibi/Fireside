use super::encoder_backend::VideoEncoderBackend;

#[cfg(all(target_os = "windows", feature = "native-nvenc"))]
use super::encoder_backend::CodecDescriptor;
#[cfg(all(target_os = "windows", feature = "native-nvenc"))]
use super::metrics::NativeSenderSharedMetrics;

#[cfg(all(target_os = "windows", feature = "native-nvenc"))]
mod imp {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::os::windows::process::CommandExt;
    use std::path::PathBuf;
    use std::process::{Child, ChildStdin, Command, Stdio};
    use std::sync::atomic::Ordering;
    use std::sync::mpsc::{self, Receiver, TryRecvError};
    use std::thread::{self, JoinHandle};
    use std::time::Duration;

    use super::{CodecDescriptor, NativeSenderSharedMetrics, VideoEncoderBackend};

    const DEFAULT_FFMPEG_BIN: &str = "ffmpeg";
    const DEFAULT_NVENC_PRESET: &str = "p4";
    const DEFAULT_TARGET_FPS: u32 = 30;
    const DEFAULT_TARGET_BITRATE_KBPS: u32 = 8_000;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    /// Maximum frames NVENC can buffer internally before producing output.
    /// NVENC's encode pipeline typically has 2-4 frames of latency.
    const NVENC_PIPELINE_DEPTH: u64 = 4;

    /// Maximum consecutive empty outputs after ramp-up before reporting an error.
    const CONSECUTIVE_EMPTY_THRESHOLD: u64 = 3;

    struct NvencProcess {
        child: Child,
        stdin: ChildStdin,
        stdout_rx: Receiver<Vec<u8>>,
        progress_rx: Receiver<u64>,
        stdout_thread: JoinHandle<()>,
        progress_thread: JoinHandle<()>,
        pending_output: Vec<u8>,
        submitted_frames: u64,
        reported_frames: u64,
        consecutive_empty_outputs: u64,
        target_fps: u32,
        width: u32,
        height: u32,
    }

    impl NvencProcess {
        fn drain_channels(&mut self) {
            loop {
                match self.stdout_rx.try_recv() {
                    Ok(chunk) => self.pending_output.extend_from_slice(&chunk),
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => break,
                }
            }

            loop {
                match self.progress_rx.try_recv() {
                    Ok(frame) => {
                        self.reported_frames = self.reported_frames.max(frame);
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => break,
                }
            }
        }

        fn collect_available_output(&mut self) -> Result<Vec<u8>, String> {
            // First, drain whatever is already available (non-blocking).
            self.drain_channels();

            // During ramp-up, the pipeline isn't primed yet — return whatever we have
            // (likely empty) without waiting.
            let in_ramp_up = self.submitted_frames <= NVENC_PIPELINE_DEPTH;

            if !in_ramp_up && self.pending_output.is_empty() {
                // After ramp-up, wait up to 2× frame interval for output to appear.
                let wait_ms = 2 * 1000 / self.target_fps.max(1) as u64;
                let timeout = Duration::from_millis(wait_ms);

                match self.stdout_rx.recv_timeout(timeout) {
                    Ok(chunk) => self.pending_output.extend_from_slice(&chunk),
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {}
                }

                // Drain any additional chunks that arrived during the wait.
                self.drain_channels();
            }

            // Check for stall: if we've submitted many frames but encoder isn't keeping up
            let lag = self.submitted_frames.saturating_sub(self.reported_frames);
            let stalled = lag > NVENC_PIPELINE_DEPTH * 3 && self.reported_frames > 0;

            if stalled {
                return Err(format!(
                    "NVENC encoder stalled (submitted={}, reported={}, lag={})",
                    self.submitted_frames, self.reported_frames, lag
                ));
            }

            Ok(std::mem::take(&mut self.pending_output))
        }

        fn shutdown(mut self) {
            let _ = self.stdin.flush();
            drop(self.stdin);
            let _ = self.child.kill();
            let _ = self.child.wait();
            let _ = self.stdout_thread.join();
            let _ = self.progress_thread.join();
        }
    }

    pub(super) struct NvencEncoderBackend {
        ffmpeg_bin: String,
        preset: String,
        target_fps: u32,
        target_bitrate_kbps: u32,
        process: Option<NvencProcess>,
    }

    impl NvencEncoderBackend {
        fn new(target_fps: Option<u32>, target_bitrate_kbps: Option<u32>) -> Result<Self, String> {
            let ffmpeg_bin = resolve_ffmpeg_bin();

            let preset = std::env::var("YANKCORD_NATIVE_NVENC_PRESET")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| DEFAULT_NVENC_PRESET.to_string());

            ensure_nvenc_encoder_available(&ffmpeg_bin)?;

            Ok(Self {
                ffmpeg_bin,
                preset,
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

        fn ensure_process(&mut self, width: u32, height: u32) -> Result<&mut NvencProcess, String> {
            let need_restart = self
                .process
                .as_ref()
                .map(|process| process.width != width || process.height != height)
                .unwrap_or(false);

            if need_restart {
                self.restart_process();
            }

            if self.process.is_none() {
                self.process = Some(spawn_nvenc_process(
                    &self.ffmpeg_bin,
                    &self.preset,
                    self.target_fps,
                    self.target_bitrate_kbps,
                    width,
                    height,
                )?);
            }

            self.process
                .as_mut()
                .ok_or_else(|| "NVENC process unavailable".to_string())
        }

        fn encode_once(
            &mut self,
            bgra: &[u8],
            width: u32,
            height: u32,
        ) -> Result<Vec<Vec<u8>>, String> {
            let frame_size = width as usize * height as usize * 4;
            if frame_size != bgra.len() {
                return Err("NVENC input frame size mismatch".to_string());
            }

            let process = self.ensure_process(width, height)?;

            process
                .stdin
                .write_all(bgra)
                .map_err(|error| format!("failed to write frame to NVENC stdin: {error}"))?;
            process
                .stdin
                .flush()
                .map_err(|error| format!("failed to flush NVENC stdin: {error}"))?;

            process.submitted_frames = process.submitted_frames.saturating_add(1);
            let encoded = process.collect_available_output()?;
            let nals = split_annex_b_nals(&encoded);

            if nals.is_empty() {
                if process.submitted_frames <= NVENC_PIPELINE_DEPTH {
                    // During ramp-up, empty output is expected (pipeline not yet primed)
                    return Ok(Vec::new());
                }

                process.consecutive_empty_outputs =
                    process.consecutive_empty_outputs.saturating_add(1);
                if process.consecutive_empty_outputs >= CONSECUTIVE_EMPTY_THRESHOLD {
                    return Err(format!(
                        "ffmpeg NVENC produced no NAL units ({} consecutive empties)",
                        process.consecutive_empty_outputs,
                    ));
                }

                // Transient empty — not yet an error
                return Ok(Vec::new());
            }

            process.consecutive_empty_outputs = 0;
            Ok(nals)
        }
    }

    impl VideoEncoderBackend for NvencEncoderBackend {
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
                Ok(nals) if nals.is_empty() => None, // Ramp-up: no output yet, not an error
                Ok(nals) => Some(nals),
                Err(error) => {
                    shared.encode_errors.fetch_add(1, Ordering::Relaxed);
                    eprintln!(
                        "[native-sender] event=encode_error backend=nvenc detail=\"{}\"",
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

    impl Drop for NvencEncoderBackend {
        fn drop(&mut self) {
            self.restart_process();
        }
    }

    pub(super) fn build_nvenc_backend(
        target_fps: Option<u32>,
        target_bitrate_kbps: Option<u32>,
    ) -> Result<Box<dyn VideoEncoderBackend>, String> {
        let backend = NvencEncoderBackend::new(target_fps, target_bitrate_kbps)?;
        Ok(Box::new(backend))
    }

    fn ensure_nvenc_encoder_available(ffmpeg_bin: &str) -> Result<(), String> {
        let output = Command::new(ffmpeg_bin)
            .creation_flags(CREATE_NO_WINDOW)
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
        if !stdout.contains("h264_nvenc") {
            return Err(
                "ffmpeg is available but h264_nvenc encoder is missing (driver/GPU/ffmpeg build)"
                    .to_string(),
            );
        }

        Ok(())
    }

    fn resolve_ffmpeg_bin() -> String {
        if let Some(configured) = std::env::var("YANKCORD_NATIVE_NVENC_FFMPEG_PATH")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
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
                candidates.push(exe_dir.join("ffmpeg.exe"));
                candidates.push(exe_dir.join("resources").join("ffmpeg.exe"));
                candidates.push(exe_dir.join("resources").join("bin").join("ffmpeg.exe"));
            }
        }

        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("bin")
                .join("ffmpeg.exe"),
        );

        candidates
    }

    fn spawn_nvenc_process(
        ffmpeg_bin: &str,
        preset: &str,
        target_fps: u32,
        target_bitrate_kbps: u32,
        width: u32,
        height: u32,
    ) -> Result<NvencProcess, String> {
        let mut command = Command::new(ffmpeg_bin);
        command
            .creation_flags(CREATE_NO_WINDOW)
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
            .arg("h264_nvenc")
            .arg("-profile:v")
            .arg("baseline")
            .arg("-preset")
            .arg(preset)
            .arg("-tune")
            .arg("ll")
            // NVENC-specific: minimize lookahead delay
            .arg("-rc-lookahead")
            .arg("0")
            .arg("-delay")
            .arg("0")
            .arg("-zerolatency")
            .arg("1")
            .arg("-g")
            .arg(target_fps.to_string())
            .arg("-bf")
            .arg("0")
            .arg("-aud")
            .arg("1")
            .arg("-b:v")
            .arg(format!("{}k", target_bitrate_kbps))
            .arg("-maxrate")
            .arg(format!("{}k", target_bitrate_kbps))
            .arg("-bufsize")
            .arg(format!("{}k", target_bitrate_kbps.saturating_mul(2)))
            .arg("-progress")
            .arg("pipe:2")
            // Force immediate output flushing
            .arg("-flush_packets")
            .arg("1")
            .arg("-f")
            .arg("h264")
            .arg("pipe:1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|error| format!("failed to spawn ffmpeg for NVENC: {error}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "ffmpeg NVENC stdin unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "ffmpeg NVENC stdout unavailable".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "ffmpeg NVENC stderr unavailable".to_string())?;

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

        let (progress_tx, progress_rx) = mpsc::channel::<u64>();
        let progress_thread = thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        if let Some(raw) = line.trim().strip_prefix("frame=") {
                            if let Ok(frame) = raw.trim().parse::<u64>() {
                                if progress_tx.send(frame).is_err() {
                                    break;
                                }
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        Ok(NvencProcess {
            child,
            stdin,
            stdout_rx,
            progress_rx,
            stdout_thread,
            progress_thread,
            pending_output: Vec::new(),
            submitted_frames: 0,
            reported_frames: 0,
            consecutive_empty_outputs: 0,
            target_fps,
            width,
            height,
        })
    }

    use super::encoder_backend::split_annex_b_nals;
}

#[cfg(all(target_os = "windows", feature = "native-nvenc"))]
pub fn try_build_nvenc_backend(
    target_fps: Option<u32>,
    target_bitrate_kbps: Option<u32>,
) -> Result<Box<dyn VideoEncoderBackend>, String> {
    imp::build_nvenc_backend(target_fps, target_bitrate_kbps)
}

#[cfg(not(all(target_os = "windows", feature = "native-nvenc")))]
pub fn try_build_nvenc_backend(
    _target_fps: Option<u32>,
    _target_bitrate_kbps: Option<u32>,
) -> Result<Box<dyn VideoEncoderBackend>, String> {
    Err(
        "NVENC backend is not available in this build (requires Windows + native-nvenc feature)."
            .to_string(),
    )
}
