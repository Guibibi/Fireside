## Why

The native screen capture pipeline was intentionally removed to eliminate legacy complexity (DXGI, multi-codec, FFmpeg). Screen sharing is a core feature for game streaming in voice channels and needs to be rebuilt with a clean, modular, native-first architecture on Windows. M0 + M1 establishes contracts and delivers a working native video MVP.

## What Changes

- Reintroduce `screen` as a media source type across server signaling, client types, and Tauri commands.
- Add server-side PlainTransport support so the Tauri native capture pipeline can send raw RTP/UDP directly to mediasoup without DTLS/SRTP.
- Create `capture_v2/` Tauri module with source enumeration (monitors + windows), software H264 encoding (OpenH264), BGRA→I420 color conversion (dcv-color-primitives), RTP packetization, and UDP sender.
- Add capture pipeline orchestration with lifecycle states (starting, running, degraded, stopping, stopped, failed) and backpressure handling via ring-buffer decoupling.
- Add modal source picker UI with thumbnails for monitors and windows.
- Add overlay/spotlight viewer for remote screen share consumption.
- Add lightweight capture telemetry (capture FPS, encode FPS, queue depth, dropped frames).
- Add screen share start/stop controls in the voice dock.

## Capabilities

### New Capabilities

- `native-capture-pipeline`: Tauri-side capture loop, color conversion, H264 software encoding, RTP packetization, and UDP send pipeline with ring-buffer backpressure.
- `screen-source-signaling`: Server and client contracts for `screen` media source — PlainTransport creation, screen producer lifecycle, and WS signaling extensions.
- `screen-share-ui`: Source picker modal, voice dock controls (start/stop), overlay/spotlight remote viewer, and screen tile management.
- `capture-telemetry`: Lightweight operational metrics for capture FPS, encode FPS, queue depth, dropped frames, and send errors.

### Modified Capabilities

_(none — all prior screen sharing code was removed; these are net-new capabilities)_

## Impact

- **Server** (`server/src/ws/media_signal.rs`, `server/src/media/`): New `screen` source validation, PlainTransport creation endpoint, screen producer routing.
- **Client types** (`client/src/api/media/types.ts`, `signaling.ts`): `MediaSource` union extended, new signaling actions for PlainTransport and screen lifecycle.
- **Tauri** (`client/src-tauri/`): New `capture_v2/` module tree, new Cargo dependencies (`windows-capture`, `openh264`, `dcv-color-primitives`, `ring-channel`).
- **Client UI** (`client/src/components/`): New ScreenShareModal, StreamViewOverlay, voice dock screen share button.
- **Tauri ↔ Client bridge**: New Tauri commands for source enumeration, capture start/stop, telemetry queries.
