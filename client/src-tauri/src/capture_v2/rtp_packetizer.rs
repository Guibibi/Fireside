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

/// Parse a contiguous H264 bitstream (with or without Annex-B start codes) into NAL units.
fn parse_nal_units(data: &[u8]) -> Vec<&[u8]> {
    let mut units = Vec::new();
    let mut i = 0;

    while i < data.len() {
        // Skip Annex-B start code (0x00 0x00 0x01 or 0x00 0x00 0x00 0x01).
        if i + 3 <= data.len() && data[i] == 0x00 && data[i + 1] == 0x00 {
            if data[i + 2] == 0x01 {
                i += 3;
            } else if i + 4 <= data.len() && data[i + 2] == 0x00 && data[i + 3] == 0x01 {
                i += 4;
            } else {
                i += 1;
                continue;
            }
        } else if i > 0 {
            i += 1;
            continue;
        } else {
            // No start code found — treat the whole buffer as one NAL unit.
            units.push(data);
            return units;
        }

        // Find the end of this NAL unit (next start code or end of buffer).
        let start = i;
        while i < data.len() {
            if i + 3 <= data.len() && data[i] == 0x00 && data[i + 1] == 0x00 {
                if data[i + 2] == 0x01 {
                    break;
                } else if i + 4 <= data.len() && data[i + 2] == 0x00 && data[i + 3] == 0x01 {
                    break;
                }
            }
            i += 1;
        }

        // Trim trailing zero bytes that are part of the next start code prefix.
        let mut end = i;
        while end > start && data[end - 1] == 0x00 {
            end -= 1;
        }

        if end > start {
            units.push(&data[start..end]);
        }
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
