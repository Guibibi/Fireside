use serde::Serialize;
#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(target_os = "windows")]
use std::sync::mpsc::TrySendError;
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
#[cfg(target_os = "windows")]
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeCaptureSourceKind {
    Screen,
    Window,
    Application,
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeCaptureSource {
    pub id: String,
    pub kind: NativeCaptureSourceKind,
    pub title: String,
    pub app_name: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone)]
pub enum NativeFrameData {
    CpuBgra(Vec<u8>),
}

#[derive(Debug, Clone)]
pub struct NativeFramePacket {
    pub source_id: String,
    pub width: u32,
    pub height: u32,
    pub timestamp_ms: u64,
    pub pixel_format: String,
    pub bgra_len: Option<usize>,
    pub frame_data: Option<NativeFrameData>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeFrameDispatchStats {
    pub queued_frames: u64,
    pub dropped_full: u64,
    pub dropped_disconnected: u64,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Default)]
struct NativeFrameDispatchStatsAtomic {
    queued_frames: AtomicU64,
    dropped_full: AtomicU64,
    dropped_disconnected: AtomicU64,
}

#[cfg(target_os = "windows")]
fn frame_dispatch_stats() -> &'static NativeFrameDispatchStatsAtomic {
    static STATS: OnceLock<NativeFrameDispatchStatsAtomic> = OnceLock::new();
    STATS.get_or_init(NativeFrameDispatchStatsAtomic::default)
}

#[cfg(target_os = "windows")]
fn frame_sink() -> &'static Mutex<Option<SyncSender<NativeFramePacket>>> {
    static SINK: OnceLock<Mutex<Option<SyncSender<NativeFramePacket>>>> = OnceLock::new();
    SINK.get_or_init(|| Mutex::new(None))
}

#[cfg(target_os = "windows")]
fn dispatch_frame(packet: NativeFramePacket) {
    let sender = {
        let Ok(sink) = frame_sink().lock() else {
            return;
        };
        sink.as_ref().cloned()
    };

    let Some(sender) = sender else {
        return;
    };

    let stats = frame_dispatch_stats();
    match sender.try_send(packet) {
        Ok(()) => {
            stats.queued_frames.fetch_add(1, Ordering::Relaxed);
        }
        Err(TrySendError::Full(_)) => {
            stats.dropped_full.fetch_add(1, Ordering::Relaxed);
        }
        Err(TrySendError::Disconnected(_)) => {
            stats.dropped_disconnected.fetch_add(1, Ordering::Relaxed);
        }
    }
}

#[cfg(target_os = "windows")]
pub fn dispatch_frame_external(packet: NativeFramePacket) {
    dispatch_frame(packet);
}

#[cfg(not(target_os = "windows"))]
pub fn dispatch_frame_external(_packet: NativeFramePacket) {}

#[cfg(target_os = "windows")]
pub fn install_frame_sink(sender: SyncSender<NativeFramePacket>) -> Result<(), String> {
    let mut sink = frame_sink()
        .lock()
        .map_err(|_| "Native capture frame sink lock was poisoned".to_string())?;
    *sink = Some(sender);
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn install_frame_sink(_sender: SyncSender<NativeFramePacket>) -> Result<(), String> {
    Err("Native capture frame sink is supported on Windows only.".to_string())
}

#[cfg(target_os = "windows")]
pub fn clear_frame_sink() -> Result<(), String> {
    let mut sink = frame_sink()
        .lock()
        .map_err(|_| "Native capture frame sink lock was poisoned".to_string())?;
    *sink = None;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn clear_frame_sink() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn reset_frame_dispatch_stats() {
    let stats = frame_dispatch_stats();
    stats.queued_frames.store(0, Ordering::Relaxed);
    stats.dropped_full.store(0, Ordering::Relaxed);
    stats.dropped_disconnected.store(0, Ordering::Relaxed);
}

#[cfg(not(target_os = "windows"))]
pub fn reset_frame_dispatch_stats() {}

#[cfg(target_os = "windows")]
pub fn read_frame_dispatch_stats() -> NativeFrameDispatchStats {
    let stats = frame_dispatch_stats();
    NativeFrameDispatchStats {
        queued_frames: stats.queued_frames.load(Ordering::Relaxed),
        dropped_full: stats.dropped_full.load(Ordering::Relaxed),
        dropped_disconnected: stats.dropped_disconnected.load(Ordering::Relaxed),
    }
}

#[cfg(not(target_os = "windows"))]
pub fn read_frame_dispatch_stats() -> NativeFrameDispatchStats {
    NativeFrameDispatchStats {
        queued_frames: 0,
        dropped_full: 0,
        dropped_disconnected: 0,
    }
}

pub fn create_frame_channel(
    capacity: usize,
) -> (SyncSender<NativeFramePacket>, Receiver<NativeFramePacket>) {
    sync_channel(capacity)
}
