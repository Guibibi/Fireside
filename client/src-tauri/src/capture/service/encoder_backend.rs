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
    fn backend_name(&self) -> &'static str;
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
}

pub fn create_encoder_backend(
    target_fps: Option<u32>,
    target_bitrate_kbps: Option<u32>,
) -> Box<dyn VideoEncoderBackend> {
    let preference = EncoderPreference::from_env();

    if preference != EncoderPreference::OpenH264 {
        match try_build_nvenc_backend(target_fps, target_bitrate_kbps) {
            Ok(backend) => return backend,
            Err(error) if preference == EncoderPreference::Nvenc => {
                eprintln!(
                    "[native-sender] event=encoder_backend_fallback requested=nvenc selected=openh264 reason={}",
                    error
                );
            }
            Err(_) => {}
        }
    }

    Box::new(OpenH264EncoderBackend::new(target_fps, target_bitrate_kbps))
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
    fn backend_name(&self) -> &'static str {
        "openh264"
    }

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
