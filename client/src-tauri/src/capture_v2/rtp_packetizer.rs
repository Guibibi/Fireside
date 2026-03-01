//! H264 RTP packetization per RFC 6184 (packetization-mode=1).
//!
//! Handles Single NAL Unit packets and FU-A fragmentation.

const MTU: usize = 1200;
const RTP_HEADER_SIZE: usize = 12;
const FU_HEADER_SIZE: usize = 2; // FU indicator + FU header

/// Build an RTP packet with the given 12-byte header and payload.
fn build_rtp_packet(header: &[u8; RTP_HEADER_SIZE], payload: &[u8]) -> Vec<u8> {
    let mut pkt = Vec::with_capacity(RTP_HEADER_SIZE + payload.len());
    pkt.extend_from_slice(header);
    pkt.extend_from_slice(payload);
    pkt
}

/// Construct a 12-byte RTP fixed header.
fn make_header(seq: u16, timestamp: u32, ssrc: u32, marker: bool) -> [u8; RTP_HEADER_SIZE] {
    let mut h = [0u8; RTP_HEADER_SIZE];
    // V=2, P=0, X=0, CC=0
    h[0] = 0x80;
    // M bit + PT=96
    h[1] = if marker { 0x80 | 96 } else { 96 };
    // Sequence number (big-endian)
    h[2] = (seq >> 8) as u8;
    h[3] = seq as u8;
    // Timestamp (big-endian)
    h[4] = (timestamp >> 24) as u8;
    h[5] = (timestamp >> 16) as u8;
    h[6] = (timestamp >> 8) as u8;
    h[7] = timestamp as u8;
    // SSRC (big-endian)
    h[8] = (ssrc >> 24) as u8;
    h[9] = (ssrc >> 16) as u8;
    h[10] = (ssrc >> 8) as u8;
    h[11] = ssrc as u8;
    h
}

fn find_start_code(data: &[u8], from: usize) -> Option<(usize, usize)> {
    let mut i = from;
    while i + 3 <= data.len() {
        if data[i] == 0x00 && data[i + 1] == 0x00 {
            if data[i + 2] == 0x01 {
                return Some((i, 3));
            }
            if i + 4 <= data.len() && data[i + 2] == 0x00 && data[i + 3] == 0x01 {
                return Some((i, 4));
            }
        }
        i += 1;
    }
    None
}

/// Parse a contiguous H264 bitstream (with or without Annex-B start codes) into NAL units.
fn parse_nal_units(data: &[u8]) -> Vec<&[u8]> {
    // Some encoders emit a single NALU without Annex-B prefixes. Keep that path.
    let Some((first_start, first_prefix_len)) = find_start_code(data, 0) else {
        return if data.is_empty() { vec![] } else { vec![data] };
    };

    let mut units = Vec::new();
    let mut nal_start = first_start + first_prefix_len;

    loop {
        let Some((next_start, next_prefix_len)) = find_start_code(data, nal_start) else {
            if nal_start < data.len() {
                units.push(&data[nal_start..]);
            }
            break;
        };

        if next_start > nal_start {
            units.push(&data[nal_start..next_start]);
        }
        nal_start = next_start + next_prefix_len;
    }

    units
}

/// Packetize an H264 access unit (one or more NAL units) into RTP packets.
///
/// Returns a `Vec<Vec<u8>>` where each element is a complete RTP packet.
/// The caller should increment `seq` by `packets.len()` and `ts` by one frame's
/// worth of 90kHz ticks after this call.
pub fn packetize(data: &[u8], mut seq: u16, timestamp: u32, ssrc: u32) -> Vec<Vec<u8>> {
    let nal_units = parse_nal_units(data);
    let total_nalus = nal_units.len();
    let mut packets = Vec::new();

    for (nalu_idx, nal) in nal_units.iter().enumerate() {
        let is_last_nalu = nalu_idx + 1 == total_nalus;

        if nal.len() <= MTU - RTP_HEADER_SIZE {
            // Single NAL Unit packet.
            let marker = is_last_nalu;
            let hdr = make_header(seq, timestamp, ssrc, marker);
            packets.push(build_rtp_packet(&hdr, nal));
            seq = seq.wrapping_add(1);
        } else {
            // FU-A fragmentation.
            let nal_type = nal[0] & 0x1F;
            let nal_nri = nal[0] & 0x60;
            let fu_indicator = nal_nri | 28u8; // keep NRI from source NAL, type=28 (FU-A)
            let payload_mtu = MTU - RTP_HEADER_SIZE - FU_HEADER_SIZE;

            let mut offset = 1; // skip the original NAL header byte
            let mut is_first = true;

            while offset < nal.len() {
                let end = (offset + payload_mtu).min(nal.len());
                let is_last_frag = end == nal.len();
                let marker = is_last_nalu && is_last_frag;

                let start_bit: u8 = if is_first { 0x80 } else { 0x00 };
                let end_bit: u8 = if is_last_frag { 0x40 } else { 0x00 };
                let fu_header = start_bit | end_bit | nal_type;

                let hdr = make_header(seq, timestamp, ssrc, marker);
                let mut pkt = Vec::with_capacity(RTP_HEADER_SIZE + FU_HEADER_SIZE + (end - offset));
                pkt.extend_from_slice(&hdr);
                pkt.push(fu_indicator);
                pkt.push(fu_header);
                pkt.extend_from_slice(&nal[offset..end]);
                packets.push(pkt);

                seq = seq.wrapping_add(1);
                offset = end;
                is_first = false;
            }
        }
    }

    packets
}
