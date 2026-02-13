use std::sync::atomic::Ordering;
use std::sync::mpsc::Receiver;
use std::sync::Arc;
use std::time::Duration;

use crate::capture::windows_capture::{self, NativeFramePacket};

use super::h264_encoder::{build_h264_encoder, encode_bgra_frame};
use super::metrics::NativeSenderSharedMetrics;
use super::rtp_sender::{canonical_h264_rtp_parameters, NativeRtpSender};

const FAILURE_WINDOW_MS: u64 = 12_000;
const ENCODE_FAILURE_THRESHOLD: u64 = 18;
const RTP_FAILURE_THRESHOLD: u64 = 18;
const DROPPED_FULL_THRESHOLD: u64 = 220;

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

pub fn run_native_sender_worker(
    config: NativeSenderRuntimeConfig,
    receiver: Receiver<NativeFramePacket>,
    stop_signal: Arc<std::sync::atomic::AtomicBool>,
    shared: Arc<NativeSenderSharedMetrics>,
) {
    let mut h264_encoder = build_h264_encoder(config.target_fps, config.target_bitrate_kbps);
    let mut rtp_sender =
        NativeRtpSender::new(config.target_rtp.clone(), config.payload_type, config.ssrc);
    let h264 = canonical_h264_rtp_parameters();
    let now_ms = unix_timestamp_ms();

    shared.worker_started_ms.store(now_ms, Ordering::Relaxed);
    shared.sender_started_events.fetch_add(1, Ordering::Relaxed);
    shared.set_recent_fallback_reason(None);
    shared.set_degradation_level(0);
    shared
        .transport_connected
        .store(rtp_sender.transport_connected(), Ordering::Relaxed);
    shared
        .producer_connected
        .store(rtp_sender.transport_connected(), Ordering::Relaxed);

    eprintln!(
        "[native-sender] event=sender_started source={} codec={} pt={} ssrc={} clock={} packetization={} profile={} target={}",
        config.source_id,
        h264.mime_type,
        config.payload_type,
        config.ssrc,
        h264.clock_rate,
        h264.packetization_mode,
        h264.profile_level_id,
        config.target_rtp.as_deref().unwrap_or("disabled"),
    );

    let mut failure_window = FailureWindowState::new(now_ms, &shared);

    while !stop_signal.load(Ordering::Relaxed) {
        match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok(packet) => {
                shared.received_packets.fetch_add(1, Ordering::Relaxed);

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
                    continue;
                }

                if let Some(expected_len) = packet.bgra_len {
                    if expected_len != bgra.len() {
                        shared.encode_errors.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                }

                let encode_start_ms = unix_timestamp_ms();
                let encoded_nals = encode_bgra_frame(
                    &mut h264_encoder,
                    bgra,
                    packet.width,
                    packet.height,
                    &shared,
                );
                let Some(nals) = encoded_nals else {
                    continue;
                };

                let encoded_bytes: usize = nals.iter().map(|nal| nal.len()).sum();
                shared.encoded_frames.fetch_add(1, Ordering::Relaxed);
                shared
                    .encoded_bytes
                    .fetch_add(encoded_bytes as u64, Ordering::Relaxed);

                let rtp_packets = rtp_sender.send_h264_nalus(&nals, packet.timestamp_ms);
                shared
                    .rtp_packets_sent
                    .fetch_add(rtp_packets as u64, Ordering::Relaxed);
                if rtp_sender.take_and_reset_error() {
                    shared.rtp_send_errors.fetch_add(1, Ordering::Relaxed);
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
