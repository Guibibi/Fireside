use mediasoup::prelude::{
    MimeTypeVideo, RtcpFeedback, RtcpParameters, RtpCodecParameters, RtpCodecParametersParameters,
    RtpEncodingParameters, RtpParameters,
};
use serde::Serialize;
use uuid::Uuid;

pub(super) const NATIVE_H264_CLOCK_RATE: u32 = 90_000;
pub(super) const NATIVE_H264_PT: u8 = 96;
pub(super) const NATIVE_H264_PACKETIZATION_MODE: u8 = 1;
pub(super) const NATIVE_H264_PROFILE_LEVEL_ID: &str = "42e01f";
const NATIVE_VP8_CLOCK_RATE: u32 = 90_000;
const NATIVE_VP8_PT: u8 = 98;
const NATIVE_VP9_CLOCK_RATE: u32 = 90_000;
const NATIVE_VP9_PT: u8 = 100;
const NATIVE_AV1_CLOCK_RATE: u32 = 90_000;
const NATIVE_AV1_PT: u8 = 102;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeCodecReadiness {
    Ready,
    Planned,
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeCodecDescriptor {
    pub mime_type: String,
    pub clock_rate: u32,
    pub payload_type: u8,
    pub packetization_mode: Option<u8>,
    pub profile_level_id: Option<String>,
    pub readiness: NativeCodecReadiness,
}

#[derive(Debug, Clone, Copy)]
pub(super) enum NativeVideoCodec {
    H264,
    Vp8,
    Vp9,
    Av1,
}

impl NativeVideoCodec {
    fn from_mime_type(value: &str) -> Option<Self> {
        if value.eq_ignore_ascii_case("video/h264") {
            return Some(Self::H264);
        }
        if value.eq_ignore_ascii_case("video/vp8") {
            return Some(Self::Vp8);
        }
        if value.eq_ignore_ascii_case("video/vp9") {
            return Some(Self::Vp9);
        }
        if value.eq_ignore_ascii_case("video/av1") {
            return Some(Self::Av1);
        }

        None
    }

    pub fn from_preference_list(preferred_codecs: Option<&[String]>) -> Self {
        let Some(preferred_codecs) = preferred_codecs else {
            return Self::H264;
        };

        preferred_codecs
            .iter()
            .find_map(|codec| {
                let parsed = Self::from_mime_type(codec)?;
                if parsed.readiness() == NativeCodecReadiness::Ready {
                    return Some(parsed);
                }

                None
            })
            .unwrap_or(Self::H264)
    }

    pub fn all_for_advertisement() -> [Self; 4] {
        [Self::H264, Self::Vp8, Self::Vp9, Self::Av1]
    }

    fn mime_type(self) -> &'static str {
        match self {
            Self::H264 => "video/H264",
            Self::Vp8 => "video/VP8",
            Self::Vp9 => "video/VP9",
            Self::Av1 => "video/AV1",
        }
    }

    pub fn payload_type(self) -> u8 {
        match self {
            Self::H264 => NATIVE_H264_PT,
            Self::Vp8 => NATIVE_VP8_PT,
            Self::Vp9 => NATIVE_VP9_PT,
            Self::Av1 => NATIVE_AV1_PT,
        }
    }

    pub fn clock_rate(self) -> u32 {
        match self {
            Self::H264 => NATIVE_H264_CLOCK_RATE,
            Self::Vp8 => NATIVE_VP8_CLOCK_RATE,
            Self::Vp9 => NATIVE_VP9_CLOCK_RATE,
            Self::Av1 => NATIVE_AV1_CLOCK_RATE,
        }
    }

    pub fn packetization_mode(self) -> Option<u8> {
        match self {
            Self::H264 => Some(NATIVE_H264_PACKETIZATION_MODE),
            Self::Vp8 | Self::Vp9 | Self::Av1 => None,
        }
    }

    pub fn profile_level_id(self) -> Option<&'static str> {
        match self {
            Self::H264 => Some(NATIVE_H264_PROFILE_LEVEL_ID),
            Self::Vp8 | Self::Vp9 | Self::Av1 => None,
        }
    }

    fn readiness(self) -> NativeCodecReadiness {
        match self {
            Self::H264 | Self::Vp8 | Self::Vp9 | Self::Av1 => NativeCodecReadiness::Ready,
        }
    }

    pub fn descriptor(self) -> NativeCodecDescriptor {
        NativeCodecDescriptor {
            mime_type: self.mime_type().to_string(),
            clock_rate: self.clock_rate(),
            payload_type: self.payload_type(),
            packetization_mode: self.packetization_mode(),
            profile_level_id: self.profile_level_id().map(str::to_string),
            readiness: self.readiness(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeSenderSession {
    pub producer_id: String,
    pub kind: String,
    pub source: String,
    pub routing_mode: String,
    pub rtp_target: String,
    pub payload_type: u8,
    pub ssrc: u32,
    pub mime_type: String,
    pub clock_rate: u32,
    pub packetization_mode: u8,
    pub profile_level_id: String,
    pub codec: NativeCodecDescriptor,
    pub available_codecs: Vec<NativeCodecDescriptor>,
    pub owner_connection_id: Uuid,
}

pub(super) fn canonical_native_ssrc(connection_id: Uuid) -> u32 {
    let bytes = connection_id.as_bytes();
    let mut seed = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    if seed == 0 {
        seed = 0x4E41_5456;
    }
    seed
}

pub(super) fn native_rtp_parameters(codec: NativeVideoCodec, ssrc: u32) -> RtpParameters {
    let mut parameters = RtpCodecParametersParameters::default();
    if let Some(packetization_mode) = codec.packetization_mode() {
        parameters.insert("packetization-mode", packetization_mode as u32);
    }
    if let Some(profile_level_id) = codec.profile_level_id() {
        parameters
            .insert("level-asymmetry-allowed", 1_u32)
            .insert("profile-level-id", profile_level_id);
    }

    let mime_type = match codec {
        NativeVideoCodec::H264 => MimeTypeVideo::H264,
        NativeVideoCodec::Vp8 => MimeTypeVideo::Vp8,
        NativeVideoCodec::Vp9 => MimeTypeVideo::Vp9,
        NativeVideoCodec::Av1 => MimeTypeVideo::AV1,
    };
    let payload_type = codec.payload_type();
    let clock_rate = codec.clock_rate();

    RtpParameters {
        mid: Some("native-screen".to_string()),
        codecs: vec![RtpCodecParameters::Video {
            mime_type,
            payload_type,
            clock_rate: clock_rate.try_into().unwrap(),
            parameters,
            rtcp_feedback: vec![RtcpFeedback::NackPli, RtcpFeedback::CcmFir],
        }],
        header_extensions: vec![],
        encodings: vec![RtpEncodingParameters {
            ssrc: Some(ssrc),
            rid: None,
            codec_payload_type: Some(payload_type),
            rtx: None,
            dtx: None,
            scalability_mode: Default::default(),
            max_bitrate: None,
        }],
        rtcp: RtcpParameters {
            cname: Some(format!("native-{ssrc:x}")),
            reduced_size: true,
        },
    }
}
