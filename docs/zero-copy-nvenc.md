# Windows Native Screen Share Rewrite (H264-first)

This document now tracks the post-NVENC rewrite architecture.

## Status

- Legacy DXGI desktop duplication modules are removed from active runtime use.
- Legacy NVENC SDK and subprocess x264 backends are removed from the service layer.
- Windows native capture now runs through `zed-scap`.
- Windows native encoding now runs in-process through `playa-ffmpeg`.

## Runtime Pipeline

1. `list_native_capture_sources` resolves Windows sources from `zed-scap` targets.
2. Selected source id (`screen:*`, `window:*`, `application:*`) resolves to a concrete `zed-scap` target.
3. Capture loop produces normalized `bgra8` frame bytes (`NativeFrameData::CpuBgra`).
4. Sender worker consumes `bgra8` frames, applies FPS/pressure logic, and encodes H264 in-process.
5. Encoded Annex B NAL units are packetized and sent on the existing RTP path.

## Encoder Selection Policy

Requested backend can be:

- `auto`
- `h264_nvenc`
- `h264_qsv`
- `h264_amf`
- `libx264`

When `auto` is selected, backend probe order is deterministic:

1. `h264_nvenc`
2. `h264_qsv`
3. `h264_amf`
4. `libx264`

The selected backend and any probe fallback reason are reported through `native_capture_status.native_sender` diagnostics.

## Compatibility Notes

- Tauri command names remain unchanged:
  - `list_native_capture_sources`
  - `native_codec_capabilities`
  - `start_native_capture`
  - `stop_native_capture`
  - `native_capture_status`
- Native sender codec gate remains H264-only (`video/H264`) for this phase.
- `native-nvenc` is retained as a compatibility feature alias, but no longer controls a dedicated NVENC SDK code path.

## Build/Packaging Notes

- Bundled `client/src-tauri/bin/ffmpeg.exe` is no longer required.
- `client/src-tauri/build.rs` no longer enforces an FFmpeg binary bundle.
- Release workflow no longer validates CUDA/NVIDIA Video Codec SDK paths.
