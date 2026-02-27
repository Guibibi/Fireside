# Yankcord Screen Sharing Pipeline — Full Review

> Generated: 2026-02-27
> Branch: `chore/streaming-exploration`

## Table of Contents

- [Current Architecture Overview](#current-architecture-overview)
- [Current File Inventory](#current-file-inventory)
- [Detailed Component Analysis](#detailed-component-analysis)
- [The Problems](#the-problems)
- [Recommended Architecture](#recommended-architecture)
- [What to Delete](#what-to-delete)
- [What to Modify](#what-to-modify)
- [Future Additions](#future-additions)

---

## Current Architecture Overview

```
┌──────────────────────── CAPTURE LAYER ──────────────────────────┐
│                                                                   │
│  Screen Sources              Window/App Sources                  │
│  ┌─────────────────────┐    ┌──────────────────────────────┐    │
│  │ DXGI Desktop Dup.   │    │ windows-capture v1.5         │    │
│  │ (dxgi-capture-rs)   │    │ (Windows.Graphics.Capture)   │    │
│  │ → GPU ID3D11Texture │    │ → CPU BGRA Vec<u8>           │    │
│  └─────────┬───────────┘    └──────────────┬───────────────┘    │
│            │                                │                     │
│            └───────────┬────────────────────┘                    │
│                        ▼                                          │
│              dispatch_frame_external()                           │
│              SyncChannel (cap=16)                                │
│                        │                                          │
└────────────────────────┼──────────────────────────────────────────┘
                         ▼
┌──────────────────── ENCODE LAYER ───────────────────────────────┐
│                                                                   │
│  native_sender.rs (worker thread)                                │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ Adaptive degradation (3 levels)                           │   │
│  │ Frame skip / downscale / bitrate reduction                │   │
│  └──────────────────────────┬────────────────────────────────┘   │
│                              ▼                                    │
│  ┌──── Encoder Backend Selection (cascade) ─────────────────┐   │
│  │                                                            │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │   │
│  │  │ NVENC SDK    │→ │ NVENC/FFmpeg │→ │ OpenH264      │  │   │
│  │  │ (nvidia-     │  │ (subprocess) │  │ (software)    │  │   │
│  │  │  video-codec │  │ hevc_nvenc   │  │ Baseline      │  │   │
│  │  │  -sdk 0.4)   │  │ via stdin    │  │ BGRA→YUV420  │  │   │
│  │  └──────────────┘  └──────────────┘  └───────────────┘  │   │
│  │                                                            │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │   │
│  │  │ VP8/FFmpeg   │  │ VP9/FFmpeg   │  │ AV1/FFmpeg    │  │   │
│  │  │ (subprocess  │  │ (subprocess  │  │ (subprocess   │  │   │
│  │  │  libvpx)     │  │  libvpx-vp9) │  │  libaom-av1)  │  │   │
│  │  └──────────────┘  └──────────────┘  └───────────────┘  │   │
│  └────────────────────────────────────────────────────────────┘   │
│                              │                                    │
└──────────────────────────────┼────────────────────────────────────┘
                               ▼
┌──────────────────── TRANSPORT LAYER ────────────────────────────┐
│                                                                   │
│  rtp_sender.rs                                                   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ Custom RTP packetization (H264 FU-A, VP8/VP9/AV1 descs)  │   │
│  │ → Raw UDP to mediasoup PlainTransport                     │   │
│  │ ← RTCP feedback (PLI/FIR) for keyframe requests          │   │
│  └───────────────────────────────────────────────────────────┘   │
│                              │                                    │
│                              ▼                                    │
│  Server: mediasoup PlainTransport → Router → WebRTC Consumers   │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Current File Inventory

### Rust (Tauri Client) — Capture & Encoding

| File | Purpose | Lines (approx) |
|------|---------|-----------------|
| `client/src-tauri/src/capture/dxgi_capture.rs` | DXGI Desktop Duplication capture for monitors | ~250 |
| `client/src-tauri/src/capture/windows_capture.rs` | Windows Graphics Capture for windows/apps | ~200 |
| `client/src-tauri/src/capture/gpu_frame.rs` | GPU texture handle + CPU readback fallback | ~100 |
| `client/src-tauri/src/capture/service/encoder_backend.rs` | Encoder backend trait + codec descriptor types | ~150 |
| `client/src-tauri/src/capture/service/h264_encoder.rs` | OpenH264 software encoder (Baseline) | ~150 |
| `client/src-tauri/src/capture/service/nvenc_encoder.rs` | NVENC via FFmpeg subprocess (H264/HEVC) | ~300 |
| `client/src-tauri/src/capture/service/nvenc_sdk.rs` | NVENC SDK direct (CUDA + nvidia-video-codec-sdk) | ~250 |
| `client/src-tauri/src/capture/service/ffmpeg_ivf_encoder.rs` | VP8/VP9/AV1 via FFmpeg subprocess + IVF parsing | ~350 |
| `client/src-tauri/src/capture/service/native_sender.rs` | Main worker: frame recv → encode → RTP send loop | ~400 |
| `client/src-tauri/src/capture/service/rtp_sender.rs` | Custom RTP packetization + RTCP feedback | ~800 |

### TypeScript (SolidJS Client) — UI & Signaling

| File | Purpose |
|------|---------|
| `client/src/components/channel-list/ScreenShareModal.tsx` | Source picker + quality settings modal |
| `client/src/components/channel-list/hooks/useScreenShareModal.ts` | Modal state management hook |
| `client/src/api/nativeCapture.ts` | Tauri invoke wrappers for native capture |
| `client/src/api/media/producers.ts` | Browser + native screen producer setup |
| `client/src/api/media/native.ts` | Native capture arm/disarm helpers |
| `client/src/api/media/codecs.ts` | Codec selection + negotiation logic |
| `client/src/api/media/constraints.ts` | Video constraints (resolution/FPS) |
| `client/src/api/media/consumers.ts` | Remote video consumer setup |
| `client/src/api/media/transports.ts` | mediasoup transport initialization |
| `client/src/api/media/state.ts` | Screen share state signals |
| `client/src/components/VideoStage.tsx` | Video tile rendering |

### Rust (Server) — Media Routing

| File | Purpose |
|------|---------|
| `server/src/media/mod.rs` | MediaService: worker/router management |
| `server/src/media/router.rs` | Codec capabilities + media codec definitions |
| `server/src/media/transport.rs` | Transport/producer/consumer lifecycle |
| `server/src/media/native_codec.rs` | Native RTP codec support (H264, VP8, VP9, AV1) |
| `server/src/ws/media_signal.rs` | WebSocket signaling protocol |

### Cargo Dependencies

```toml
# Client Tauri
openh264 = "0.9.3"                    # H264 software encoding
dxgi-capture-rs = "1.2.1"             # DXGI Desktop Duplication
windows-capture = "1.5.0"             # Windows Graphics Capture API
windows = "0.58"                      # Direct3D11, DXGI bindings
nvidia-video-codec-sdk = "0.4.0"      # NVENC SDK (feature: native-nvenc)
cudarc = "0.16"                       # CUDA driver (feature: native-nvenc)

# Server
mediasoup = "0.20"                    # SFU media routing
```

---

## Detailed Component Analysis

### 1. DXGI Desktop Duplication (`dxgi_capture.rs`)

- Uses `IDXGIOutputDuplication::AcquireNextFrame()` with 100ms timeout
- Creates D3D11 device on the specific adapter matching the monitor
- Maintains a reusable staging texture (recreated on dimension changes)
- Enables `ID3D11Multithread` for cross-thread safety
- Error recovery: `DXGI_ERROR_ACCESS_LOST` → exponential backoff retry (up to 5 attempts)
- FPS throttling: configurable target FPS (default 60)
- Output: `GpuTextureHandle { texture: ID3D11Texture2D, device, width, height }`

### 2. Windows Capture (`windows_capture.rs`)

- Uses `windows-capture` crate's `NativeFrameHandler` trait
- Returns CPU-resident BGRA8 frames via `frame.buffer_without_padding()`
- Color format: `ColorFormat::Bgra8`
- Source discovery: `Monitor::enumerate()`, `WinWindow::enumerate()`
- Application grouping: synthetic grouping by process ID for multi-window apps
- Settings: cursor capture, border drawing, dirty region tracking

### 3. GPU Texture Handle (`gpu_frame.rs`)

- Bridges DXGI's GPU textures to CPU-only encoders
- Creates D3D11 staging texture with `D3D11_USAGE_STAGING + D3D11_CPU_ACCESS_READ`
- `CopyResource()` GPU → staging, then `Map(D3D11_MAP_READ)` for CPU access
- Row pitch handling for non-contiguous memory layouts

### 4. Encoder Backend Trait (`encoder_backend.rs`)

```rust
pub trait VideoEncoderBackend: Send {
    fn codec_descriptor(&self) -> CodecDescriptor;
    fn encode_frame(&mut self, bgra: &[u8], width: u32, height: u32, ...) -> Option<Vec<Vec<u8>>>;
    fn request_keyframe(&mut self) -> bool;
    fn encode_gpu_frame(&mut self, handle: &GpuTextureHandle, ...) -> GpuEncodeResult;
}
```

Two encode paths maintained for every backend: CPU (`encode_frame`) and GPU (`encode_gpu_frame`).

### 5. OpenH264 Encoder (`h264_encoder.rs`)

- Profile: Baseline (no CABAC, no B-frames)
- BGRA → YUV420 conversion via `BgraSliceU8::new()` + `YUVBuffer::read_rgb()`
- Reusable YUV buffer cached across frames
- NAL extraction with Annex B start code stripping
- Default: 8 Mbps CBR, min 500 Kbps

### 6. NVENC FFmpeg Subprocess (`nvenc_encoder.rs`)

- Spawns `ffmpeg` child process with stdin/stdout pipes
- Pipes raw BGRA frames over stdin (~8MB/frame at 1080p)
- Command: `ffmpeg -f rawvideo -video_size WxH -pixel_format bgra -framerate FPS -i pipe:0 -c:v hevc_nvenc -preset p4 -rc cbr -b:v BITRATE -f null pipe:1`
- Stall detection: if submitted frames >> reported frames → error
- Consecutive empty output threshold: 3 before error

### 7. NVENC SDK (`nvenc_sdk.rs`)

- Creates CUDA context on device 0
- Codec: `NV_ENC_CODEC_H264_GUID`
- Preset: `NV_ENC_PRESET_P4_GUID` + `NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY`
- Rate control: CBR
- Buffer format: `NV_ENC_BUFFER_FORMAT_ARGB` (accepts BGRA directly)
- Buffer pool: 4 input buffers + 4 output bitstream objects
- Can accept D3D11 textures directly (zero-copy)

### 8. FFmpeg IVF Encoder (`ffmpeg_ivf_encoder.rs`)

- Similar subprocess model to NVENC FFmpeg
- Codec configs: VP8 (`libvpx`, deadline realtime, cpu-used 6), VP9 (`libvpx-vp9`), AV1 (`libaom-av1`, usage realtime, cpu-used 8)
- IVF container parsing: 32-byte header + 12-byte frame headers
- Timeout: 1.5s per frame

### 9. Native Sender Worker (`native_sender.rs`)

- Receives `NativeFramePacket` from frame sink (capacity 16)
- Pressure monitoring every 250ms
- Adaptive degradation (3 levels):
  - Level 1: Drop 50% frames
  - Level 2: Downscale 2x, reduce bitrate 70%
  - Level 3: Downscale 4x, reduce bitrate to 70%
- Failure thresholds (12-second window): encode errors > 18, RTP errors > 18, queue drops > 220 → browser fallback
- Resolution cap: 1920x1080 default

### 10. RTP Sender (`rtp_sender.rs`)

- H264: Single NAL direct or FU-A fragmentation
- VP8: 4-byte payload descriptor
- VP9: Variable-length payload descriptor with PictureID, TL0PICIDX
- AV1: OBU header + sequence number + layer info
- RTCP feedback parsing: PLI (FMT=1), FIR (FMT=4)
- Default SSRC: `0x4E41_5456` ("NATV")

### 11. Server Codec Support

- H264: PT=96, Baseline 42e01f, packetization-mode=1
- VP8: PT=98
- VP9: PT=100
- AV1: PT=102 (marked "Planned, not Ready")
- RTCP feedback: NackPli, CcmFir for all video codecs
- No server-side transcoding (pure SFU passthrough)

---

## The Problems

### 1. Two Competing Capture Backends

| Aspect | DXGI Desktop Duplication | windows-capture (WGC) |
|--------|--------------------------|------------------------|
| Used for | Screen/monitor capture | Window/app capture |
| Output | GPU texture (ID3D11Texture2D) | CPU BGRA buffer |
| Crate | `dxgi-capture-rs` v1.2.1 | `windows-capture` v1.5.0 |
| Border | None | Configurable |
| Thread | `dxgi-capture` | `zed-scap` |

**Issues:**
- Two different frame formats force dual encode paths in every encoder backend
- `GpuTextureHandle` CPU readback exists solely to bridge DXGI GPU textures to CPU encoders
- DXGI Desktop Duplication is a legacy API (Windows 8 era) — Microsoft recommends WGC
- DXGI has poor multi-GPU, HDR, and DRM content handling vs WGC

### 2. Six Encoder Backends

| Backend | Mechanism | Codec |
|---------|-----------|-------|
| OpenH264 | In-process library | H264 Baseline |
| NVENC via FFmpeg | Subprocess (stdin/stdout pipe) | H264/HEVC |
| NVENC SDK | In-process (CUDA + SDK) | H264 |
| VP8 via FFmpeg | Subprocess | VP8 |
| VP9 via FFmpeg | Subprocess | VP9 |
| AV1 via FFmpeg | Subprocess | AV1 |

**Issues:**
- 4/6 backends spawn FFmpeg as a subprocess, piping ~480 MB/s of raw BGRA at 1080p60
- NVENC FFmpeg and NVENC SDK are redundant (both encode H264 with NVENC)
- OpenH264 is Baseline-only (worst H264 quality profile)
- VP8/VP9/AV1 through FFmpeg subprocess with IVF parsing is enormously complex

### 3. Custom RTP Implementation (~800+ lines)

Hand-rolled RTP with H264 FU-A, VP8/VP9/AV1 payload descriptors, and RTCP parsing. Must stay in sync with mediasoup's expectations.

### 4. Codec Sprawl Without Value

- VP8 is ancient (2010), no hardware decode advantage
- VP9 via FFmpeg subprocess is software-only
- AV1 is marked "not ready" on the server
- Only H264 benefits from NVENC

### 5. Fragile Fallback Chain

```
NVENC SDK → NVENC FFmpeg → OpenH264 → Browser WebRTC (!)
```

Browser fallback defeats the purpose of native capture.

---

## Recommended Architecture

### Capture: Unify on `windows-capture`

| Factor | DXGI Desktop Duplication | windows-capture (WGC) |
|--------|--------------------------|------------------------|
| API age | Windows 8 (2012) | Windows 10 1903+ (2019) |
| Monitor capture | Yes | Yes |
| Window capture | No | Yes |
| App capture | No | Yes |
| HDR support | Limited | Yes |
| Multi-GPU | Problematic | Handled by OS |
| DRM content | Blocked | Partially handled |
| Yellow border | N/A | Removable (Win 11 22H2+) |
| Performance | ~0.3ms/frame | ~0.5ms/frame |
| GPU texture output | Yes | Yes (Direct3D11CaptureFrame) |

**Key**: `windows-capture` can expose GPU-resident `Direct3D11CaptureFrame` → `ID3D11Texture2D` for zero-copy NVENC encoding.

### Encoding: Two Backends Only

```
┌─────────────── Encoder Selection ───────────────┐
│                                                    │
│  ┌──────────────────┐    ┌────────────────────┐  │
│  │ NVENC SDK        │    │ OpenH264           │  │
│  │ (primary)        │    │ (fallback)         │  │
│  │ H264 High        │    │ H264 Baseline     │  │
│  │ GPU texture in   │    │ CPU BGRA in       │  │
│  │ Zero-copy encode │    │ Software encode   │  │
│  └──────────────────┘    └────────────────────┘  │
│                                                    │
│  Try NVENC SDK → Success? Use it                  │
│                → Fail?    Use OpenH264            │
└────────────────────────────────────────────────────┘
```

### Codec: Upgrade H264 Profile

| Profile | Quality | Features | Compatible? |
|---------|---------|----------|-------------|
| Baseline (current) | Lowest | No CABAC, no B-frames | Yes |
| Main | Good | CABAC, B-frames optional | Yes |
| **High (recommended)** | **Best** | **8x8 transform, more ref frames** | **Yes, all modern decoders** |

Recommended: H264 High profile, `profile-level-id: 640028` (Level 4.0, 1080p60).

### Transport: H264-Only RTP

Delete VP8/VP9/AV1 payload descriptor code (~400 lines). Keep H264 FU-A + RTCP PLI/FIR.

### Proposed Simplified Architecture

```
┌──────────────────── CAPTURE ────────────────────────────────────┐
│                                                                   │
│  windows-capture (unified for ALL sources)                       │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ Monitor capture  ─┐                                        │   │
│  │ Window capture   ─┼→ Direct3D11CaptureFrame               │   │
│  │ App capture      ─┘   (GPU-resident texture)              │   │
│  │                                                             │   │
│  │ Settings:                                                   │   │
│  │  • draw_border: false                                      │   │
│  │  • cursor_capture: configurable                            │   │
│  │  • color_format: Bgra8                                     │   │
│  └──────────────────────────────┬────────────────────────────┘   │
│                                  │                                │
│                    GPU ID3D11Texture2D                            │
│                                  │                                │
└──────────────────────────────────┼────────────────────────────────┘
                                   ▼
┌──────────────────── ENCODE ─────────────────────────────────────┐
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  NVENC SDK (primary)                                     │    │
│  │  • H264 High profile                                    │    │
│  │  • Zero-copy: GPU texture → NVENC input                 │    │
│  │  • Preset: P4 + Ultra Low Latency tuning                │    │
│  │  • Rate control: CBR                                    │    │
│  │  • GOP: 1-2 seconds                                     │    │
│  │  • Output: H264 NAL units (Annex B stripped)            │    │
│  └─────────────────────────┬───────────────────────────────┘    │
│                             │ (fallback if no NVIDIA GPU)        │
│  ┌─────────────────────────▼───────────────────────────────┐    │
│  │  OpenH264 (fallback)                                     │    │
│  │  • H264 Baseline (unavoidable with OpenH264)            │    │
│  │  • CPU: GPU readback → BGRA → YUV420 → encode          │    │
│  │  • Same NAL unit output format                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│  Adaptive degradation: frame skip → downscale → bitrate cut    │
│                                                                   │
└──────────────────────────────────┬──────────────────────────────┘
                                   ▼
┌──────────────────── TRANSPORT ──────────────────────────────────┐
│                                                                   │
│  RTP Sender (H264 only)                                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ • Single NAL → direct RTP packet                          │  │
│  │ • Large NAL → FU-A fragmentation                          │  │
│  │ • RTCP feedback: PLI/FIR → keyframe request               │  │
│  │ • UDP → mediasoup PlainTransport                          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## What to Delete

| File/Module | Lines (approx) | Reason |
|-------------|-----------------|--------|
| `dxgi_capture.rs` | ~250 | Replaced by unified windows-capture |
| `gpu_frame.rs` | ~100 | DXGI-only bridge; windows-capture handles GPU textures |
| `nvenc_encoder.rs` | ~300 | Redundant FFmpeg subprocess NVENC path |
| `ffmpeg_ivf_encoder.rs` | ~350 | VP8/VP9/AV1 FFmpeg subprocess encoders |
| VP8/VP9/AV1 RTP in `rtp_sender.rs` | ~400 | Only H264 needed |
| VP8/VP9/AV1 in `native_codec.rs` (server) | ~60 | Server codec cleanup |
| VP8/VP9/AV1 in `encoder_backend.rs` | ~80 | Backend enum cleanup |
| `dxgi-capture-rs` dependency | — | No longer needed |

**Estimated removal: ~1,500 lines**

---

## What to Modify

### 1. `windows_capture.rs` — GPU texture output

```rust
// Current (CPU copy, slow)
let buffer = frame.buffer_without_padding()?;

// Target (GPU texture, zero-copy to NVENC)
let surface = frame.as_raw_frame();  // ID3D11Texture2D
```

### 2. `nvenc_sdk.rs` — Upgrade H264 profile

```rust
// Current: implicit Baseline
// Target: High profile
NV_ENC_CODEC_H264_GUID + NV_ENC_H264_PROFILE_HIGH_GUID + Level 4.0
```

### 3. Server `native_codec.rs` — Update profile-level-id

```rust
// Current
"profile-level-id" => "42e01f"  // Baseline Level 3.1

// Target
"profile-level-id" => "640028"  // High Level 4.0
```

### 4. `encoder_backend.rs` — Simplify trait

Remove dual encode path. Single `encode_frame` accepting either GPU texture or CPU buffer.

---

## Future Additions (Not Now)

| Feature | When | Why |
|---------|------|-----|
| NVENC AV1 | AV1 decode universal in browsers | 30-50% bitrate savings |
| AMD AMF H264 | AMD GPU support needed | Same zero-copy pattern |
| Intel QSV H264 | Intel iGPU support needed | Via oneVPL SDK |
| HEVC/H265 | Probably never for WebRTC | Safari doesn't support H265 in WebRTC |
