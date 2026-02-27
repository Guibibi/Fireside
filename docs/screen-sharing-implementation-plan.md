# Screen Sharing Pipeline Simplification — Implementation Plan

> Created: 2026-02-27
> Updated: 2026-02-27 — Phases 1–6 complete
> Related: [Pipeline Review](./screen-sharing-pipeline-review.md)

## Goal

Replace the dual-capture (DXGI + windows-capture) + six-encoder-backend architecture with a unified `windows-capture`-only capture layer and two encoder backends (NVENC SDK + OpenH264 fallback), targeting H264 only.

**Outcome**: ~1,500 lines removed, no FFmpeg subprocess dependency, simpler maintenance, same or better performance.

---

## Phase 1: Unify Capture on `windows-capture` ✅ DONE

> Completed 2026-02-27. Branch: `chore/streaming-exploration`. Build clean, zero warnings.

- `dxgi_capture.rs` and `gpu_frame.rs` deleted. All sources now route through `windows_capture::start_capture`.
- `GpuEncodeResult`/`encode_gpu_frame()` removed from `VideoEncoderBackend` trait.
- `NvencD3D11Session` removed from `nvenc_sdk.rs`; NVENC SDK is now CUDA CPU-BGRA only.
- `dxgi-capture-rs` removed from `Cargo.toml`.

---

## Phase 2: Simplify Encoder Backends ✅ DONE

> Completed 2026-02-27. Branch: `chore/streaming-exploration`. Both default and `native-nvenc` builds clean, zero warnings.

- `nvenc_encoder.rs` and `ffmpeg_ivf_encoder.rs` deleted.
- `encoder_backend.rs`: `NativeCodecTarget` H264-only; `EncoderPreference::Nvenc` removed; fallback cascade simplified to NVENC SDK → OpenH264.
- `native_sender.rs`: `create_packetizer_for_codec` H264-only; runtime fallback check cleaned up.
- `service.rs`: codec capabilities list H264-only.

**Note:** Phase 3 (RTP cleanup) was completed alongside this phase.

---

## Phase 3: Simplify RTP Transport ✅ DONE (completed with Phase 2)

- `rtp_packetizer.rs`: `RtpCodecKind` enum and `codec` field eliminated; `CodecRtpPacketizer::new` simplified.
- `rtp_sender.rs`: `send_vp8/vp9/av1_frames`, private helpers, and `leb128` utilities removed (~175 lines).

---

## Phase 4: Server-Side Cleanup ✅ DONE

> Completed 2026-02-27. Branch: `chore/streaming-exploration`.

### Step 4.1 — Update native codec support ✅

- `NativeVideoCodec` enum collapsed to `H264` only; `Vp8`, `Vp9`, `Av1` variants removed.
- `from_preference_list()` simplified — always returns `H264`.
- `all_for_advertisement()` returns `[H264]` (was 4-element array).
- `profile-level-id` updated to `"640028"` (H264 High Level 4.0, was `"42e01f"` Baseline 3.1).
- Dead VP8/VP9/AV1 constants removed.
- `native_rtp_parameters()` mime_type match collapsed to `MimeTypeVideo::H264`.

### Step 4.2 — Router codec capabilities ✅ (unchanged by design)

Router `media_codecs()` still advertises VP8, H264, VP9 for browser WebRTC; no change needed.

---

## Phase 5: Client-Side TypeScript Cleanup ✅ DONE

> Completed 2026-02-27. No code changes required — all TS was already clean.

- `codecs.ts`: `nativePreferredCodecsFor()` already returns `["video/H264"]` only. Browser fallback in `selectScreenShareCodecForPlatform` intentionally kept.
- `nativeCapture.ts`: `codec_mime_type` typed as `string` (no dead codec union). `NativeCodecCapability` has no dead fields.
- `ScreenShareModal.tsx`: No codec picker exists; nothing to remove.

---

## Phase 6: Dependency Cleanup ✅ DONE

> Completed 2026-02-27.

### Step 6.1 — Removed `windows` crate ✅

- Verified zero direct `use windows::Win32` references in `src/`; all Windows API access goes through `windows-capture` crate.
- Removed `windows = { version = "0.58", features = [...] }` from `client/src-tauri/Cargo.toml`.

### Step 6.2 — FFmpeg env vars ✅ (already gone)

- `YANKCORD_NATIVE_VP8/VP9/AV1_FFMPEG_PATH` were removed with the FFmpeg encoders in Phase 2+3.

---

## Phase 7: Testing & Validation

### Step 7.1 — Build verification

```bash
cd client && cargo build                    # Default features
cd client && cargo build --features native-nvenc  # With NVENC SDK
```

### Step 7.2 — Functional testing matrix

| Scenario | Source | Encoder | Expected |
|----------|--------|---------|----------|
| Screen share with NVIDIA GPU | Monitor | NVENC SDK (H264 High) | Smooth 1080p60 |
| Screen share without NVIDIA | Monitor | OpenH264 (H264 Baseline) | Working 1080p30 |
| Window share with NVIDIA | Window | NVENC SDK (H264 High) | Smooth, no yellow border |
| Window share without NVIDIA | Window | OpenH264 | Working |
| App share | Application | Same cascade | Working |
| Keyframe request (PLI) | Any | Any | Immediate IDR frame |
| Adaptive degradation | Any | Any | Frame drop → downscale under pressure |
| Browser fallback | Any | Any | Falls back to browser getDisplayMedia |

### Step 7.3 — Performance validation

- Verify CPU usage is not higher than DXGI path (should be similar or lower)
- Verify no frame drops at 60fps 1080p with NVENC
- Verify latency is not regressed (measure end-to-end)

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `windows-capture` monitor capture has edge cases | Capture failure for some monitors | Keep browser fallback path intact; test on multi-monitor setups |
| H264 High profile not decoded by old browsers | Broken video for some consumers | Level 4.0 is supported by every browser since 2015; test with Chrome, Firefox, Edge |
| NVENC SDK version pinned (`=0.4.0`) due to transmute | Can't easily upgrade | Unchanged; same risk as before |
| Yellow border on older Windows 10 | UX regression vs DXGI | `draw_border: false` works on Win 10 20H1+; document minimum Windows version |
