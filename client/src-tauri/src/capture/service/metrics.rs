use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use crate::capture::windows_capture::NativeFrameDispatchStats;

#[derive(Debug, Default)]
pub struct NativeSenderSharedMetrics {
    pub worker_started_ms: AtomicU64,
    pub received_packets: AtomicU64,
    pub processed_packets: AtomicU64,
    pub disconnected_events: AtomicU64,
    pub last_frame_width: AtomicU64,
    pub last_frame_height: AtomicU64,
    pub last_frame_timestamp_ms: AtomicU64,
    pub last_encode_latency_ms: AtomicU64,
    pub encoded_frames: AtomicU64,
    pub encoded_bytes: AtomicU64,
    pub rtp_packets_sent: AtomicU64,
    pub rtp_send_errors: AtomicU64,
    pub encode_errors: AtomicU64,
    pub keyframe_requests: AtomicU64,
    pub dropped_missing_bgra: AtomicU64,
    pub dropped_before_encode: AtomicU64,
    pub dropped_during_send: AtomicU64,
    pub sender_started_events: AtomicU64,
    pub sender_stopped_events: AtomicU64,
    pub fallback_triggered_events: AtomicU64,
    pub fallback_completed_events: AtomicU64,
    pub transport_connected: AtomicBool,
    pub producer_connected: AtomicBool,
    pub degradation_level: AtomicU64,
    pub recent_fallback_reason: Mutex<Option<String>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeSenderMetrics {
    pub worker_active: bool,
    pub source_id: Option<String>,
    pub queue_capacity: u32,
    pub target_fps: Option<u32>,
    pub target_bitrate_kbps: Option<u32>,
    pub worker_started_at_ms: Option<u64>,
    pub received_packets: u64,
    pub processed_packets: u64,
    pub dropped_full: u64,
    pub dropped_disconnected: u64,
    pub worker_disconnect_events: u64,
    pub encoded_frames: u64,
    pub encoded_bytes: u64,
    pub rtp_packets_sent: u64,
    pub rtp_send_errors: u64,
    pub encode_errors: u64,
    pub keyframe_requests: u64,
    pub dropped_missing_bgra: u64,
    pub dropped_before_encode: u64,
    pub dropped_during_send: u64,
    pub rtp_target: Option<String>,
    pub estimated_queue_depth: u64,
    pub last_frame_width: Option<u32>,
    pub last_frame_height: Option<u32>,
    pub last_frame_timestamp_ms: Option<u64>,
    pub last_encode_latency_ms: Option<u64>,
    pub recent_fallback_reason: Option<String>,
    pub degradation_level: String,
    pub producer_connected: bool,
    pub transport_connected: bool,
    pub sender_started_events: u64,
    pub sender_stopped_events: u64,
    pub fallback_triggered_events: u64,
    pub fallback_completed_events: u64,
}

#[derive(Debug, Clone)]
pub struct NativeSenderSnapshotInput {
    pub worker_active: bool,
    pub source_id: Option<String>,
    pub queue_capacity: usize,
    pub target_fps: Option<u32>,
    pub target_bitrate_kbps: Option<u32>,
    pub rtp_target: Option<String>,
    pub dispatch: NativeFrameDispatchStats,
}

impl NativeSenderSharedMetrics {
    pub fn set_recent_fallback_reason(&self, reason: Option<&str>) {
        if let Ok(mut slot) = self.recent_fallback_reason.lock() {
            *slot = reason.map(ToString::to_string);
        }
    }

    pub fn set_degradation_level(&self, level: u64) {
        self.degradation_level.store(level, Ordering::Relaxed);
    }

    pub fn snapshot(&self, input: NativeSenderSnapshotInput) -> NativeSenderMetrics {
        let received_packets = self.received_packets.load(Ordering::Relaxed);
        let processed_packets = self.processed_packets.load(Ordering::Relaxed);
        let queue_depth = input
            .dispatch
            .queued_frames
            .saturating_sub(received_packets);
        let started = self.worker_started_ms.load(Ordering::Relaxed);
        let last_frame_width = self.last_frame_width.load(Ordering::Relaxed);
        let last_frame_height = self.last_frame_height.load(Ordering::Relaxed);
        let last_frame_timestamp = self.last_frame_timestamp_ms.load(Ordering::Relaxed);
        let last_encode_latency = self.last_encode_latency_ms.load(Ordering::Relaxed);
        let worker_disconnect_events = self.disconnected_events.load(Ordering::Relaxed);
        let encoded_frames = self.encoded_frames.load(Ordering::Relaxed);
        let encoded_bytes = self.encoded_bytes.load(Ordering::Relaxed);
        let rtp_packets_sent = self.rtp_packets_sent.load(Ordering::Relaxed);
        let rtp_send_errors = self.rtp_send_errors.load(Ordering::Relaxed);
        let encode_errors = self.encode_errors.load(Ordering::Relaxed);
        let keyframe_requests = self.keyframe_requests.load(Ordering::Relaxed);
        let dropped_missing_bgra = self.dropped_missing_bgra.load(Ordering::Relaxed);
        let dropped_before_encode = self.dropped_before_encode.load(Ordering::Relaxed);
        let dropped_during_send = self.dropped_during_send.load(Ordering::Relaxed);
        let degradation_level = self.degradation_level.load(Ordering::Relaxed);
        let fallback_reason = self
            .recent_fallback_reason
            .lock()
            .ok()
            .and_then(|reason| reason.clone());

        NativeSenderMetrics {
            worker_active: input.worker_active,
            source_id: input.source_id,
            queue_capacity: input.queue_capacity as u32,
            target_fps: input.target_fps,
            target_bitrate_kbps: input.target_bitrate_kbps,
            worker_started_at_ms: if started == 0 { None } else { Some(started) },
            received_packets,
            processed_packets,
            dropped_full: input.dispatch.dropped_full,
            dropped_disconnected: input.dispatch.dropped_disconnected,
            worker_disconnect_events,
            encoded_frames,
            encoded_bytes,
            rtp_packets_sent,
            rtp_send_errors,
            encode_errors,
            keyframe_requests,
            dropped_missing_bgra,
            dropped_before_encode,
            dropped_during_send,
            rtp_target: input.rtp_target,
            estimated_queue_depth: queue_depth,
            last_frame_width: if last_frame_width == 0 {
                None
            } else {
                Some(last_frame_width as u32)
            },
            last_frame_height: if last_frame_height == 0 {
                None
            } else {
                Some(last_frame_height as u32)
            },
            last_frame_timestamp_ms: if last_frame_timestamp == 0 {
                None
            } else {
                Some(last_frame_timestamp)
            },
            last_encode_latency_ms: if last_encode_latency == 0 {
                None
            } else {
                Some(last_encode_latency)
            },
            recent_fallback_reason: fallback_reason,
            degradation_level: degradation_level_name(degradation_level).to_string(),
            producer_connected: self.producer_connected.load(Ordering::Relaxed),
            transport_connected: self.transport_connected.load(Ordering::Relaxed),
            sender_started_events: self.sender_started_events.load(Ordering::Relaxed),
            sender_stopped_events: self.sender_stopped_events.load(Ordering::Relaxed),
            fallback_triggered_events: self.fallback_triggered_events.load(Ordering::Relaxed),
            fallback_completed_events: self.fallback_completed_events.load(Ordering::Relaxed),
        }
    }
}

pub fn degradation_level_name(level: u64) -> &'static str {
    match level {
        0 => "none",
        1 => "fps_reduced",
        2 => "resolution_reduced",
        _ => "bitrate_reduced",
    }
}
