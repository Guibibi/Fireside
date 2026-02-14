use mediasoup::prelude::{
    MimeTypeAudio, MimeTypeVideo, RtcpFeedback, RtpCodecCapability, RtpCodecParametersParameters,
};

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

pub fn media_codecs() -> Vec<RtpCodecCapability> {
    vec![
        RtpCodecCapability::Audio {
            mime_type: MimeTypeAudio::Opus,
            preferred_payload_type: None,
            clock_rate: 48000.try_into().unwrap(),
            channels: 2.try_into().unwrap(),
            parameters: RtpCodecParametersParameters::default(),
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
