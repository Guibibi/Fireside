use super::ffmpeg_backend::{build_ffmpeg_backend, probe_ffmpeg_backend};
use super::metrics::NativeSenderSharedMetrics;

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

pub struct EncoderBackendSelection {
    pub requested_backend: &'static str,
    pub selected_backend: &'static str,
    pub fallback_reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EncoderPreference {
    Auto,
    H264Nvenc,
    H264Qsv,
    H264Amf,
    Libx264,
}

impl EncoderPreference {
    fn from_label(raw: &str) -> Self {
        match raw.trim().to_lowercase().as_str() {
            "h264_nvenc" | "nvenc" | "nvenc_sdk" => Self::H264Nvenc,
            "h264_qsv" => Self::H264Qsv,
            "h264_amf" => Self::H264Amf,
            "libx264" | "x264" | "software" => Self::Libx264,
            _ => Self::Auto,
        }
    }

    fn as_label(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::H264Nvenc => "h264_nvenc",
            Self::H264Qsv => "h264_qsv",
            Self::H264Amf => "h264_amf",
            Self::Libx264 => "libx264",
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

    let candidates: Vec<EncoderPreference> = match preference {
        EncoderPreference::Auto => vec![
            EncoderPreference::H264Nvenc,
            EncoderPreference::H264Qsv,
            EncoderPreference::H264Amf,
            EncoderPreference::Libx264,
        ],
        explicit => vec![explicit],
    };

    let mut probe_failures = Vec::new();
    let mut selected = None;

    for candidate in candidates {
        match probe_ffmpeg_backend(candidate.as_label()) {
            Ok(()) => {
                selected = Some(candidate);
                break;
            }
            Err(error) => {
                probe_failures.push(format!("{}: {}", candidate.as_label(), error));
            }
        }
    }

    let Some(selected_backend) = selected else {
        return Err(format!(
            "no encoder available — {}",
            probe_failures.join("; ")
        ));
    };

    let backend =
        build_ffmpeg_backend(target_fps, target_bitrate_kbps, selected_backend.as_label())?;

    let fallback_reason = if preference == EncoderPreference::Auto && !probe_failures.is_empty() {
        Some(probe_failures.join("; "))
    } else {
        None
    };

    Ok((
        backend,
        EncoderBackendSelection {
            requested_backend,
            selected_backend: selected_backend.as_label(),
            fallback_reason,
        },
    ))
}

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
