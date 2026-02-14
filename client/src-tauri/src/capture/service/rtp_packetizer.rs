use super::rtp_sender::{FeedbackPollResult, NativeRtpSender};

pub trait RtpPacketizer: Send {
    fn transport_connected(&self) -> bool;
    fn send_encoded_frames(&mut self, frames: &[Vec<u8>], timestamp_ms: u64) -> usize;
    fn poll_feedback(&mut self) -> FeedbackPollResult;
    fn take_and_reset_error_reason(&mut self) -> Option<String>;
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

    fn send_encoded_frames(&mut self, frames: &[Vec<u8>], timestamp_ms: u64) -> usize {
        self.sender.send_h264_nalus(frames, timestamp_ms)
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

pub struct Vp8RtpPacketizer {
    sender: NativeRtpSender,
}

impl Vp8RtpPacketizer {
    pub fn new(target: Option<String>, payload_type: u8, ssrc: u32) -> Self {
        Self {
            sender: NativeRtpSender::new(target, payload_type, ssrc),
        }
    }
}

impl RtpPacketizer for Vp8RtpPacketizer {
    fn transport_connected(&self) -> bool {
        self.sender.transport_connected()
    }

    fn send_encoded_frames(&mut self, frames: &[Vec<u8>], timestamp_ms: u64) -> usize {
        self.sender.send_vp8_frames(frames, timestamp_ms)
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

pub struct Vp9RtpPacketizer {
    sender: NativeRtpSender,
}

impl Vp9RtpPacketizer {
    pub fn new(target: Option<String>, payload_type: u8, ssrc: u32) -> Self {
        Self {
            sender: NativeRtpSender::new(target, payload_type, ssrc),
        }
    }
}

impl RtpPacketizer for Vp9RtpPacketizer {
    fn transport_connected(&self) -> bool {
        self.sender.transport_connected()
    }

    fn send_encoded_frames(&mut self, frames: &[Vec<u8>], timestamp_ms: u64) -> usize {
        self.sender.send_vp9_frames(frames, timestamp_ms)
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

pub struct Av1RtpPacketizer {
    sender: NativeRtpSender,
    unsupported_error_pending: bool,
}

impl Av1RtpPacketizer {
    pub fn new(target: Option<String>, payload_type: u8, ssrc: u32) -> Self {
        Self {
            sender: NativeRtpSender::new(target, payload_type, ssrc),
            unsupported_error_pending: false,
        }
    }
}

impl RtpPacketizer for Av1RtpPacketizer {
    fn transport_connected(&self) -> bool {
        self.sender.transport_connected()
    }

    fn send_encoded_frames(&mut self, _frames: &[Vec<u8>], _timestamp_ms: u64) -> usize {
        self.unsupported_error_pending = true;
        0
    }

    fn poll_feedback(&mut self) -> FeedbackPollResult {
        self.sender.poll_feedback()
    }

    fn take_and_reset_error_reason(&mut self) -> Option<String> {
        if self.unsupported_error_pending {
            self.unsupported_error_pending = false;
            return Some("packetizer_not_implemented_av1".to_string());
        }
        if self.sender.take_and_reset_error() {
            return Some("udp_send_failed".to_string());
        }

        None
    }
}
