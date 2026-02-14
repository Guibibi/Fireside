use super::h264_encoder::{
    build_h264_encoder_state, encode_bgra_frame, force_intra_frame, H264EncoderState,
};
use super::metrics::NativeSenderSharedMetrics;
use super::nvenc_encoder::try_build_nvenc_backend;

#[derive(Debug, Clone, Copy)]
pub struct CodecDescriptor {
    pub mime_type: &'static str,
    pub clock_rate: u32,
    pub packetization_mode: u8,
    pub profile_level_id: &'static str,
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
    fn from_env() -> Self {
        let raw = std::env::var("YANKCORD_NATIVE_ENCODER_BACKEND")
            .ok()
            .unwrap_or_default();
        let normalized = raw.trim().to_lowercase();
        match normalized.as_str() {
            "openh264" | "open_h264" | "software" => Self::OpenH264,
            "nvenc" => Self::Nvenc,
            _ => Self::Auto,
        }
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
) -> (Box<dyn VideoEncoderBackend>, EncoderBackendSelection) {
    let preference = EncoderPreference::from_env();
    let requested_backend = preference.as_label();

    if preference != EncoderPreference::OpenH264 {
        match try_build_nvenc_backend(target_fps, target_bitrate_kbps) {
            Ok(backend) => {
                return (
                    backend,
                    EncoderBackendSelection {
                        requested_backend,
                        selected_backend: "nvenc",
                        fallback_reason: None,
                    },
                );
            }
            Err(error) if preference == EncoderPreference::Nvenc => {
                eprintln!(
                    "[native-sender] event=encoder_backend_fallback requested=nvenc selected=openh264 reason={}",
                    error
                );
                return (
                    create_openh264_backend(target_fps, target_bitrate_kbps),
                    EncoderBackendSelection {
                        requested_backend,
                        selected_backend: "openh264",
                        fallback_reason: Some(error),
                    },
                );
            }
            Err(error) => {
                return (
                    create_openh264_backend(target_fps, target_bitrate_kbps),
                    EncoderBackendSelection {
                        requested_backend,
                        selected_backend: "openh264",
                        fallback_reason: Some(error),
                    },
                );
            }
        }
    }

    (
        create_openh264_backend(target_fps, target_bitrate_kbps),
        EncoderBackendSelection {
            requested_backend,
            selected_backend: "openh264",
            fallback_reason: None,
        },
    )
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
            packetization_mode: 1,
            profile_level_id: "42e01f",
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
