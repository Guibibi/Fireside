use mediasoup::prelude::{
    MimeTypeAudio, MimeTypeVideo, RtcpFeedback, RtpCodecCapability, RtpCodecParametersParameters,
};

#[derive(Debug, Clone, Default)]
pub struct OpusConfig {
    pub bitrate: Option<u32>,
    pub dtx: Option<bool>,
    pub fec: Option<bool>,
}

fn build_opus_parameters(config: &OpusConfig) -> RtpCodecParametersParameters {
    let mut params = RtpCodecParametersParameters::default();

    if let Some(bitrate) = config.bitrate {
        params.insert("maxaveragebitrate", bitrate);
    }

    if let Some(dtx) = config.dtx {
        params.insert("usedtx", if dtx { 1_u32 } else { 0_u32 });
    }

    if let Some(fec) = config.fec {
        params.insert("useinbandfec", if fec { 1_u32 } else { 0_u32 });
    }

    params
}

fn video_rtcp_feedback() -> Vec<RtcpFeedback> {
    vec![
        RtcpFeedback::Nack,
        RtcpFeedback::NackPli,
        RtcpFeedback::CcmFir,
        RtcpFeedback::GoogRemb,
        RtcpFeedback::TransportCc,
    ]
}

fn h264_codec_parameters() -> RtpCodecParametersParameters {
    let mut parameters = RtpCodecParametersParameters::default();
    parameters
        .insert("level-asymmetry-allowed", 1_u32)
        .insert("packetization-mode", 1_u32)
        .insert("profile-level-id", "42e01f");
    parameters
}

pub fn media_codecs(opus_config: Option<&OpusConfig>) -> Vec<RtpCodecCapability> {
    let opus_params = opus_config.map(build_opus_parameters).unwrap_or_default();

    vec![
        RtpCodecCapability::Audio {
            mime_type: MimeTypeAudio::Opus,
            preferred_payload_type: None,
            clock_rate: 48000.try_into().unwrap(),
            channels: 2.try_into().unwrap(),
            parameters: opus_params,
            rtcp_feedback: vec![RtcpFeedback::TransportCc],
        },
        RtpCodecCapability::Video {
            mime_type: MimeTypeVideo::Vp8,
            preferred_payload_type: None,
            clock_rate: 90000.try_into().unwrap(),
            parameters: RtpCodecParametersParameters::default(),
            rtcp_feedback: video_rtcp_feedback(),
        },
        RtpCodecCapability::Video {
            mime_type: MimeTypeVideo::H264,
            preferred_payload_type: None,
            clock_rate: 90000.try_into().unwrap(),
            parameters: h264_codec_parameters(),
            rtcp_feedback: video_rtcp_feedback(),
        },
        RtpCodecCapability::Video {
            mime_type: MimeTypeVideo::Vp9,
            preferred_payload_type: None,
            clock_rate: 90000.try_into().unwrap(),
            parameters: RtpCodecParametersParameters::default(),
            rtcp_feedback: video_rtcp_feedback(),
        },
        RtpCodecCapability::Video {
            mime_type: MimeTypeVideo::AV1,
            preferred_payload_type: None,
            clock_rate: 90000.try_into().unwrap(),
            parameters: RtpCodecParametersParameters::default(),
            rtcp_feedback: video_rtcp_feedback(),
        },
    ]
}
