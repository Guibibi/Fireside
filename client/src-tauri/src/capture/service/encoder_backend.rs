use super::metrics::NativeSenderSharedMetrics;
use super::nvenc_sdk::try_build_nvenc_sdk_backend;
use super::x264_encoder::try_build_x264_backend;

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

pub struct EncoderBackendSelection {
    pub requested_backend: &'static str,
    pub selected_backend: &'static str,
    pub fallback_reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EncoderPreference {
    Auto,
    NvencSdk,
    X264,
}

impl EncoderPreference {
    fn from_label(raw: &str) -> Self {
        let normalized = raw.trim().to_lowercase();
        match normalized.as_str() {
            "nvenc_sdk" => Self::NvencSdk,
            "x264" | "software" => Self::X264,
            _ => Self::Auto,
        }
    }

    fn as_label(&self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::NvencSdk => "nvenc_sdk",
            Self::X264 => "x264",
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

    // Explicit x264 request
    if preference == EncoderPreference::X264 {
        return match try_build_x264_backend(target_fps, target_bitrate_kbps) {
            Ok(backend) => Ok((
                backend,
                EncoderBackendSelection {
                    requested_backend,
                    selected_backend: "x264",
                    fallback_reason: None,
                },
            )),
            Err(error) => Err(error),
        };
    }

    // Auto: try nvenc_sdk first, then x264 fallback
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
        Err(e) => e,
    };

    match try_build_x264_backend(target_fps, target_bitrate_kbps) {
        Ok(backend) => Ok((
            backend,
            EncoderBackendSelection {
                requested_backend,
                selected_backend: "x264",
                fallback_reason: Some(format!("nvenc_sdk: {}", nvenc_sdk_error)),
            },
        )),
        Err(x264_error) => Err(format!(
            "no encoder available — nvenc_sdk: {}; x264: {}",
            nvenc_sdk_error, x264_error
        )),
    }
}

/// Split an Annex B H.264/H.265 bitstream into individual NAL units,
/// stripping the start code prefixes (0x000001 or 0x00000001).
/// Used by nvenc_sdk and x264_encoder.
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
