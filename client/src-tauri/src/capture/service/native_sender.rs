use std::collections::VecDeque;
use std::sync::atomic::Ordering;
use std::sync::mpsc::Receiver;
use std::sync::Arc;
use std::time::Duration;

use crate::capture::windows_capture::{self, NativeFramePacket};

use super::encoder_backend::{create_encoder_backend, VideoEncoderBackend};
use super::metrics::NativeSenderSharedMetrics;
use super::rtp_packetizer::{H264RtpPacketizer, RtpPacketizer};

const FAILURE_WINDOW_MS: u64 = 12_000;
const ENCODE_FAILURE_THRESHOLD: u64 = 18;
const RTP_FAILURE_THRESHOLD: u64 = 18;
const DROPPED_FULL_THRESHOLD: u64 = 220;
const PRESSURE_SAMPLE_INTERVAL_MS: u64 = 250;
const PRESSURE_SAMPLE_WINDOW: usize = 20;
const DEGRADE_TO_LEVEL1_AVG_DEPTH: u64 = 2;
const DEGRADE_TO_LEVEL2_AVG_DEPTH: u64 = 4;
const DEGRADE_TO_LEVEL3_AVG_DEPTH: u64 = 6;
const DEGRADE_TO_LEVEL1_PEAK_DEPTH: u64 = 4;
const DEGRADE_TO_LEVEL2_PEAK_DEPTH: u64 = 6;
const DEGRADE_TO_LEVEL3_PEAK_DEPTH: u64 = 7;
const DEGRADE_RECOVER_AVG_DEPTH: u64 = 1;
const DEGRADE_RECOVER_PEAK_DEPTH: u64 = 2;

#[derive(Debug, Clone)]
pub struct NativeSenderRuntimeConfig {
    pub source_id: String,
    pub target_fps: Option<u32>,
    pub target_bitrate_kbps: Option<u32>,
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

fn unix_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

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
    fn update_level(&mut self, queue_depth: u64, now_ms: u64, shared: &NativeSenderSharedMetrics) {
        self.record_sample(queue_depth, now_ms);
        let (avg_depth, peak_depth) = self.pressure_stats();

        let next_level = if avg_depth >= DEGRADE_TO_LEVEL3_AVG_DEPTH
            || peak_depth >= DEGRADE_TO_LEVEL3_PEAK_DEPTH
        {
            3
        } else if avg_depth >= DEGRADE_TO_LEVEL2_AVG_DEPTH
            || peak_depth >= DEGRADE_TO_LEVEL2_PEAK_DEPTH
        {
            2
        } else if avg_depth >= DEGRADE_TO_LEVEL1_AVG_DEPTH
            || peak_depth >= DEGRADE_TO_LEVEL1_PEAK_DEPTH
        {
            1
        } else if self.level > 0
            && avg_depth <= DEGRADE_RECOVER_AVG_DEPTH
            && peak_depth <= DEGRADE_RECOVER_PEAK_DEPTH
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
            1 => self.frame_index % 2 == 0,
            2 => self.frame_index % 3 != 0,
            _ => self.frame_index % 4 != 0,
        }
    }
}

pub fn run_native_sender_worker(
    config: NativeSenderRuntimeConfig,
    receiver: Receiver<NativeFramePacket>,
    stop_signal: Arc<std::sync::atomic::AtomicBool>,
    shared: Arc<NativeSenderSharedMetrics>,
) {
    let mut encoder: Box<dyn VideoEncoderBackend> =
        create_encoder_backend(config.target_fps, config.target_bitrate_kbps);
    let codec = encoder.codec_descriptor();
    let mut packetizer: Box<dyn RtpPacketizer> = Box::new(H264RtpPacketizer::new(
        config.target_rtp.clone(),
        config.payload_type,
        config.ssrc,
    ));
    let now_ms = unix_timestamp_ms();

    shared.worker_started_ms.store(now_ms, Ordering::Relaxed);
    shared.sender_started_events.fetch_add(1, Ordering::Relaxed);
    shared.set_recent_fallback_reason(None);
    shared.set_degradation_level(0);
    shared
        .transport_connected
        .store(packetizer.transport_connected(), Ordering::Relaxed);
    shared
        .producer_connected
        .store(packetizer.transport_connected(), Ordering::Relaxed);

    eprintln!(
        "[native-sender] event=sender_started source={} codec={} encoder_backend={} pt={} ssrc={} clock={} packetization={} profile={} target={}",
        config.source_id,
        codec.mime_type,
        encoder.backend_name(),
        config.payload_type,
        config.ssrc,
        codec.clock_rate,
        codec.packetization_mode,
        codec.profile_level_id,
        config.target_rtp.as_deref().unwrap_or("disabled"),
    );

    let mut failure_window = FailureWindowState::new(now_ms, &shared);
    let mut degradation_state = AdaptiveDegradationState::default();

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
                shared
                    .last_frame_width
                    .store(packet.width as u64, Ordering::Relaxed);
                shared
                    .last_frame_height
                    .store(packet.height as u64, Ordering::Relaxed);

                let Some(bgra) = packet.bgra.as_ref() else {
                    shared.dropped_missing_bgra.fetch_add(1, Ordering::Relaxed);
                    continue;
                };

                if packet.pixel_format != "bgra8" {
                    shared.encode_errors.fetch_add(1, Ordering::Relaxed);
                    shared.dropped_before_encode.fetch_add(1, Ordering::Relaxed);
                    continue;
                }

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
                degradation_state.update_level(queue_depth, unix_timestamp_ms(), &shared);

                if degradation_state.should_drop_before_encode() {
                    shared.dropped_before_encode.fetch_add(1, Ordering::Relaxed);
                    continue;
                }

                let encode_start_ms = unix_timestamp_ms();
                let encoded_nals = encoder.encode_frame(bgra, packet.width, packet.height, &shared);
                let Some(nals) = encoded_nals else {
                    continue;
                };

                let encoded_bytes: usize = nals.iter().map(|nal| nal.len()).sum();
                shared.encoded_frames.fetch_add(1, Ordering::Relaxed);
                shared
                    .encoded_bytes
                    .fetch_add(encoded_bytes as u64, Ordering::Relaxed);

                let rtp_packets = packetizer.send_nalus(&nals, packet.timestamp_ms);
                shared
                    .rtp_packets_sent
                    .fetch_add(rtp_packets as u64, Ordering::Relaxed);
                if rtp_packets == 0 {
                    shared.dropped_during_send.fetch_add(1, Ordering::Relaxed);
                }
                if packetizer.take_and_reset_error() {
                    shared.rtp_send_errors.fetch_add(1, Ordering::Relaxed);
                    shared.dropped_during_send.fetch_add(1, Ordering::Relaxed);
                    eprintln!(
                        "[native-sender] event=transport_error source={} detail=udp_send_failed",
                        config.source_id,
                    );
                }

                let encode_latency_ms = unix_timestamp_ms().saturating_sub(encode_start_ms);
                shared
                    .last_encode_latency_ms
                    .store(encode_latency_ms, Ordering::Relaxed);
                shared.processed_packets.fetch_add(1, Ordering::Relaxed);

                let processed = shared.processed_packets.load(Ordering::Relaxed);
                if processed % 120 == 0 {
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
