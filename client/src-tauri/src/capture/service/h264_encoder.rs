use openh264::encoder::{BitRate, Encoder, EncoderConfig, FrameRate, Profile, UsageType};
use openh264::formats::{BgraSliceU8, YUVBuffer};
use std::sync::atomic::Ordering;

use super::metrics::NativeSenderSharedMetrics;

pub fn build_h264_encoder(
    target_fps: Option<u32>,
    target_bitrate_kbps: Option<u32>,
) -> Option<Encoder> {
    let fps = target_fps.unwrap_or(30).max(1);
    let bitrate_bps = target_bitrate_kbps
        .unwrap_or(8_000)
        .saturating_mul(1000)
        .max(500_000);

    let config = EncoderConfig::new()
        .usage_type(UsageType::ScreenContentRealTime)
        .profile(Profile::Baseline)
        .max_frame_rate(FrameRate::from_hz(fps as f32))
        .bitrate(BitRate::from_bps(bitrate_bps));

    Encoder::with_api_config(openh264::OpenH264API::from_source(), config).ok()
}

pub fn encode_bgra_frame(
    encoder: &mut Option<Encoder>,
    bgra: &[u8],
    width: u32,
    height: u32,
    shared: &NativeSenderSharedMetrics,
) -> Option<Vec<Vec<u8>>> {
    if width == 0 || height == 0 || width % 2 != 0 || height % 2 != 0 {
        shared.encode_errors.fetch_add(1, Ordering::Relaxed);
        return None;
    }

    let Some(active_encoder) = encoder.as_mut() else {
        shared.encode_errors.fetch_add(1, Ordering::Relaxed);
        return None;
    };

    let expected_len = width as usize * height as usize * 4;
    if bgra.len() != expected_len {
        shared.encode_errors.fetch_add(1, Ordering::Relaxed);
        return None;
    }

    let source = BgraSliceU8::new(bgra, (width as usize, height as usize));
    let yuv = YUVBuffer::from_rgb_source(source);
    let bitstream = match active_encoder.encode(&yuv) {
        Ok(stream) => stream,
        Err(error) => {
            shared.encode_errors.fetch_add(1, Ordering::Relaxed);
            eprintln!("[native-sender] event=encode_error detail=\"{error}\"");
            return None;
        }
    };

    let mut nals = Vec::new();
    for layer_index in 0..bitstream.num_layers() {
        let Some(layer) = bitstream.layer(layer_index) else {
            continue;
        };
        for nal_index in 0..layer.nal_count() {
            let Some(nal) = layer.nal_unit(nal_index) else {
                continue;
            };
            let clean = strip_annex_b_start_code(nal);
            if !clean.is_empty() {
                nals.push(clean.to_vec());
            }
        }
    }

    if nals.is_empty() {
        shared.encode_errors.fetch_add(1, Ordering::Relaxed);
        return None;
    }

    Some(nals)
}

fn strip_annex_b_start_code(nal: &[u8]) -> &[u8] {
    if nal.len() >= 4 && nal[0] == 0 && nal[1] == 0 && nal[2] == 0 && nal[3] == 1 {
        return &nal[4..];
    }
    if nal.len() >= 3 && nal[0] == 0 && nal[1] == 0 && nal[2] == 1 {
        return &nal[3..];
    }
    nal
}
