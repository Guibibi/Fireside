use super::av1_encoder::try_build_av1_backend;
use super::h264_encoder::{
    build_h264_encoder_state, encode_bgra_frame, force_intra_frame, H264EncoderState,
};
use super::metrics::NativeSenderSharedMetrics;
use super::nvenc_encoder::try_build_nvenc_backend;
use super::nvenc_sdk::try_build_nvenc_sdk_backend;
use super::vp8_encoder::try_build_vp8_backend;
use super::vp9_encoder::try_build_vp9_backend;

use crate::capture::gpu_frame::GpuTextureHandle;

/// Result of attempting to encode a GPU-resident texture directly.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum GpuEncodeResult {
    /// Encoder does not support GPU texture input; fall back to CPU readback.
    NotSupported,
    /// Encoder accepted the frame but produced no output yet (pipeline ramp-up).
    NoOutput,
    /// Successfully encoded: NAL units ready for packetization.
    Encoded(Vec<Vec<u8>>),
}

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

    /// Try to encode a GPU-resident texture directly (zero-copy path).
    /// Default implementation returns `NotSupported`, causing the caller
    /// to fall back to CPU readback + `encode_frame`.
    ///
    /// Note: This method is available on all platforms but returns NotSupported
    /// on non-Windows platforms. The GpuTextureHandle is cfg-gated internally.
    #[allow(unused_variables)]
    fn encode_gpu_frame(
        &mut self,
        handle: &GpuTextureHandle,
        shared: &NativeSenderSharedMetrics,
    ) -> GpuEncodeResult {
        GpuEncodeResult::NotSupported
    }
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
    NvencSdk,
}

impl EncoderPreference {
    fn from_label(raw: &str) -> Self {
        let normalized = raw.trim().to_lowercase();
        match normalized.as_str() {
            "openh264" | "open_h264" | "software" => Self::OpenH264,
            "nvenc" => Self::Nvenc,
            "nvenc_sdk" => Self::NvencSdk,
            _ => Self::Auto,
        }
    }

    fn as_label(&self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::OpenH264 => "openh264",
            Self::Nvenc => "nvenc",
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
        // Auto path: try nvenc_sdk first, then nvenc (FFmpeg), then openh264
        let nvenc_sdk_error = match try_build_nvenc_sdk_backend(target_fps, target_bitrate_kbps) {
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
            Err(e) => Some(e),
        };

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
            Err(nvenc_error) => {
                // Combine both errors for the fallback reason
                let fallback_reason = match nvenc_sdk_error {
                    Some(sdk_err) => {
                        Some(format!("nvenc_sdk: {}; nvenc: {}", sdk_err, nvenc_error))
                    }
                    None => Some(nvenc_error),
                };
                return Ok((
                    create_openh264_backend(target_fps, target_bitrate_kbps),
                    EncoderBackendSelection {
                        requested_backend,
                        selected_backend: "openh264",
                        fallback_reason,
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
                        .unwrap_or(EncoderPreference::Auto)
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
                        .unwrap_or(EncoderPreference::Auto)
                        .as_label(),
                    selected_backend: "ffmpeg-vp9",
                    fallback_reason: None,
                },
            ))
        }
        NativeCodecTarget::Av1 => {
            let backend = try_build_av1_backend(target_fps, target_bitrate_kbps)
                .map_err(|error| format!("native_sender_encoder_not_available: {error}"))?;
            Ok((
                backend,
                EncoderBackendSelection {
                    requested_backend: preference_override
                        .map(EncoderPreference::from_label)
                        .unwrap_or(EncoderPreference::Auto)
                        .as_label(),
                    selected_backend: "ffmpeg-av1",
                    fallback_reason: None,
                },
            ))
        }
    }
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
