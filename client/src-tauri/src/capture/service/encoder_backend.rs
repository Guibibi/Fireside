use super::h264_encoder::{
    build_h264_encoder_state, encode_bgra_frame, force_intra_frame, H264EncoderState,
};
use super::metrics::NativeSenderSharedMetrics;
use super::nvenc_sdk::try_build_nvenc_sdk_backend;

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
}

impl NativeCodecTarget {
    pub fn from_mime_type(mime_type: &str) -> Option<Self> {
        if mime_type.eq_ignore_ascii_case("video/h264") {
            return Some(Self::H264);
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
    NvencSdk,
}

impl EncoderPreference {
    fn from_label(raw: &str) -> Self {
        let normalized = raw.trim().to_lowercase();
        match normalized.as_str() {
            "openh264" | "open_h264" | "software" => Self::OpenH264,
            "nvenc_sdk" | "nvenc" => Self::NvencSdk,
            _ => Self::Auto,
        }
    }

    fn as_label(&self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::OpenH264 => "openh264",
            Self::NvencSdk => "nvenc_sdk",
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
        .unwrap_or(EncoderPreference::Auto);
    let requested_backend = preference.as_label();

    // Explicit nvenc_sdk request
    if preference == EncoderPreference::NvencSdk {
        return match try_build_nvenc_sdk_backend(target_fps, target_bitrate_kbps) {
            Ok(backend) => Ok((
                backend,
                EncoderBackendSelection {
                    requested_backend,
                    selected_backend: "nvenc_sdk",
                    fallback_reason: None,
                },
            )),
            Err(error) => Err(error),
        };
    }

    if preference != EncoderPreference::OpenH264 {
        // Auto / NvencSdk path: try NVENC SDK, then fall back to OpenH264.
        match try_build_nvenc_sdk_backend(target_fps, target_bitrate_kbps) {
            Ok(backend) => {
                return Ok((
                    backend,
                    EncoderBackendSelection {
                        requested_backend,
                        selected_backend: "nvenc_sdk",
                        fallback_reason: None,
                    },
                ));
            }
            Err(nvenc_error) => {
                eprintln!(
                    "[native-sender] event=nvenc_sdk_unavailable detail=\"{}\" falling_back_to=openh264",
                    nvenc_error
                );
                return Ok((
                    create_openh264_backend(target_fps, target_bitrate_kbps),
                    EncoderBackendSelection {
                        requested_backend,
                        selected_backend: "openh264",
                        fallback_reason: Some(nvenc_error),
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
    _codec: NativeCodecTarget,
    target_fps: Option<u32>,
    target_bitrate_kbps: Option<u32>,
    preference_override: Option<&str>,
) -> Result<(Box<dyn VideoEncoderBackend>, EncoderBackendSelection), String> {
    create_encoder_backend(target_fps, target_bitrate_kbps, preference_override)
}

/// Split an Annex B H.264/H.265 bitstream into individual NAL units,
/// stripping the start code prefixes (0x000001 or 0x00000001).
/// Used by nvenc_encoder and nvenc_sdk (Windows-only cfg blocks).
#[allow(dead_code)]
pub(super) fn split_annex_b_nals(bitstream: &[u8]) -> Vec<Vec<u8>> {
    let mut start_indices = Vec::new();
    let mut index = 0usize;
    while index + 3 <= bitstream.len() {
        if index + 4 <= bitstream.len()
            && bitstream[index] == 0
            && bitstream[index + 1] == 0
            && bitstream[index + 2] == 0
            && bitstream[index + 3] == 1
        {
            start_indices.push((index, 4usize));
            index += 4;
            continue;
        }
        if bitstream[index] == 0 && bitstream[index + 1] == 0 && bitstream[index + 2] == 1 {
            start_indices.push((index, 3usize));
            index += 3;
            continue;
        }
        index += 1;
    }

    if start_indices.is_empty() {
        return Vec::new();
    }

    let mut nals = Vec::new();
    for window_index in 0..start_indices.len() {
        let (start, prefix_len) = start_indices[window_index];
        let payload_start = start + prefix_len;
        let payload_end = if window_index + 1 < start_indices.len() {
            start_indices[window_index + 1].0
        } else {
            bitstream.len()
        };

        if payload_end > payload_start {
            nals.push(bitstream[payload_start..payload_end].to_vec());
        }
    }

    nals
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
