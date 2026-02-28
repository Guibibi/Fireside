## Context

Screen sharing was removed from Yankcord (commit 761a9a8) to eliminate legacy complexity — DXGI fallbacks, multi-codec support (VP8/VP9/AV1), and FFmpeg encoder dependencies. The server currently supports `microphone` and `camera` sources only. The `capture_v2/` module namespace is reserved for the clean rebuild.

The existing media infrastructure uses mediasoup with WebRTC transports for mic/camera. The new native capture pipeline on Windows needs a different transport path because the Tauri process controls encoding directly (not the browser's WebRTC stack).

Key constraints:
- Windows-first (WGC API requires Windows 10 1903+)
- H264-only codec (profile 640028, High 4.0)
- Self-hosted deployment (no public internet NAT traversal needed for PlainTransport)
- Tauri v2 command surface for JS↔Rust bridge

## Goals / Non-Goals

**Goals:**
- Establish typed contracts for screen media source across server, client types, and Tauri commands
- Deliver working native screen capture → encode → send pipeline on Windows
- Enable remote participants to view screen shares in voice channels
- Provide start/stop/error lifecycle with clean recovery
- Surface lightweight operational telemetry

**Non-Goals:**
- Selected-application audio capture (M2)
- NVENC hardware encoding (M3)
- Adaptive bitrate / frame pacing under load (M1.5)
- Cross-platform capture (macOS/Linux)
- Stream overlays or deep diagnostics UI

## Decisions

### D1: PlainTransport for native RTP delivery

**Choice**: Tauri sends raw RTP/UDP to a mediasoup PlainTransport on the server.

**Alternatives considered**:
- *WebRTC Transport via webview*: Would require shuttling ~8MB/s of BGRA frames through Tauri IPC to the browser's RTCPeerConnection. Defeats native encoding control and adds latency.
- *DataChannel bridge*: Encode in Tauri, send H264 over DataChannel, reassemble on server. Adds complexity on both sides for no benefit over direct UDP.

**Rationale**: PlainTransport is the simplest path. The Tauri process has full control over encoding parameters and frame pacing. Since Yankcord is self-hosted, the lack of SRTP encryption is acceptable for M1. The server creates a PlainTransport, tells the client the IP:port, and the Tauri sender pushes RTP packets directly.

### D2: Staged pipeline with ring-buffer decoupling

**Choice**: Three-thread pipeline: Capture → (ring_channel) → Encode → (bounded channel) → Send.

```
[Capture Thread]  →  ring_channel(1)  →  [Encode Thread]  →  crossbeam bounded(2)  →  [Send Thread]
     WGC callback                          BGRA→I420 +                                  RTP packetize
     ~60fps BGRA                           OpenH264 encode                              + UDP send
```

**Rationale**: Ring buffer between capture and encode ensures the capture callback never blocks (WGC requires fast return). The encoder always gets the latest frame — if it's slow, stale frames are silently overwritten. Bounded channel between encode and send provides backpressure without unbounded memory growth.

### D3: OpenH264 software encoder for M1 baseline

**Choice**: `openh264` crate v0.6 with NASM acceleration.

**Alternatives considered**:
- *x264*: Better quality at equivalent bitrate, but the Rust crate is unmaintained, Windows build requires MSYS2, and it's GPL-licensed.
- *No encoder (passthrough)*: Not viable — WGC provides BGRA, mediasoup expects H264 RTP.

**Rationale**: OpenH264 with NASM achieves ~8ms/frame at 1080p, comfortably within the 16.67ms budget for 60fps. Baseline profile limitations (no B-frames) are actually desirable for low-latency streaming. Quality is acceptable at streaming bitrates (4-8 Mbps). Cisco's binary license makes distribution simple.

### D4: Color conversion via dcv-color-primitives

**Choice**: `dcv-color-primitives` v0.7 for BGRA→I420.

**Rationale**: AWS-maintained, SIMD-accelerated (SSE2/AVX2 auto-detected), < 2ms per 1080p frame. Supports both BT.601 and BT.709 color spaces. Used in production by AWS DCV remote desktop.

### D5: Custom H264 RTP packetizer

**Choice**: Custom implementation (~200 LOC) rather than pulling in the full `webrtc-rs` crate.

**Rationale**: H264 RTP packetization (RFC 6184) is straightforward: parse NAL units, fragment large NALUs into FU-A packets, set marker bits. The prior pipeline had working packetizer code. Pulling in `webrtc-rs` would add a massive dependency tree for a small piece of functionality.

### D6: Source enumeration via windows-capture built-ins

**Choice**: Use `Monitor::enumerate()` and `Window::enumerate()` from the `windows-capture` crate.

**Rationale**: Already provides monitor names, indices, primary status, and window titles. Sufficient for M1 source picker. Richer metadata (thumbnails, icons) can be added in a follow-up using Win32 APIs directly.

### D7: Modal source picker + overlay/spotlight viewer

**Choice**: SolidJS modal dialog for source selection; overlay/spotlight layout for remote viewing.

**Rationale**: Modal with thumbnails is the expected UX pattern (Discord, Teams, Zoom). Overlay/spotlight gives screen shares visual prominence — camera tiles shrink to the side, screen content fills the main area.

### D8: Lifecycle state machine

**Choice**: Explicit state enum for capture sessions: `Starting → Running → Degraded → Stopping → Stopped | Failed`.

**Rationale**: Clear state transitions prevent invalid operations (e.g., stopping an already-stopped session). The `Degraded` state allows telemetry-driven fallback without full failure. Each transition is communicated to the client via Tauri events.

## Risks / Trade-offs

- **OpenH264 quality at lower bitrates** → Mitigate by defaulting to 4-8 Mbps for 1080p60. Quality is acceptable at these rates; M3 NVENC will be significantly better.
- **PlainTransport lacks encryption** → Acceptable for self-hosted M1. Can add SRTP key exchange in a follow-up or use network-layer encryption (WireGuard, etc).
- **Single-threaded encode bottleneck** → OpenH264 with NASM has ~5ms headroom at 1080p60. If the CPU is too weak, pipeline degrades to lower FPS rather than crashing. M1.5 will add adaptive frame pacing.
- **windows-capture crate update** → v1.5 is actively maintained. Pin the version to avoid breaking changes.
- **PlainTransport port management** → Server needs to allocate and track UDP ports per screen share session. Use mediasoup's built-in port range management to avoid conflicts.
