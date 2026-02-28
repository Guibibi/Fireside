use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

/// Atomic counters for the capture pipeline.
#[derive(Debug, Default)]
pub struct CaptureMetrics {
    pub frames_captured: AtomicU64,
    pub frames_encoded: AtomicU64,
    pub frames_dropped: AtomicU64,
    pub send_errors: AtomicU64,
    /// Smoothed FPS values updated by the session every second.
    pub capture_fps: AtomicU32,
    pub encode_fps: AtomicU32,
    /// Current number of frames waiting in the encode queue.
    pub queue_depth: AtomicU32,
}

impl CaptureMetrics {
    pub fn reset(&self) {
        self.frames_captured.store(0, Ordering::Relaxed);
        self.frames_encoded.store(0, Ordering::Relaxed);
        self.frames_dropped.store(0, Ordering::Relaxed);
        self.send_errors.store(0, Ordering::Relaxed);
        self.capture_fps.store(0, Ordering::Relaxed);
        self.encode_fps.store(0, Ordering::Relaxed);
        self.queue_depth.store(0, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> CaptureMetricsSnapshot {
        CaptureMetricsSnapshot {
            frames_captured: self.frames_captured.load(Ordering::Relaxed),
            frames_encoded: self.frames_encoded.load(Ordering::Relaxed),
            frames_dropped: self.frames_dropped.load(Ordering::Relaxed),
            send_errors: self.send_errors.load(Ordering::Relaxed),
            capture_fps: self.capture_fps.load(Ordering::Relaxed),
            encode_fps: self.encode_fps.load(Ordering::Relaxed),
            queue_depth: self.queue_depth.load(Ordering::Relaxed),
        }
    }
}

/// JSON-serializable snapshot of metrics.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CaptureMetricsSnapshot {
    pub frames_captured: u64,
    pub frames_encoded: u64,
    pub frames_dropped: u64,
    pub send_errors: u64,
    pub capture_fps: u32,
    pub encode_fps: u32,
    pub queue_depth: u32,
}

pub type SharedMetrics = Arc<CaptureMetrics>;

pub fn new_shared_metrics() -> SharedMetrics {
    Arc::new(CaptureMetrics::default())
}
