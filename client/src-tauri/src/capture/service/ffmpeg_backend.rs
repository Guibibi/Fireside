use super::encoder_backend::VideoEncoderBackend;

#[cfg(target_os = "windows")]
use super::encoder_backend::{split_annex_b_nals, CodecDescriptor};
#[cfg(target_os = "windows")]
use super::metrics::NativeSenderSharedMetrics;
#[cfg(target_os = "windows")]
use std::sync::atomic::Ordering;
#[cfg(target_os = "windows")]
use std::sync::OnceLock;

#[cfg(target_os = "windows")]
use playa_ffmpeg as ffmpeg;

const DEFAULT_TARGET_FPS: u32 = 30;
const DEFAULT_TARGET_BITRATE_KBPS: u32 = 8_000;

#[cfg(target_os = "windows")]
fn ensure_ffmpeg_initialized() -> Result<(), String> {
    static INIT: OnceLock<Result<(), String>> = OnceLock::new();
    INIT.get_or_init(|| {
        ffmpeg::init().map_err(|error| format!("Failed to initialize FFmpeg backend: {error}"))
    })
    .clone()
}

#[cfg(target_os = "windows")]
fn encoder_options(
    backend: &str,
    target_fps: u32,
    target_bitrate_kbps: u32,
) -> ffmpeg::Dictionary<'static> {
    let mut options = ffmpeg::Dictionary::new();

    options.set("profile", "baseline");
    options.set("g", &target_fps.to_string());
    options.set("keyint_min", &target_fps.to_string());
    options.set("bf", "0");

    let bitrate = format!("{}k", target_bitrate_kbps.max(1_000));
    options.set("b:v", &bitrate);
    options.set("maxrate", &bitrate);
    options.set(
        "bufsize",
        &format!("{}k", target_bitrate_kbps.saturating_mul(2).max(2_000)),
    );

    match backend {
        "h264_nvenc" => {
            options.set("preset", "p4");
            options.set("tune", "ull");
            options.set("rc", "cbr");
            options.set("delay", "0");
            options.set("zerolatency", "1");
        }
        "h264_qsv" => {
            options.set("preset", "veryfast");
            options.set("look_ahead", "0");
            options.set("async_depth", "1");
        }
        "h264_amf" => {
            options.set("usage", "ultralowlatency");
            options.set("quality", "speed");
        }
        "libx264" => {
            options.set("preset", "ultrafast");
            options.set("tune", "zerolatency");
        }
        _ => {}
    }

    options
}

#[cfg(target_os = "windows")]
fn open_encoder_context(
    backend: &str,
    width: u32,
    height: u32,
    target_fps: u32,
    target_bitrate_kbps: u32,
) -> Result<ffmpeg::encoder::video::Encoder, String> {
    ensure_ffmpeg_initialized()?;

    let codec = ffmpeg::encoder::find_by_name(backend)
        .ok_or_else(|| format!("encoder '{backend}' is not available in this FFmpeg build"))?;

    let mut encoder = ffmpeg::codec::context::Context::new_with_codec(codec)
        .encoder()
        .video()
        .map_err(|error| format!("failed to create encoder context for {backend}: {error}"))?;

    encoder.set_width(width);
    encoder.set_height(height);
    encoder.set_format(ffmpeg::format::Pixel::YUV420P);
    encoder.set_time_base(ffmpeg::Rational(1, target_fps as i32));
    encoder.set_frame_rate(Some(ffmpeg::Rational(target_fps as i32, 1)));
    encoder.set_gop(target_fps);
    encoder.set_max_b_frames(0);
    encoder.set_bit_rate((target_bitrate_kbps as usize).saturating_mul(1_000));
    encoder.set_max_bit_rate((target_bitrate_kbps as usize).saturating_mul(1_000));

    encoder
        .open_with(encoder_options(backend, target_fps, target_bitrate_kbps))
        .map_err(|error| format!("failed to open {backend} encoder: {error}"))
}

#[cfg(target_os = "windows")]
struct FfmpegEncoderSession {
    encoder: ffmpeg::encoder::video::Encoder,
    scaler: ffmpeg::software::scaling::Context,
    bgra_frame: ffmpeg::frame::Video,
    yuv_frame: ffmpeg::frame::Video,
    packet: ffmpeg::Packet,
    width: u32,
    height: u32,
    next_pts: i64,
}

#[cfg(target_os = "windows")]
impl FfmpegEncoderSession {
    fn new(
        backend: &str,
        width: u32,
        height: u32,
        target_fps: u32,
        target_bitrate_kbps: u32,
    ) -> Result<Self, String> {
        let encoder =
            open_encoder_context(backend, width, height, target_fps, target_bitrate_kbps)?;
        let scaler = ffmpeg::software::scaling::Context::get(
            ffmpeg::format::Pixel::BGRA,
            width,
            height,
            ffmpeg::format::Pixel::YUV420P,
            width,
            height,
            ffmpeg::software::scaling::Flags::BILINEAR,
        )
        .map_err(|error| format!("failed to create FFmpeg scaler for {backend}: {error}"))?;

        Ok(Self {
            encoder,
            scaler,
            bgra_frame: ffmpeg::frame::Video::new(ffmpeg::format::Pixel::BGRA, width, height),
            yuv_frame: ffmpeg::frame::Video::new(ffmpeg::format::Pixel::YUV420P, width, height),
            packet: ffmpeg::Packet::empty(),
            width,
            height,
            next_pts: 0,
        })
    }

    fn encode(
        &mut self,
        bgra: &[u8],
        force_keyframe: bool,
    ) -> Result<Option<Vec<Vec<u8>>>, String> {
        let expected = self.width as usize * self.height as usize * 4;
        if bgra.len() != expected {
            return Err(format!(
                "input frame size mismatch (expected {expected}, got {})",
                bgra.len()
            ));
        }

        let row_bytes = self.width as usize * 4;
        let stride = self.bgra_frame.stride(0);
        let dst = self.bgra_frame.data_mut(0);

        for row in 0..self.height as usize {
            let src_start = row * row_bytes;
            let src_end = src_start + row_bytes;
            let dst_start = row * stride;
            let dst_end = dst_start + row_bytes;
            dst[dst_start..dst_end].copy_from_slice(&bgra[src_start..src_end]);
        }

        self.bgra_frame.set_pts(Some(self.next_pts));
        self.yuv_frame.set_pts(Some(self.next_pts));
        self.next_pts = self.next_pts.saturating_add(1);

        self.scaler
            .run(&self.bgra_frame, &mut self.yuv_frame)
            .map_err(|error| format!("failed to convert BGRA frame to YUV420P: {error}"))?;

        if force_keyframe {
            self.yuv_frame.set_kind(ffmpeg::picture::Type::I);
        } else {
            self.yuv_frame.set_kind(ffmpeg::picture::Type::None);
        }

        self.encoder
            .send_frame(&self.yuv_frame)
            .map_err(|error| format!("failed to submit frame to encoder: {error}"))?;

        let mut nals = Vec::new();
        loop {
            match self.encoder.receive_packet(&mut self.packet) {
                Ok(()) => {
                    if let Some(data) = self.packet.data() {
                        let mut split = split_annex_b_nals(data);
                        if split.is_empty() && !data.is_empty() {
                            split.push(data.to_vec());
                        }
                        nals.extend(split);
                    }
                    self.packet = ffmpeg::Packet::empty();
                }
                Err(ffmpeg::Error::Other {
                    errno: ffmpeg::error::EAGAIN,
                })
                | Err(ffmpeg::Error::Eof) => {
                    break;
                }
                Err(error) => {
                    return Err(format!("failed to receive encoded packet: {error}"));
                }
            }
        }

        if nals.is_empty() {
            Ok(None)
        } else {
            Ok(Some(nals))
        }
    }
}

#[cfg(target_os = "windows")]
pub struct FfmpegEncoderBackend {
    selected_backend: &'static str,
    target_fps: u32,
    target_bitrate_kbps: u32,
    session: Option<FfmpegEncoderSession>,
    force_next_keyframe: bool,
}

#[cfg(target_os = "windows")]
impl FfmpegEncoderBackend {
    fn new(
        selected_backend: &'static str,
        target_fps: Option<u32>,
        target_bitrate_kbps: Option<u32>,
    ) -> Result<Self, String> {
        ensure_ffmpeg_initialized()?;
        Ok(Self {
            selected_backend,
            target_fps: target_fps.unwrap_or(DEFAULT_TARGET_FPS).max(1),
            target_bitrate_kbps: target_bitrate_kbps
                .unwrap_or(DEFAULT_TARGET_BITRATE_KBPS)
                .max(1_000),
            session: None,
            force_next_keyframe: false,
        })
    }

    fn ensure_session(
        &mut self,
        width: u32,
        height: u32,
    ) -> Result<&mut FfmpegEncoderSession, String> {
        let needs_reset = self
            .session
            .as_ref()
            .map(|session| session.width != width || session.height != height)
            .unwrap_or(true);

        if needs_reset {
            self.session = Some(FfmpegEncoderSession::new(
                self.selected_backend,
                width,
                height,
                self.target_fps,
                self.target_bitrate_kbps,
            )?);
        }

        self.session
            .as_mut()
            .ok_or_else(|| "encoder session unavailable".to_string())
    }
}

#[cfg(target_os = "windows")]
impl VideoEncoderBackend for FfmpegEncoderBackend {
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

        let force_keyframe = self.force_next_keyframe;
        self.force_next_keyframe = false;

        let session = match self.ensure_session(width, height) {
            Ok(session) => session,
            Err(error) => {
                shared.encode_errors.fetch_add(1, Ordering::Relaxed);
                eprintln!(
                    "[native-sender] event=encode_error backend={} detail=\"{}\"",
                    self.selected_backend, error
                );
                self.session = None;
                return None;
            }
        };

        match session.encode(bgra, force_keyframe) {
            Ok(Some(nals)) => Some(nals),
            Ok(None) => None,
            Err(error) => {
                shared.encode_errors.fetch_add(1, Ordering::Relaxed);
                eprintln!(
                    "[native-sender] event=encode_error backend={} detail=\"{}\"",
                    self.selected_backend, error
                );
                self.session = None;
                None
            }
        }
    }

    fn request_keyframe(&mut self) -> bool {
        self.force_next_keyframe = true;
        true
    }
}

#[cfg(target_os = "windows")]
pub fn probe_ffmpeg_backend(backend: &str) -> Result<(), String> {
    let _ = open_encoder_context(
        backend,
        1280,
        720,
        DEFAULT_TARGET_FPS,
        DEFAULT_TARGET_BITRATE_KBPS,
    )?;
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn build_ffmpeg_backend(
    target_fps: Option<u32>,
    target_bitrate_kbps: Option<u32>,
    selected_backend: &'static str,
) -> Result<Box<dyn VideoEncoderBackend>, String> {
    Ok(Box::new(FfmpegEncoderBackend::new(
        selected_backend,
        target_fps,
        target_bitrate_kbps,
    )?))
}

#[cfg(not(target_os = "windows"))]
pub fn probe_ffmpeg_backend(_backend: &str) -> Result<(), String> {
    Err("Native FFmpeg backend is available on Windows only in this phase.".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn build_ffmpeg_backend(
    _target_fps: Option<u32>,
    _target_bitrate_kbps: Option<u32>,
    _selected_backend: &'static str,
) -> Result<Box<dyn VideoEncoderBackend>, String> {
    Err("Native FFmpeg backend is available on Windows only in this phase.".to_string())
}
