use std::collections::VecDeque;
use std::sync::atomic::Ordering;
use std::sync::mpsc::Receiver;
use std::sync::Arc;
use std::time::Duration;

use crate::capture::windows_capture::{self, NativeFrameData, NativeFramePacket};

use super::encoder_backend::{
    create_encoder_backend_for_codec, create_openh264_backend, NativeCodecTarget,
};
use super::metrics::NativeSenderSharedMetrics;
use super::rtp_packetizer::{CodecRtpPacketizer, RtpPacketizer};

const FAILURE_WINDOW_MS: u64 = 12_000;
const ENCODE_FAILURE_THRESHOLD: u64 = 18;
const RTP_FAILURE_THRESHOLD: u64 = 18;
const DROPPED_FULL_THRESHOLD: u64 = 220;
const PRESSURE_SAMPLE_INTERVAL_MS: u64 = 250;
const PRESSURE_SAMPLE_WINDOW: usize = 20;
const DEGRADE_TO_LEVEL1_AVG_DEPTH_DEFAULT: u64 = 2;
const DEGRADE_TO_LEVEL2_AVG_DEPTH_DEFAULT: u64 = 4;
const DEGRADE_TO_LEVEL3_AVG_DEPTH_DEFAULT: u64 = 6;
const DEGRADE_TO_LEVEL1_PEAK_DEPTH_DEFAULT: u64 = 4;
const DEGRADE_TO_LEVEL2_PEAK_DEPTH_DEFAULT: u64 = 6;
const DEGRADE_TO_LEVEL3_PEAK_DEPTH_DEFAULT: u64 = 7;
const DEGRADE_RECOVER_AVG_DEPTH_DEFAULT: u64 = 1;
const DEGRADE_RECOVER_PEAK_DEPTH_DEFAULT: u64 = 2;
const LEVEL2_SCALE_DIVISOR_DEFAULT: u32 = 2;
const LEVEL3_SCALE_DIVISOR_DEFAULT: u32 = 2;
const LEVEL3_BITRATE_NUMERATOR_DEFAULT: u32 = 7;
const LEVEL3_BITRATE_DENOMINATOR_DEFAULT: u32 = 10;
const DEFAULT_TARGET_BITRATE_KBPS: u32 = 8_000;
const MIN_DEGRADED_BITRATE_KBPS: u32 = 1_200;
const NVENC_RUNTIME_FALLBACK_ENCODE_FAILURES_DEFAULT: u64 = 12;
const DEFAULT_MAX_ENCODE_WIDTH: u32 = 1920;
const DEFAULT_MAX_ENCODE_HEIGHT: u32 = 1080;
const DEFAULT_FPS_LIMIT: u32 = 30;

fn create_packetizer_for_codec(
    mime_type: &str,
    target_rtp: Option<String>,
    payload_type: u8,
    ssrc: u32,
) -> Result<Box<dyn RtpPacketizer>, String> {
    if !mime_type.eq_ignore_ascii_case("video/h264") {
        return Err(format!(
            "Unsupported native RTP packetizer codec: {}",
            mime_type
        ));
    }

    Ok(Box::new(CodecRtpPacketizer::new(target_rtp, payload_type, ssrc)))
}

#[derive(Debug, Clone)]
struct DegradationTuning {
    level1_avg_depth: u64,
    level2_avg_depth: u64,
    level3_avg_depth: u64,
    level1_peak_depth: u64,
    level2_peak_depth: u64,
    level3_peak_depth: u64,
    recover_avg_depth: u64,
    recover_peak_depth: u64,
    level2_scale_divisor: u32,
    level3_scale_divisor: u32,
    level3_bitrate_numerator: u32,
    level3_bitrate_denominator: u32,
}

impl DegradationTuning {
    fn from_env() -> Self {
        let level1_avg_depth = env_u64(
            "YANKCORD_NATIVE_DEGRADE_LEVEL1_AVG_DEPTH",
            DEGRADE_TO_LEVEL1_AVG_DEPTH_DEFAULT,
            1,
            32,
        );
        let level2_avg_depth = env_u64(
            "YANKCORD_NATIVE_DEGRADE_LEVEL2_AVG_DEPTH",
            DEGRADE_TO_LEVEL2_AVG_DEPTH_DEFAULT,
            level1_avg_depth,
            64,
        );
        let level3_avg_depth = env_u64(
            "YANKCORD_NATIVE_DEGRADE_LEVEL3_AVG_DEPTH",
            DEGRADE_TO_LEVEL3_AVG_DEPTH_DEFAULT,
            level2_avg_depth,
            64,
        );
        let level1_peak_depth = env_u64(
            "YANKCORD_NATIVE_DEGRADE_LEVEL1_PEAK_DEPTH",
            DEGRADE_TO_LEVEL1_PEAK_DEPTH_DEFAULT,
            1,
            64,
        );
        let level2_peak_depth = env_u64(
            "YANKCORD_NATIVE_DEGRADE_LEVEL2_PEAK_DEPTH",
            DEGRADE_TO_LEVEL2_PEAK_DEPTH_DEFAULT,
            level1_peak_depth,
            64,
        );
        let level3_peak_depth = env_u64(
            "YANKCORD_NATIVE_DEGRADE_LEVEL3_PEAK_DEPTH",
            DEGRADE_TO_LEVEL3_PEAK_DEPTH_DEFAULT,
            level2_peak_depth,
            64,
        );
        let recover_avg_depth = env_u64(
            "YANKCORD_NATIVE_DEGRADE_RECOVER_AVG_DEPTH",
            DEGRADE_RECOVER_AVG_DEPTH_DEFAULT,
            0,
            level1_avg_depth,
        );
        let recover_peak_depth = env_u64(
            "YANKCORD_NATIVE_DEGRADE_RECOVER_PEAK_DEPTH",
            DEGRADE_RECOVER_PEAK_DEPTH_DEFAULT,
            0,
            level1_peak_depth,
        );
        let level2_scale_divisor = env_u32(
            "YANKCORD_NATIVE_DEGRADE_LEVEL2_SCALE_DIVISOR",
            LEVEL2_SCALE_DIVISOR_DEFAULT,
            1,
            4,
        );
        let level3_scale_divisor = env_u32(
            "YANKCORD_NATIVE_DEGRADE_LEVEL3_SCALE_DIVISOR",
            LEVEL3_SCALE_DIVISOR_DEFAULT,
            level2_scale_divisor,
            4,
        );
        let level3_bitrate_numerator = env_u32(
            "YANKCORD_NATIVE_DEGRADE_LEVEL3_BITRATE_NUMERATOR",
            LEVEL3_BITRATE_NUMERATOR_DEFAULT,
            1,
            100,
        );
        let level3_bitrate_denominator = env_u32(
            "YANKCORD_NATIVE_DEGRADE_LEVEL3_BITRATE_DENOMINATOR",
            LEVEL3_BITRATE_DENOMINATOR_DEFAULT,
            level3_bitrate_numerator,
            100,
        );

        Self {
            level1_avg_depth,
            level2_avg_depth,
            level3_avg_depth,
            level1_peak_depth,
            level2_peak_depth,
            level3_peak_depth,
            recover_avg_depth,
            recover_peak_depth,
            level2_scale_divisor,
            level3_scale_divisor,
            level3_bitrate_numerator,
            level3_bitrate_denominator,
        }
    }
}

fn env_u64(key: &str, default: u64, min: u64, max: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|raw| raw.trim().parse::<u64>().ok())
        .filter(|value| (*value >= min) && (*value <= max))
        .unwrap_or(default)
}

fn env_u32(key: &str, default: u32, min: u32, max: u32) -> u32 {
    std::env::var(key)
        .ok()
        .and_then(|raw| raw.trim().parse::<u32>().ok())
        .filter(|value| (*value >= min) && (*value <= max))
        .unwrap_or(default)
}

#[derive(Debug, Clone)]
pub struct NativeSenderRuntimeConfig {
    pub source_id: String,
    pub target_fps: Option<u32>,
    pub target_bitrate_kbps: Option<u32>,
    pub encoder_backend_preference: Option<String>,
    pub codec_mime_type: Option<String>,
    pub target_rtp: Option<String>,
    pub payload_type: u8,
    pub ssrc: u32,
}

#[derive(Debug, Clone)]
struct FailureWindowState {
    started_at_ms: u64,
    encode_errors_start: u64,
    rtp_errors_start: u64,
    dropped_full_start: u64,
}

impl FailureWindowState {
    fn new(now_ms: u64, shared: &NativeSenderSharedMetrics) -> Self {
        let dispatch = windows_capture::read_frame_dispatch_stats();
        Self {
            started_at_ms: now_ms,
            encode_errors_start: shared.encode_errors.load(Ordering::Relaxed),
            rtp_errors_start: shared.rtp_send_errors.load(Ordering::Relaxed),
            dropped_full_start: dispatch.dropped_full,
        }
    }

    fn rotate_if_needed(&mut self, now_ms: u64, shared: &NativeSenderSharedMetrics) {
        if now_ms.saturating_sub(self.started_at_ms) < FAILURE_WINDOW_MS {
            return;
        }

        *self = Self::new(now_ms, shared);
    }

    fn breached_reason(&self, shared: &NativeSenderSharedMetrics) -> Option<&'static str> {
        let dispatch = windows_capture::read_frame_dispatch_stats();
        let encode_delta = shared
            .encode_errors
            .load(Ordering::Relaxed)
            .saturating_sub(self.encode_errors_start);
        if encode_delta > ENCODE_FAILURE_THRESHOLD {
            return Some("encode_error_threshold");
        }

        let rtp_delta = shared
            .rtp_send_errors
            .load(Ordering::Relaxed)
            .saturating_sub(self.rtp_errors_start);
        if rtp_delta > RTP_FAILURE_THRESHOLD {
            return Some("transport_error_threshold");
        }

        let dropped_delta = dispatch
            .dropped_full
            .saturating_sub(self.dropped_full_start);
        if dropped_delta > DROPPED_FULL_THRESHOLD {
            return Some("queue_pressure_threshold");
        }

        None
    }
}

use crate::capture::unix_timestamp_ms;

fn trigger_native_fallback(reason: &str, source_id: &str, shared: &NativeSenderSharedMetrics) {
    shared
        .fallback_triggered_events
        .fetch_add(1, Ordering::Relaxed);
    shared.set_recent_fallback_reason(Some(reason));
    shared.producer_connected.store(false, Ordering::Relaxed);
    shared.transport_connected.store(false, Ordering::Relaxed);
    eprintln!(
        "[native-sender] event=fallback_triggered source={} reason={}",
        source_id, reason
    );

    let _ = windows_capture::stop_capture();

    shared
        .fallback_completed_events
        .fetch_add(1, Ordering::Relaxed);
    eprintln!(
        "[native-sender] event=fallback_completed source={} reason={}",
        source_id, reason
    );
}

#[derive(Debug, Default)]
struct AdaptiveDegradationState {
    level: u64,
    frame_index: u64,
    pressure_samples: VecDeque<u64>,
    last_sample_at_ms: u64,
}

impl AdaptiveDegradationState {
    fn update_level(
        &mut self,
        queue_depth: u64,
        now_ms: u64,
        shared: &NativeSenderSharedMetrics,
        tuning: &DegradationTuning,
    ) {
        self.record_sample(queue_depth, now_ms);
        let (avg_depth, peak_depth) = self.pressure_stats();
        shared.update_pressure_window(avg_depth, peak_depth);

        let next_level = if avg_depth >= tuning.level3_avg_depth
            || peak_depth >= tuning.level3_peak_depth
        {
            3
        } else if avg_depth >= tuning.level2_avg_depth || peak_depth >= tuning.level2_peak_depth {
            2
        } else if avg_depth >= tuning.level1_avg_depth || peak_depth >= tuning.level1_peak_depth {
            1
        } else if self.level > 0
            && avg_depth <= tuning.recover_avg_depth
            && peak_depth <= tuning.recover_peak_depth
        {
            self.level.saturating_sub(1)
        } else {
            self.level
        };

        if next_level != self.level {
            self.level = next_level;
            shared.set_degradation_level(next_level);
        }
    }

    fn record_sample(&mut self, queue_depth: u64, now_ms: u64) {
        let should_record = self.last_sample_at_ms == 0
            || now_ms.saturating_sub(self.last_sample_at_ms) >= PRESSURE_SAMPLE_INTERVAL_MS;
        if !should_record {
            return;
        }

        self.last_sample_at_ms = now_ms;
        self.pressure_samples.push_back(queue_depth);
        while self.pressure_samples.len() > PRESSURE_SAMPLE_WINDOW {
            self.pressure_samples.pop_front();
        }
    }

    fn pressure_stats(&self) -> (u64, u64) {
        if self.pressure_samples.is_empty() {
            return (0, 0);
        }

        let mut total = 0u64;
        let mut peak = 0u64;
        for sample in &self.pressure_samples {
            total = total.saturating_add(*sample);
            peak = peak.max(*sample);
        }

        let avg = total / self.pressure_samples.len() as u64;
        (avg, peak)
    }

    fn should_drop_before_encode(&mut self) -> bool {
        self.frame_index = self.frame_index.saturating_add(1);
        match self.level {
            0 => false,
            1 => self.frame_index.is_multiple_of(2),
            2 => !self.frame_index.is_multiple_of(3),
            _ => !self.frame_index.is_multiple_of(4),
        }
    }

    fn scale_divisor(&self, tuning: &DegradationTuning) -> u32 {
        match self.level {
            0 | 1 => 1,
            2 => tuning.level2_scale_divisor,
            _ => tuning.level3_scale_divisor,
        }
    }

    fn bitrate_cap_kbps(
        &self,
        target_bitrate_kbps: Option<u32>,
        tuning: &DegradationTuning,
    ) -> Option<u32> {
        if self.level < 3 {
            return None;
        }

        let baseline = target_bitrate_kbps
            .unwrap_or(DEFAULT_TARGET_BITRATE_KBPS)
            .max(MIN_DEGRADED_BITRATE_KBPS);
        let reduced = baseline
            .saturating_mul(tuning.level3_bitrate_numerator)
            .saturating_div(tuning.level3_bitrate_denominator)
            .max(MIN_DEGRADED_BITRATE_KBPS);
        Some(reduced)
    }
}

#[derive(Debug, Default)]
struct DownscaleBuffer {
    buffer: Vec<u8>,
}

impl DownscaleBuffer {
    fn downscale<'a>(
        &'a mut self,
        bgra: &'a [u8],
        width: u32,
        height: u32,
        divisor: u32,
    ) -> (&'a [u8], u32, u32) {
        if divisor <= 1 {
            return (bgra, width, height);
        }

        let target_width = (width / divisor).max(2) & !1;
        let target_height = (height / divisor).max(2) & !1;

        if target_width >= width || target_height >= height {
            return (bgra, width, height);
        }

        let output_len = target_width as usize * target_height as usize * 4;
        if self.buffer.len() != output_len {
            self.buffer.resize(output_len, 0);
        }

        let width_scale = width as usize / target_width as usize;
        let height_scale = height as usize / target_height as usize;

        for target_y in 0..target_height as usize {
            let source_y = target_y.saturating_mul(height_scale);
            let source_row_start = source_y.saturating_mul(width as usize).saturating_mul(4);
            let target_row_start = target_y
                .saturating_mul(target_width as usize)
                .saturating_mul(4);

            for target_x in 0..target_width as usize {
                let source_x = target_x.saturating_mul(width_scale);
                let source_index = source_row_start.saturating_add(source_x.saturating_mul(4));
                let target_index = target_row_start.saturating_add(target_x.saturating_mul(4));

                self.buffer[target_index..target_index + 4]
                    .copy_from_slice(&bgra[source_index..source_index + 4]);
            }
        }

        (&self.buffer, target_width, target_height)
    }
}

struct FpsLimiter {
    target_interval_ms: u64,
    last_encode_at_ms: u64,
}

impl FpsLimiter {
    fn new(target_fps: Option<u32>) -> Self {
        let fps = target_fps.unwrap_or(DEFAULT_FPS_LIMIT).max(1);
        Self {
            target_interval_ms: 1000 / fps as u64,
            last_encode_at_ms: 0,
        }
    }

    fn should_drop(&mut self, now_ms: u64) -> bool {
        if self.last_encode_at_ms == 0 {
            self.last_encode_at_ms = now_ms;
            return false;
        }

        if now_ms.saturating_sub(self.last_encode_at_ms) < self.target_interval_ms {
            return true;
        }

        self.last_encode_at_ms = now_ms;
        false
    }
}

fn resolution_cap_divisor(width: u32, height: u32) -> u32 {
    let max_w = env_u32(
        "YANKCORD_NATIVE_MAX_ENCODE_WIDTH",
        DEFAULT_MAX_ENCODE_WIDTH,
        320,
        7680,
    );
    let max_h = env_u32(
        "YANKCORD_NATIVE_MAX_ENCODE_HEIGHT",
        DEFAULT_MAX_ENCODE_HEIGHT,
        240,
        4320,
    );

    let div_w = width.div_ceil(max_w);
    let div_h = height.div_ceil(max_h);
    div_w.max(div_h).max(1)
}

#[derive(Debug, Default)]
struct BitrateLimiter {
    tokens_bytes: f64,
    max_bucket_bytes: f64,
    current_bitrate_kbps: Option<u32>,
    last_refill_at_ms: u64,
}

impl BitrateLimiter {
    fn allow(&mut self, encoded_bytes: usize, now_ms: u64, bitrate_cap_kbps: Option<u32>) -> bool {
        let Some(cap_kbps) = bitrate_cap_kbps else {
            self.current_bitrate_kbps = None;
            self.tokens_bytes = 0.0;
            self.max_bucket_bytes = 0.0;
            self.last_refill_at_ms = now_ms;
            return true;
        };

        if self.current_bitrate_kbps != Some(cap_kbps) {
            let bytes_per_second = (cap_kbps as f64 * 1000.0) / 8.0;
            self.max_bucket_bytes = bytes_per_second * 1.2;
            self.tokens_bytes = self.max_bucket_bytes;
            self.current_bitrate_kbps = Some(cap_kbps);
            self.last_refill_at_ms = now_ms;
        }

        let elapsed_ms = now_ms.saturating_sub(self.last_refill_at_ms);
        if elapsed_ms > 0 {
            let bytes_per_ms = (cap_kbps as f64 * 1000.0) / 8_000.0;
            self.tokens_bytes =
                (self.tokens_bytes + (bytes_per_ms * elapsed_ms as f64)).min(self.max_bucket_bytes);
            self.last_refill_at_ms = now_ms;
        }

        let needed = encoded_bytes as f64;
        if self.tokens_bytes >= needed {
            self.tokens_bytes -= needed;
            return true;
        }

        false
    }
}

pub fn run_native_sender_worker(
    config: NativeSenderRuntimeConfig,
    receiver: Receiver<NativeFramePacket>,
    stop_signal: Arc<std::sync::atomic::AtomicBool>,
    shared: Arc<NativeSenderSharedMetrics>,
) {
    let codec_target = config
        .codec_mime_type
        .as_deref()
        .and_then(NativeCodecTarget::from_mime_type)
        .unwrap_or(NativeCodecTarget::H264);

    let (mut encoder, encoder_selection) = match create_encoder_backend_for_codec(
        codec_target,
        config.target_fps,
        config.target_bitrate_kbps,
        config.encoder_backend_preference.as_deref(),
    ) {
        Ok(selection) => selection,
        Err(error) => {
            shared.encode_errors.fetch_add(1, Ordering::Relaxed);
            shared.set_encoder_backend_requested(
                config
                    .encoder_backend_preference
                    .as_deref()
                    .unwrap_or("auto"),
            );
            shared.set_encoder_backend_fallback_reason(Some(error.as_str()));
            if codec_target != NativeCodecTarget::H264 {
                shared.set_recent_fallback_reason(Some("native_sender_codec_not_ready"));
            }
            trigger_native_fallback("encoder_init_failed", &config.source_id, &shared);
            stop_signal.store(true, Ordering::Relaxed);
            return;
        }
    };
    let codec = encoder.codec_descriptor();
    let mut packetizer = match create_packetizer_for_codec(
        codec.mime_type,
        config.target_rtp.clone(),
        config.payload_type,
        config.ssrc,
    ) {
        Ok(packetizer) => packetizer,
        Err(error) => {
            shared.encode_errors.fetch_add(1, Ordering::Relaxed);
            shared.set_recent_fallback_reason(Some("unsupported_packetizer_codec"));
            eprintln!(
                "[native-sender] event=packetizer_init_failed source={} codec={} detail={}",
                config.source_id, codec.mime_type, error,
            );
            trigger_native_fallback("unsupported_packetizer_codec", &config.source_id, &shared);
            stop_signal.store(true, Ordering::Relaxed);
            return;
        }
    };
    let now_ms = unix_timestamp_ms();
    let degradation_tuning = DegradationTuning::from_env();

    shared.worker_started_ms.store(now_ms, Ordering::Relaxed);
    shared.sender_started_events.fetch_add(1, Ordering::Relaxed);
    shared.set_encoder_backend(encoder_selection.selected_backend);
    shared.set_encoder_backend_requested(encoder_selection.requested_backend);
    shared.set_encoder_backend_fallback_reason(encoder_selection.fallback_reason.as_deref());
    shared.set_recent_fallback_reason(None);
    shared.set_degradation_level(0);
    shared
        .transport_connected
        .store(packetizer.transport_connected(), Ordering::Relaxed);
    shared
        .producer_connected
        .store(packetizer.transport_connected(), Ordering::Relaxed);

    eprintln!(
        "[native-sender] event=sender_started source={} codec={} encoder_backend={} encoder_requested={} encoder_fallback_reason={} pt={} ssrc={} clock={} packetization={} profile={} target={} degrade_l1(avg={},peak={}) degrade_l2(avg={},peak={},scale={}) degrade_l3(avg={},peak={},scale={},bitrate={}/{}) recover(avg={},peak={})",
        config.source_id,
        codec.mime_type,
        encoder_selection.selected_backend,
        encoder_selection.requested_backend,
        encoder_selection
            .fallback_reason
            .as_deref()
            .unwrap_or("none"),
        config.payload_type,
        config.ssrc,
        codec.clock_rate,
        codec
            .packetization_mode
            .map(|value| value.to_string())
            .unwrap_or_else(|| "none".to_string()),
        codec.profile_level_id.unwrap_or("none"),
        config.target_rtp.as_deref().unwrap_or("disabled"),
        degradation_tuning.level1_avg_depth,
        degradation_tuning.level1_peak_depth,
        degradation_tuning.level2_avg_depth,
        degradation_tuning.level2_peak_depth,
        degradation_tuning.level2_scale_divisor,
        degradation_tuning.level3_avg_depth,
        degradation_tuning.level3_peak_depth,
        degradation_tuning.level3_scale_divisor,
        degradation_tuning.level3_bitrate_numerator,
        degradation_tuning.level3_bitrate_denominator,
        degradation_tuning.recover_avg_depth,
        degradation_tuning.recover_peak_depth,
    );

    let mut failure_window = FailureWindowState::new(now_ms, &shared);
    let mut degradation_state = AdaptiveDegradationState::default();
    let mut downscale_buffer = DownscaleBuffer::default();
    let mut resolution_cap_buffer = DownscaleBuffer::default();
    let mut fps_limiter = FpsLimiter::new(config.target_fps);
    let mut bitrate_limiter = BitrateLimiter::default();
    let mut consecutive_encode_failures = 0u64;
    let mut active_encoder_backend = encoder_selection.selected_backend;
    let nvenc_runtime_fallback_encode_failures = env_u64(
        "YANKCORD_NATIVE_NVENC_RUNTIME_FALLBACK_ENCODE_FAILURES",
        NVENC_RUNTIME_FALLBACK_ENCODE_FAILURES_DEFAULT,
        1,
        120,
    );

    while !stop_signal.load(Ordering::Relaxed) {
        match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok(packet) => {
                shared.received_packets.fetch_add(1, Ordering::Relaxed);

                let keyframe_feedback = packetizer.poll_feedback();
                if keyframe_feedback.keyframe_requests > 0 {
                    shared
                        .keyframe_requests
                        .fetch_add(keyframe_feedback.keyframe_requests, Ordering::Relaxed);
                    if encoder.request_keyframe() {
                        eprintln!(
                            "[native-sender] event=keyframe_requested source={} requests={}",
                            config.source_id, keyframe_feedback.keyframe_requests,
                        );
                    }
                }

                if packet.source_id != config.source_id {
                    continue;
                }

                shared
                    .last_frame_timestamp_ms
                    .store(packet.timestamp_ms, Ordering::Relaxed);

                let Some(frame_data) = &packet.frame_data else {
                    shared.dropped_missing_bgra.fetch_add(1, Ordering::Relaxed);
                    continue;
                };

                if packet.pixel_format != "bgra8" {
                    shared.encode_errors.fetch_add(1, Ordering::Relaxed);
                    shared.dropped_before_encode.fetch_add(1, Ordering::Relaxed);
                    continue;
                }

                // Resolve frame data to CPU BGRA bytes
                let NativeFrameData::CpuBgra(bgra) = frame_data;

                if let Some(expected_len) = packet.bgra_len {
                    if expected_len != bgra.len() {
                        shared.encode_errors.fetch_add(1, Ordering::Relaxed);
                        shared.dropped_before_encode.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                }

                let dispatch = windows_capture::read_frame_dispatch_stats();
                let queue_depth = dispatch
                    .queued_frames
                    .saturating_sub(shared.received_packets.load(Ordering::Relaxed));
                degradation_state.update_level(
                    queue_depth,
                    unix_timestamp_ms(),
                    &shared,
                    &degradation_tuning,
                );

                // FPS limiter: drop frames arriving faster than target interval
                if fps_limiter.should_drop(unix_timestamp_ms()) {
                    shared.dropped_before_encode.fetch_add(1, Ordering::Relaxed);
                    continue;
                }

                if degradation_state.should_drop_before_encode() {
                    shared.dropped_before_encode.fetch_add(1, Ordering::Relaxed);
                    continue;
                }

                // Resolution cap: always cap to max encode resolution before degradation scaling
                let cap_divisor = resolution_cap_divisor(packet.width, packet.height);
                let (capped_input, capped_w, capped_h) =
                    resolution_cap_buffer.downscale(bgra, packet.width, packet.height, cap_divisor);

                // Degradation downscaling stacks on top of the resolution cap
                let scale_divisor = degradation_state.scale_divisor(&degradation_tuning);
                let (encode_input, encode_width, encode_height) =
                    downscale_buffer.downscale(capped_input, capped_w, capped_h, scale_divisor);
                shared
                    .last_frame_width
                    .store(encode_width as u64, Ordering::Relaxed);
                shared
                    .last_frame_height
                    .store(encode_height as u64, Ordering::Relaxed);

                let encode_start_ms = unix_timestamp_ms();
                let encoded_frames =
                    encoder.encode_frame(encode_input, encode_width, encode_height, &shared);
                let Some(frames) = encoded_frames else {
                    consecutive_encode_failures = consecutive_encode_failures.saturating_add(1);
                    if active_encoder_backend == "nvenc_sdk"
                        && encoder_selection.requested_backend == "auto"
                        && consecutive_encode_failures >= nvenc_runtime_fallback_encode_failures
                    {
                        encoder =
                            create_openh264_backend(config.target_fps, config.target_bitrate_kbps);
                        active_encoder_backend = "openh264";
                        shared.set_encoder_backend("openh264");
                        shared.set_encoder_backend_fallback_reason(Some(
                            "nvenc_runtime_encode_failure_threshold",
                        ));
                        shared
                            .encoder_backend_runtime_fallback_events
                            .fetch_add(1, Ordering::Relaxed);

                        // Force at least degradation level 1 to halve frame rate,
                        // giving the software encoder breathing room.
                        if degradation_state.level < 1 {
                            degradation_state.level = 1;
                            shared.set_degradation_level(1);
                        }

                        eprintln!(
                            "[native-sender] event=encoder_backend_runtime_fallback source={} from=nvenc to=openh264 reason=encode_failure_threshold threshold={} forced_degrade_level={}",
                            config.source_id, nvenc_runtime_fallback_encode_failures, degradation_state.level,
                        );
                    }
                    continue;
                };
                consecutive_encode_failures = 0;

                let encoded_bytes: usize = frames.iter().map(|frame| frame.len()).sum();
                let bitrate_cap_kbps = degradation_state
                    .bitrate_cap_kbps(config.target_bitrate_kbps, &degradation_tuning);
                if !bitrate_limiter.allow(encoded_bytes, encode_start_ms, bitrate_cap_kbps) {
                    shared.dropped_during_send.fetch_add(1, Ordering::Relaxed);
                    continue;
                }

                shared.encoded_frames.fetch_add(1, Ordering::Relaxed);
                shared
                    .encoded_bytes
                    .fetch_add(encoded_bytes as u64, Ordering::Relaxed);

                let rtp_packets = packetizer.send_encoded_frames(&frames, packet.timestamp_ms);
                shared
                    .rtp_packets_sent
                    .fetch_add(rtp_packets as u64, Ordering::Relaxed);
                if rtp_packets == 0 {
                    shared.dropped_during_send.fetch_add(1, Ordering::Relaxed);
                }
                if let Some(error_reason) = packetizer.take_and_reset_error_reason() {
                    shared.rtp_send_errors.fetch_add(1, Ordering::Relaxed);
                    shared.dropped_during_send.fetch_add(1, Ordering::Relaxed);
                    eprintln!(
                        "[native-sender] event=transport_error source={} detail={}",
                        config.source_id, error_reason,
                    );
                    if error_reason.starts_with("packetizer_not_implemented_") {
                        trigger_native_fallback(
                            "native_sender_packetizer_not_implemented",
                            &config.source_id,
                            &shared,
                        );
                        stop_signal.store(true, Ordering::Relaxed);
                        break;
                    }
                }

                let encode_latency_ms = unix_timestamp_ms().saturating_sub(encode_start_ms);
                shared
                    .last_encode_latency_ms
                    .store(encode_latency_ms, Ordering::Relaxed);
                shared.processed_packets.fetch_add(1, Ordering::Relaxed);

                let processed = shared.processed_packets.load(Ordering::Relaxed);
                if processed.is_multiple_of(120) {
                    eprintln!(
                        "[native-sender] event=sender_tick source={} processed={} encoded={} rtp_packets={} encode_latency_ms={} frame={}x{}",
                        config.source_id,
                        processed,
                        shared.encoded_frames.load(Ordering::Relaxed),
                        shared.rtp_packets_sent.load(Ordering::Relaxed),
                        encode_latency_ms,
                        packet.width,
                        packet.height,
                    );
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                shared.disconnected_events.fetch_add(1, Ordering::Relaxed);
                break;
            }
        }

        let now = unix_timestamp_ms();
        failure_window.rotate_if_needed(now, &shared);

        if let Some(reason) = failure_window.breached_reason(&shared) {
            trigger_native_fallback(reason, &config.source_id, &shared);
            stop_signal.store(true, Ordering::Relaxed);
            break;
        }
    }

    shared.sender_stopped_events.fetch_add(1, Ordering::Relaxed);
    shared.producer_connected.store(false, Ordering::Relaxed);
    shared.transport_connected.store(false, Ordering::Relaxed);
    eprintln!(
        "[native-sender] event=sender_stopped source={} processed={}",
        config.source_id,
        shared.processed_packets.load(Ordering::Relaxed),
    );
}
