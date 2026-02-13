use openh264::encoder::{BitRate, Encoder, EncoderConfig, FrameRate, Profile, UsageType};
use openh264::formats::{BgraSliceU8, YUVBuffer};
use serde::{Deserialize, Serialize};
use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{State, Window};

use super::windows_capture::{
    self, NativeCaptureSource, NativeCaptureSourceKind, NativeCaptureStartRequest,
    NativeFramePacket,
};

const FRAME_QUEUE_CAPACITY: usize = 8;

#[derive(Debug, Clone)]
struct ActiveCaptureSession {
    source_id: String,
    source_kind: NativeCaptureSourceKind,
    resolution: Option<String>,
    fps: Option<u32>,
    bitrate_kbps: Option<u32>,
}

#[derive(Debug, Default)]
struct NativeSenderSharedMetrics {
    worker_started_ms: AtomicU64,
    received_packets: AtomicU64,
    processed_packets: AtomicU64,
    disconnected_events: AtomicU64,
    last_frame_width: AtomicU64,
    last_frame_height: AtomicU64,
    last_frame_timestamp_ms: AtomicU64,
    last_encode_latency_ms: AtomicU64,
    encoded_frames: AtomicU64,
    encoded_bytes: AtomicU64,
    rtp_packets_sent: AtomicU64,
    rtp_send_errors: AtomicU64,
    encode_errors: AtomicU64,
    dropped_missing_bgra: AtomicU64,
}

#[derive(Debug)]
struct NativeSenderWorker {
    source_id: String,
    queue_capacity: usize,
    target_fps: Option<u32>,
    target_bitrate_kbps: Option<u32>,
    rtp_target: Option<String>,
    stop_signal: Arc<AtomicBool>,
    shared: Arc<NativeSenderSharedMetrics>,
    handle: Option<JoinHandle<()>>,
}

#[derive(Default)]
pub struct NativeCaptureService {
    active_session: Mutex<Option<ActiveCaptureSession>>,
    sender_worker: Mutex<Option<NativeSenderWorker>>,
}

#[derive(Debug, Deserialize)]
pub struct StartNativeCaptureRequest {
    pub source_id: String,
    pub resolution: Option<String>,
    pub fps: Option<u32>,
    pub bitrate_kbps: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeCaptureStatus {
    pub active: bool,
    pub source_id: Option<String>,
    pub source_kind: Option<NativeCaptureSourceKind>,
    pub resolution: Option<String>,
    pub fps: Option<u32>,
    pub bitrate_kbps: Option<u32>,
    pub native_sender: NativeSenderMetrics,
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
    pub dropped_missing_bgra: u64,
    pub rtp_target: Option<String>,
    pub estimated_queue_depth: u64,
    pub last_frame_width: Option<u32>,
    pub last_frame_height: Option<u32>,
    pub last_frame_timestamp_ms: Option<u64>,
    pub last_encode_latency_ms: Option<u64>,
}

#[derive(Debug)]
struct NativeRtpSender {
    socket: Option<UdpSocket>,
    target: Option<SocketAddr>,
    payload_type: u8,
    sequence_number: u16,
    ssrc: u32,
    mtu: usize,
    had_send_error: bool,
}

impl NativeCaptureService {
    fn sender_metrics(&self) -> Result<NativeSenderMetrics, String> {
        let dispatch = windows_capture::read_frame_dispatch_stats();

        let worker = self
            .sender_worker
            .lock()
            .map_err(|_| "Native capture sender-worker lock was poisoned".to_string())?;

        let Some(worker) = worker.as_ref() else {
            return Ok(NativeSenderMetrics {
                worker_active: false,
                source_id: None,
                queue_capacity: 0,
                target_fps: None,
                target_bitrate_kbps: None,
                worker_started_at_ms: None,
                received_packets: 0,
                processed_packets: 0,
                dropped_full: dispatch.dropped_full,
                dropped_disconnected: dispatch.dropped_disconnected,
                worker_disconnect_events: 0,
                encoded_frames: 0,
                encoded_bytes: 0,
                rtp_packets_sent: 0,
                rtp_send_errors: 0,
                encode_errors: 0,
                dropped_missing_bgra: 0,
                rtp_target: None,
                estimated_queue_depth: 0,
                last_frame_width: None,
                last_frame_height: None,
                last_frame_timestamp_ms: None,
                last_encode_latency_ms: None,
            });
        };

        let received_packets = worker.shared.received_packets.load(Ordering::Relaxed);
        let processed_packets = worker.shared.processed_packets.load(Ordering::Relaxed);
        let queue_depth = dispatch.queued_frames.saturating_sub(received_packets);
        let started = worker.shared.worker_started_ms.load(Ordering::Relaxed);
        let last_frame_width = worker.shared.last_frame_width.load(Ordering::Relaxed);
        let last_frame_height = worker.shared.last_frame_height.load(Ordering::Relaxed);
        let last_frame_timestamp = worker
            .shared
            .last_frame_timestamp_ms
            .load(Ordering::Relaxed);
        let last_encode_latency = worker.shared.last_encode_latency_ms.load(Ordering::Relaxed);
        let worker_disconnect_events = worker.shared.disconnected_events.load(Ordering::Relaxed);
        let encoded_frames = worker.shared.encoded_frames.load(Ordering::Relaxed);
        let encoded_bytes = worker.shared.encoded_bytes.load(Ordering::Relaxed);
        let rtp_packets_sent = worker.shared.rtp_packets_sent.load(Ordering::Relaxed);
        let rtp_send_errors = worker.shared.rtp_send_errors.load(Ordering::Relaxed);
        let encode_errors = worker.shared.encode_errors.load(Ordering::Relaxed);
        let dropped_missing_bgra = worker.shared.dropped_missing_bgra.load(Ordering::Relaxed);

        Ok(NativeSenderMetrics {
            worker_active: true,
            source_id: Some(worker.source_id.clone()),
            queue_capacity: worker.queue_capacity as u32,
            target_fps: worker.target_fps,
            target_bitrate_kbps: worker.target_bitrate_kbps,
            worker_started_at_ms: if started == 0 { None } else { Some(started) },
            received_packets,
            processed_packets,
            dropped_full: dispatch.dropped_full,
            dropped_disconnected: dispatch.dropped_disconnected,
            worker_disconnect_events,
            encoded_frames,
            encoded_bytes,
            rtp_packets_sent,
            rtp_send_errors,
            encode_errors,
            dropped_missing_bgra,
            rtp_target: worker.rtp_target.clone(),
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
        })
    }

    fn current_status(&self) -> Result<NativeCaptureStatus, String> {
        let sender_metrics = self.sender_metrics()?;
        let session = self
            .active_session
            .lock()
            .map_err(|_| "Native capture service lock was poisoned".to_string())?;

        let status = match session.as_ref() {
            Some(active) => NativeCaptureStatus {
                active: true,
                source_id: Some(active.source_id.clone()),
                source_kind: Some(active.source_kind.clone()),
                resolution: active.resolution.clone(),
                fps: active.fps,
                bitrate_kbps: active.bitrate_kbps,
                native_sender: sender_metrics,
            },
            None => NativeCaptureStatus {
                active: false,
                source_id: None,
                source_kind: None,
                resolution: None,
                fps: None,
                bitrate_kbps: None,
                native_sender: sender_metrics,
            },
        };

        Ok(status)
    }

    fn is_worker_active_for(&self, source_id: &str) -> Result<bool, String> {
        let worker = self
            .sender_worker
            .lock()
            .map_err(|_| "Native capture sender-worker lock was poisoned".to_string())?;

        Ok(worker
            .as_ref()
            .map(|active| active.source_id == source_id)
            .unwrap_or(false))
    }

    fn stop_sender_worker(&self) -> Result<(), String> {
        let mut worker = self
            .sender_worker
            .lock()
            .map_err(|_| "Native capture sender-worker lock was poisoned".to_string())?;

        let Some(mut active_worker) = worker.take() else {
            windows_capture::clear_frame_sink()?;
            return Ok(());
        };

        active_worker.stop_signal.store(true, Ordering::Relaxed);
        windows_capture::clear_frame_sink()?;

        if let Some(handle) = active_worker.handle.take() {
            handle
                .join()
                .map_err(|_| "Native sender worker thread panicked".to_string())?;
        }

        Ok(())
    }

    fn start_sender_worker(
        &self,
        source_id: String,
        fps: Option<u32>,
        bitrate_kbps: Option<u32>,
    ) -> Result<(), String> {
        self.stop_sender_worker()?;
        windows_capture::reset_frame_dispatch_stats();

        let (sender, receiver) = windows_capture::create_frame_channel(FRAME_QUEUE_CAPACITY);
        windows_capture::install_frame_sink(sender)?;

        let stop_signal = Arc::new(AtomicBool::new(false));
        let shared = Arc::new(NativeSenderSharedMetrics::default());
        shared
            .worker_started_ms
            .store(unix_timestamp_ms(), Ordering::Relaxed);
        let target_rtp = std::env::var("YANKCORD_NATIVE_RTP_TARGET").ok();

        let worker_stop_signal = Arc::clone(&stop_signal);
        let worker_shared = Arc::clone(&shared);
        let worker_source_id = source_id.clone();
        let worker_target_fps = fps;
        let worker_target_bitrate_kbps = bitrate_kbps;
        let worker_target_rtp = target_rtp.clone();
        let handle = thread::Builder::new()
            .name("native-sender-worker".to_string())
            .spawn(move || {
                run_native_sender_worker(
                    worker_source_id,
                    worker_target_fps,
                    worker_target_bitrate_kbps,
                    worker_target_rtp,
                    receiver,
                    worker_stop_signal,
                    worker_shared,
                );
            })
            .map_err(|error| format!("Failed to start native sender worker: {error}"))?;

        let mut worker = self
            .sender_worker
            .lock()
            .map_err(|_| "Native capture sender-worker lock was poisoned".to_string())?;

        *worker = Some(NativeSenderWorker {
            source_id,
            queue_capacity: FRAME_QUEUE_CAPACITY,
            target_fps: fps,
            target_bitrate_kbps: bitrate_kbps,
            rtp_target: target_rtp,
            stop_signal,
            shared,
            handle: Some(handle),
        });

        Ok(())
    }
}

fn unix_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn run_native_sender_worker(
    source_id: String,
    target_fps: Option<u32>,
    target_bitrate_kbps: Option<u32>,
    target_rtp: Option<String>,
    receiver: Receiver<NativeFramePacket>,
    stop_signal: Arc<AtomicBool>,
    shared: Arc<NativeSenderSharedMetrics>,
) {
    let mut h264_encoder = build_h264_encoder(target_fps, target_bitrate_kbps);
    let mut rtp_sender = NativeRtpSender::new(target_rtp.clone());

    while !stop_signal.load(Ordering::Relaxed) {
        match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok(packet) => {
                shared.received_packets.fetch_add(1, Ordering::Relaxed);

                if packet.source_id != source_id {
                    continue;
                }
                let encode_start_ms = unix_timestamp_ms();
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
                }

                let encode_latency_ms = unix_timestamp_ms().saturating_sub(encode_start_ms);
                shared
                    .last_encode_latency_ms
                    .store(encode_latency_ms, Ordering::Relaxed);
                shared.processed_packets.fetch_add(1, Ordering::Relaxed);

                let processed = shared.processed_packets.load(Ordering::Relaxed);
                if processed % 120 == 0 {
                    let encoded_frames = shared.encoded_frames.load(Ordering::Relaxed);
                    let rtp_packets_sent = shared.rtp_packets_sent.load(Ordering::Relaxed);
                    eprintln!(
                        "[native-sender] source={} processed={} encoded={} rtp_packets={} encode_latency_ms={} frame={}x{} target={}",
                        source_id,
                        processed,
                        encoded_frames,
                        rtp_packets_sent,
                        encode_latency_ms,
                        packet.width,
                        packet.height,
                        target_rtp.as_deref().unwrap_or("disabled")
                    );
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                shared.disconnected_events.fetch_add(1, Ordering::Relaxed);
                break;
            }
        }
    }
}

fn build_h264_encoder(
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

fn encode_bgra_frame(
    encoder: &mut Option<Encoder>,
    bgra: &[u8],
    width: u32,
    height: u32,
    shared: &Arc<NativeSenderSharedMetrics>,
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
            eprintln!("[native-sender] H264 encode failed: {error}");
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

impl NativeRtpSender {
    fn new(target: Option<String>) -> Self {
        let parsed_target = target
            .as_deref()
            .and_then(|value| value.parse::<SocketAddr>().ok());
        let socket = parsed_target.and_then(|address| {
            let bind_address = if address.is_ipv4() {
                "0.0.0.0:0"
            } else {
                "[::]:0"
            };
            UdpSocket::bind(bind_address).ok()
        });

        Self {
            socket,
            target: parsed_target,
            payload_type: 96,
            sequence_number: 1,
            ssrc: 0x4E415456,
            mtu: 1200,
            had_send_error: false,
        }
    }

    fn send_h264_nalus(&mut self, nals: &[Vec<u8>], timestamp_ms: u64) -> usize {
        let mut sent = 0usize;
        let rtp_timestamp = timestamp_ms.wrapping_mul(90) as u32;

        for (index, nal) in nals.iter().enumerate() {
            let is_last_nal = index + 1 == nals.len();
            sent = sent.saturating_add(self.send_nal(nal, rtp_timestamp, is_last_nal));
        }

        sent
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

        if socket.send_to(packet, target).is_err() {
            self.had_send_error = true;
        }
    }

    fn take_and_reset_error(&mut self) -> bool {
        let had_error = self.had_send_error;
        self.had_send_error = false;
        had_error
    }
}

fn normalize_resolution(resolution: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = resolution else {
        return Ok(None);
    };

    let normalized = value.trim().to_lowercase();
    if normalized.is_empty() {
        return Ok(None);
    }

    match normalized.as_str() {
        "720p" | "1080p" | "1440p" | "4k" => Ok(Some(normalized)),
        _ => Err("Unsupported resolution. Use 720p, 1080p, 1440p, or 4k.".to_string()),
    }
}

fn normalize_fps(fps: Option<u32>) -> Result<Option<u32>, String> {
    match fps {
        None => Ok(None),
        Some(30) | Some(60) => Ok(fps),
        Some(_) => Err("Unsupported FPS. Use 30 or 60.".to_string()),
    }
}

fn normalize_bitrate_kbps(bitrate_kbps: Option<u32>) -> Result<Option<u32>, String> {
    let Some(value) = bitrate_kbps else {
        return Ok(None);
    };

    if (1500..=50000).contains(&value) {
        return Ok(Some(value));
    }

    Err("Bitrate out of range. Use a value between 1500 and 50000 kbps.".to_string())
}

#[tauri::command]
pub fn list_native_capture_sources(window: Window) -> Result<Vec<NativeCaptureSource>, String> {
    windows_capture::list_sources(&window)
}

#[tauri::command]
pub fn start_native_capture(
    window: Window,
    service: State<NativeCaptureService>,
    request: StartNativeCaptureRequest,
) -> Result<NativeCaptureStatus, String> {
    let normalized = request.source_id.trim();
    if normalized.is_empty() {
        return Err(
            "A native capture source must be selected before starting screen share.".to_string(),
        );
    }

    let resolution = normalize_resolution(request.resolution)?;
    let fps = normalize_fps(request.fps)?;
    let bitrate_kbps = normalize_bitrate_kbps(request.bitrate_kbps)?;

    let sources = windows_capture::list_sources(&window)?;
    let selected_source = sources
        .iter()
        .find(|source| source.id == normalized)
        .cloned()
        .ok_or_else(|| {
            "Selected capture source is no longer available. Refresh and try again.".to_string()
        })?;

    let active_session = {
        let active_session = service
            .active_session
            .lock()
            .map_err(|_| "Native capture service lock was poisoned".to_string())?;
        active_session.clone()
    };

    if let Some(active) = active_session.as_ref() {
        if active.source_id == normalized
            && active.resolution == resolution
            && active.fps == fps
            && active.bitrate_kbps == bitrate_kbps
            && service.is_worker_active_for(normalized)?
            && windows_capture::is_capture_active_for(normalized)?
        {
            return service.current_status();
        }
    }

    service.start_sender_worker(normalized.to_string(), fps, bitrate_kbps)?;

    windows_capture::start_capture(
        &window,
        &NativeCaptureStartRequest {
            source_id: normalized.to_string(),
        },
    )
    .inspect_err(|_| {
        let _ = service.stop_sender_worker();
    })?;

    let mut active_session = service
        .active_session
        .lock()
        .map_err(|_| "Native capture service lock was poisoned".to_string())?;

    *active_session = Some(ActiveCaptureSession {
        source_id: normalized.to_string(),
        source_kind: selected_source.kind,
        resolution,
        fps,
        bitrate_kbps,
    });

    drop(active_session);
    service.current_status()
}

#[tauri::command]
pub fn stop_native_capture(
    service: State<NativeCaptureService>,
) -> Result<NativeCaptureStatus, String> {
    windows_capture::stop_capture()?;
    service.stop_sender_worker()?;

    let mut active_session = service
        .active_session
        .lock()
        .map_err(|_| "Native capture service lock was poisoned".to_string())?;

    *active_session = None;
    drop(active_session);

    service.current_status()
}

#[tauri::command]
pub fn native_capture_status(
    service: State<NativeCaptureService>,
) -> Result<NativeCaptureStatus, String> {
    service.current_status()
}
