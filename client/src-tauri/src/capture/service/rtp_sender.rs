use std::net::{SocketAddr, UdpSocket};

#[derive(Debug, Default, Clone, Copy)]
pub struct FeedbackPollResult {
    pub keyframe_requests: u64,
}

const RTCP_PACKET_TYPE_PSFB: u8 = 206;
const RTCP_FMT_PLI: u8 = 1;
const RTCP_FMT_FIR: u8 = 4;

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
            let socket = UdpSocket::bind(bind_address).ok()?;
            socket.set_nonblocking(true).ok()?;
            Some(socket)
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

    pub fn poll_feedback(&mut self) -> FeedbackPollResult {
        let Some(socket) = self.socket.as_ref() else {
            return FeedbackPollResult::default();
        };

        let mut requests = 0u64;
        let mut buffer = [0u8; 2048];

        loop {
            match socket.recv_from(&mut buffer) {
                Ok((size, _)) => {
                    requests = requests.saturating_add(parse_keyframe_requests(&buffer[..size]));
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    break;
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {
                    continue;
                }
                Err(_) => {
                    self.had_send_error = true;
                    break;
                }
            }
        }

        FeedbackPollResult {
            keyframe_requests: requests,
        }
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

        loop {
            match socket.send_to(packet, target) {
                Ok(_) => break,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {
                    continue;
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    break;
                }
                Err(_) => {
                    self.had_send_error = true;
                    break;
                }
            }
        }
    }

    pub fn take_and_reset_error(&mut self) -> bool {
        let had_error = self.had_send_error;
        self.had_send_error = false;
        had_error
    }
}

fn parse_keyframe_requests(packet: &[u8]) -> u64 {
    let mut requests = 0u64;
    let mut offset = 0usize;

    while offset + 4 <= packet.len() {
        let first = packet[offset];
        let version = first >> 6;
        if version != 2 {
            break;
        }

        let fmt = first & 0x1F;
        let packet_type = packet[offset + 1];
        let words_minus_one = u16::from_be_bytes([packet[offset + 2], packet[offset + 3]]) as usize;
        let block_len = words_minus_one.saturating_add(1).saturating_mul(4);

        if block_len == 0 || offset + block_len > packet.len() {
            break;
        }

        if packet_type == RTCP_PACKET_TYPE_PSFB {
            if fmt == RTCP_FMT_PLI {
                requests = requests.saturating_add(1);
            } else if fmt == RTCP_FMT_FIR {
                let fir_entries = block_len.saturating_sub(12) / 8;
                let fir_count = fir_entries.max(1) as u64;
                requests = requests.saturating_add(fir_count);
            }
        }

        offset = offset.saturating_add(block_len);
    }

    requests
}
