use std::net::{SocketAddr, UdpSocket};

pub struct CanonicalH264RtpParameters {
    pub mime_type: &'static str,
    pub clock_rate: u32,
    pub packetization_mode: u8,
    pub profile_level_id: &'static str,
}

pub fn canonical_h264_rtp_parameters() -> CanonicalH264RtpParameters {
    CanonicalH264RtpParameters {
        mime_type: "video/H264",
        clock_rate: 90_000,
        packetization_mode: 1,
        profile_level_id: "42e01f",
    }
}

#[derive(Debug)]
pub struct NativeRtpSender {
    socket: Option<UdpSocket>,
    target: Option<SocketAddr>,
    payload_type: u8,
    sequence_number: u16,
    ssrc: u32,
    mtu: usize,
    had_send_error: bool,
}

impl NativeRtpSender {
    pub fn new(target: Option<String>, payload_type: u8, ssrc: u32) -> Self {
        let parsed_target = target
            .as_deref()
            .and_then(|value| value.parse::<SocketAddr>().ok());
        let socket = parsed_target.and_then(|address| {
            let bind_address = if address.is_ipv4() {
                "0.0.0.0:0"
            } else {
                "[::]:0"
            };
            UdpSocket::bind(bind_address).ok()
        });

        Self {
            socket,
            target: parsed_target,
            payload_type,
            sequence_number: 1,
            ssrc,
            mtu: 1200,
            had_send_error: false,
        }
    }

    pub fn transport_connected(&self) -> bool {
        self.socket.is_some() && self.target.is_some()
    }

    pub fn send_h264_nalus(&mut self, nals: &[Vec<u8>], timestamp_ms: u64) -> usize {
        let mut sent = 0usize;
        let rtp_timestamp = timestamp_ms.wrapping_mul(90) as u32;

        for (index, nal) in nals.iter().enumerate() {
            let is_last_nal = index + 1 == nals.len();
            sent = sent.saturating_add(self.send_nal(nal, rtp_timestamp, is_last_nal));
        }

        sent
    }

    fn send_nal(&mut self, nal: &[u8], rtp_timestamp: u32, marker: bool) -> usize {
        if nal.is_empty() {
            return 0;
        }

        let max_payload = self.mtu.saturating_sub(12);
        if nal.len() <= max_payload {
            let mut packet = Vec::with_capacity(12 + nal.len());
            packet.extend_from_slice(&self.build_rtp_header(rtp_timestamp, marker));
            packet.extend_from_slice(nal);
            self.write_packet(&packet);
            return 1;
        }

        if nal.len() <= 1 || max_payload <= 2 {
            return 0;
        }

        let nal_header = nal[0];
        let nal_type = nal_header & 0x1F;
        let fu_indicator = (nal_header & 0xE0) | 28;
        let chunk_size = max_payload - 2;
        let mut offset = 1usize;
        let mut packets = 0usize;

        while offset < nal.len() {
            let remaining = nal.len() - offset;
            let payload_len = remaining.min(chunk_size);
            let is_first = offset == 1;
            let is_last = offset + payload_len >= nal.len();

            let mut fu_header = nal_type;
            if is_first {
                fu_header |= 0x80;
            }
            if is_last {
                fu_header |= 0x40;
            }

            let mut packet = Vec::with_capacity(14 + payload_len);
            packet.extend_from_slice(&self.build_rtp_header(rtp_timestamp, marker && is_last));
            packet.push(fu_indicator);
            packet.push(fu_header);
            packet.extend_from_slice(&nal[offset..offset + payload_len]);
            self.write_packet(&packet);

            offset += payload_len;
            packets += 1;
        }

        packets
    }

    fn build_rtp_header(&mut self, timestamp: u32, marker: bool) -> [u8; 12] {
        let mut header = [0u8; 12];
        header[0] = 0x80;
        header[1] = self.payload_type & 0x7F;
        if marker {
            header[1] |= 0x80;
        }

        let sequence = self.sequence_number;
        self.sequence_number = self.sequence_number.wrapping_add(1);
        header[2..4].copy_from_slice(&sequence.to_be_bytes());
        header[4..8].copy_from_slice(&timestamp.to_be_bytes());
        header[8..12].copy_from_slice(&self.ssrc.to_be_bytes());
        header
    }

    fn write_packet(&mut self, packet: &[u8]) {
        let Some(socket) = self.socket.as_ref() else {
            return;
        };
        let Some(target) = self.target else {
            return;
        };

        if socket.send_to(packet, target).is_err() {
            self.had_send_error = true;
        }
    }

    pub fn take_and_reset_error(&mut self) -> bool {
        let had_error = self.had_send_error;
        self.had_send_error = false;
        had_error
    }
}
