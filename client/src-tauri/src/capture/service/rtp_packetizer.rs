use super::rtp_sender::{FeedbackPollResult, NativeRtpSender};

pub trait RtpPacketizer: Send {
    fn transport_connected(&self) -> bool;
    fn send_nalus(&mut self, nals: &[Vec<u8>], timestamp_ms: u64) -> usize;
    fn poll_feedback(&mut self) -> FeedbackPollResult;
    fn take_and_reset_error(&mut self) -> bool;
}

pub struct H264RtpPacketizer {
    sender: NativeRtpSender,
}

impl H264RtpPacketizer {
    pub fn new(target: Option<String>, payload_type: u8, ssrc: u32) -> Self {
        Self {
            sender: NativeRtpSender::new(target, payload_type, ssrc),
        }
    }
}

impl RtpPacketizer for H264RtpPacketizer {
    fn transport_connected(&self) -> bool {
        self.sender.transport_connected()
    }

    fn send_nalus(&mut self, nals: &[Vec<u8>], timestamp_ms: u64) -> usize {
        self.sender.send_h264_nalus(nals, timestamp_ms)
    }

    fn poll_feedback(&mut self) -> FeedbackPollResult {
        self.sender.poll_feedback()
    }

    fn take_and_reset_error(&mut self) -> bool {
        self.sender.take_and_reset_error()
    }
}
