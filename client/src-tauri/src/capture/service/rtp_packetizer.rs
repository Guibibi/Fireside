use super::rtp_sender::{FeedbackPollResult, NativeRtpSender};

pub trait RtpPacketizer: Send {
    fn transport_connected(&self) -> bool;
    fn send_encoded_frames(&mut self, frames: &[Vec<u8>], timestamp_ms: u64) -> usize;
    fn poll_feedback(&mut self) -> FeedbackPollResult;
    fn take_and_reset_error_reason(&mut self) -> Option<String>;
}

pub enum RtpCodecKind {
    H264,
    Vp8,
    Vp9,
    Av1,
}

pub struct CodecRtpPacketizer {
    sender: NativeRtpSender,
    codec: RtpCodecKind,
}

impl CodecRtpPacketizer {
    pub fn new(codec: RtpCodecKind, target: Option<String>, payload_type: u8, ssrc: u32) -> Self {
        Self {
            sender: NativeRtpSender::new(target, payload_type, ssrc),
            codec,
        }
    }
}

impl RtpPacketizer for CodecRtpPacketizer {
    fn transport_connected(&self) -> bool {
        self.sender.transport_connected()
    }

    fn send_encoded_frames(&mut self, frames: &[Vec<u8>], timestamp_ms: u64) -> usize {
        match self.codec {
            RtpCodecKind::H264 => self.sender.send_h264_nalus(frames, timestamp_ms),
            RtpCodecKind::Vp8 => self.sender.send_vp8_frames(frames, timestamp_ms),
            RtpCodecKind::Vp9 => self.sender.send_vp9_frames(frames, timestamp_ms),
            RtpCodecKind::Av1 => self.sender.send_av1_frames(frames, timestamp_ms),
        }
    }

    fn poll_feedback(&mut self) -> FeedbackPollResult {
        self.sender.poll_feedback()
    }

    fn take_and_reset_error_reason(&mut self) -> Option<String> {
        if self.sender.take_and_reset_error() {
            return Some("udp_send_failed".to_string());
        }

        None
    }
}
