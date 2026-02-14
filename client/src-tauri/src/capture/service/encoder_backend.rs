use super::h264_encoder::{
    build_h264_encoder_state, encode_bgra_frame, force_intra_frame, H264EncoderState,
};
use super::metrics::NativeSenderSharedMetrics;
use super::nvenc_encoder::try_build_nvenc_backend;
use super::vp8_encoder::try_build_vp8_backend;
use super::vp9_encoder::try_build_vp9_backend;

#[derive(Debug, Clone, Copy)]
pub struct CodecDescriptor {
    pub mime_type: &'static str,
    pub clock_rate: u32,
    pub packetization_mode: Option<u8>,
    pub profile_level_id: Option<&'static str>,
}

pub trait VideoEncoderBackend: Send {
    fn codec_descriptor(&self) -> CodecDescriptor;
    fn encode_frame(
        &mut self,
        bgra: &[u8],
        width: u32,
        height: u32,
        shared: &NativeSenderSharedMetrics,
    ) -> Option<Vec<Vec<u8>>>;
    fn request_keyframe(&mut self) -> bool;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeCodecTarget {
    H264,
    Vp8,
    Vp9,
    Av1,
}

impl NativeCodecTarget {
    pub fn from_mime_type(mime_type: &str) -> Option<Self> {
        if mime_type.eq_ignore_ascii_case("video/h264") {
            return Some(Self::H264);
        }
        if mime_type.eq_ignore_ascii_case("video/vp8") {
            return Some(Self::Vp8);
        }
        if mime_type.eq_ignore_ascii_case("video/vp9") {
            return Some(Self::Vp9);
        }
        if mime_type.eq_ignore_ascii_case("video/av1") {
            return Some(Self::Av1);
        }

        None
    }
}

pub struct EncoderBackendSelection {
    pub requested_backend: &'static str,
    pub selected_backend: &'static str,
    pub fallback_reason: Option<String>,
}

pub fn create_openh264_backend(
    target_fps: Option<u32>,
    target_bitrate_kbps: Option<u32>,
) -> Box<dyn VideoEncoderBackend> {
    Box::new(OpenH264EncoderBackend::new(target_fps, target_bitrate_kbps))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EncoderPreference {
    Auto,
    OpenH264,
    Nvenc,
}

impl EncoderPreference {
    fn from_label(raw: &str) -> Self {
        let normalized = raw.trim().to_lowercase();
        match normalized.as_str() {
            "openh264" | "open_h264" | "software" => Self::OpenH264,
            "nvenc" => Self::Nvenc,
            _ => Self::Auto,
        }
    }

    fn from_env() -> Self {
        let raw = std::env::var("YANKCORD_NATIVE_ENCODER_BACKEND")
            .ok()
            .unwrap_or_default();
        Self::from_label(&raw)
    }

    fn as_label(&self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::OpenH264 => "openh264",
            Self::Nvenc => "nvenc",
        }
    }
}

pub fn create_encoder_backend(
    target_fps: Option<u32>,
    target_bitrate_kbps: Option<u32>,
    preference_override: Option<&str>,
) -> Result<(Box<dyn VideoEncoderBackend>, EncoderBackendSelection), String> {
    let preference = preference_override
        .map(EncoderPreference::from_label)
        .unwrap_or_else(EncoderPreference::from_env);
    let requested_backend = preference.as_label();

    if preference != EncoderPreference::OpenH264 {
        match try_build_nvenc_backend(target_fps, target_bitrate_kbps) {
            Ok(backend) => {
                return Ok((
                    backend,
                    EncoderBackendSelection {
                        requested_backend,
                        selected_backend: "nvenc",
                        fallback_reason: None,
                    },
                ));
            }
            Err(error) if preference == EncoderPreference::Nvenc => {
                return Err(error);
            }
            Err(error) => {
                return Ok((
                    create_openh264_backend(target_fps, target_bitrate_kbps),
                    EncoderBackendSelection {
                        requested_backend,
                        selected_backend: "openh264",
                        fallback_reason: Some(error),
                    },
                ));
            }
        }
    }

    Ok((
        create_openh264_backend(target_fps, target_bitrate_kbps),
        EncoderBackendSelection {
            requested_backend,
            selected_backend: "openh264",
            fallback_reason: None,
        },
    ))
}

pub fn create_encoder_backend_for_codec(
    codec: NativeCodecTarget,
    target_fps: Option<u32>,
    target_bitrate_kbps: Option<u32>,
    preference_override: Option<&str>,
) -> Result<(Box<dyn VideoEncoderBackend>, EncoderBackendSelection), String> {
    match codec {
        NativeCodecTarget::H264 => {
            create_encoder_backend(target_fps, target_bitrate_kbps, preference_override)
        }
        NativeCodecTarget::Vp8 => {
            let backend = try_build_vp8_backend(target_fps, target_bitrate_kbps)
                .map_err(|error| format!("native_sender_encoder_not_available: {error}"))?;
            Ok((
                backend,
                EncoderBackendSelection {
                    requested_backend: preference_override
                        .map(EncoderPreference::from_label)
                        .unwrap_or_else(EncoderPreference::from_env)
                        .as_label(),
                    selected_backend: "ffmpeg-vp8",
                    fallback_reason: None,
                },
            ))
        }
        NativeCodecTarget::Vp9 => {
            let backend = try_build_vp9_backend(target_fps, target_bitrate_kbps)
                .map_err(|error| format!("native_sender_encoder_not_available: {error}"))?;
            Ok((
                backend,
                EncoderBackendSelection {
                    requested_backend: preference_override
                        .map(EncoderPreference::from_label)
                        .unwrap_or_else(EncoderPreference::from_env)
                        .as_label(),
                    selected_backend: "ffmpeg-vp9",
                    fallback_reason: None,
                },
            ))
        }
        NativeCodecTarget::Av1 => Err(
            "native_sender_encoder_not_available: AV1 encoder backend not implemented".to_string(),
        ),
    }
}

pub struct OpenH264EncoderBackend {
    state: H264EncoderState,
}

impl OpenH264EncoderBackend {
    pub fn new(target_fps: Option<u32>, target_bitrate_kbps: Option<u32>) -> Self {
        Self {
            state: build_h264_encoder_state(target_fps, target_bitrate_kbps),
        }
    }
}

impl VideoEncoderBackend for OpenH264EncoderBackend {
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
        encode_bgra_frame(&mut self.state, bgra, width, height, shared)
    }

    fn request_keyframe(&mut self) -> bool {
        force_intra_frame(&mut self.state)
    }
}
