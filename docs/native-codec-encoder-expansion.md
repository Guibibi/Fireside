# Native Sender Codec/Encoder Expansion Path

## Scope

This plan is for the Windows native screen-share sender path (`client/src-tauri`) that publishes RTP into mediasoup through the server-managed native sender session.

Goals:

- Keep current H264 baseline flow stable while adding expansion hooks.
- Roll out hardware acceleration incrementally, with NVENC first.
- Keep protocol changes additive and synchronized between server and client.

## Screen-Share Codec Support (Current)

- Router video codec capabilities include `VP8`, `H264`, `VP9`, and `AV1`.
- Browser screen-share publish path applies Windows preference order `AV1 -> VP9 -> H264`, with runtime-default fallback when preferred codecs are unavailable.
- `H265/HEVC` remains intentionally unsupported in the current stack.

## Current Baseline

- Native sender publishes H264 baseline (`profile-level-id=42e01f`, `packetization-mode=1`).
- Payload type and SSRC are negotiated by server and passed to Tauri sender.
- RTP packetizer is currently H264-only.

### Current Scaffolding Switches

- Encoder selection env var: `YANKCORD_NATIVE_ENCODER_BACKEND`
  - `auto` (default): try NVENC first, fallback to OpenH264
  - `nvenc`: force NVENC attempt, fallback to OpenH264 if unavailable
  - `openh264`: force software backend
- Build feature for NVENC wiring: `native-nvenc` (in `client/src-tauri/Cargo.toml`)
  - Current status: FFmpeg-backed NVENC path is wired behind feature/env and validated on Windows after switching to a persistent encoder process model.
- Runtime backend fallback threshold (used when NVENC backend is active):
  - `YANKCORD_NATIVE_NVENC_RUNTIME_FALLBACK_ENCODE_FAILURES` (default `12` consecutive failed encodes)
- Diagnostics-only UDP mirror (disabled by default):
  - Cargo feature: `native-diagnostic-udp-mirror`
  - Env opt-in: `YANKCORD_NATIVE_ENABLE_DIAGNOSTIC_UDP_MIRROR=1`
  - Mirror target: `YANKCORD_NATIVE_DIAGNOSTIC_UDP_MIRROR_TARGET=host:port`
- Degradation tuning knobs for Windows calibration:
  - `YANKCORD_NATIVE_DEGRADE_LEVEL1_AVG_DEPTH`, `YANKCORD_NATIVE_DEGRADE_LEVEL1_PEAK_DEPTH`
  - `YANKCORD_NATIVE_DEGRADE_LEVEL2_AVG_DEPTH`, `YANKCORD_NATIVE_DEGRADE_LEVEL2_PEAK_DEPTH`, `YANKCORD_NATIVE_DEGRADE_LEVEL2_SCALE_DIVISOR`
  - `YANKCORD_NATIVE_DEGRADE_LEVEL3_AVG_DEPTH`, `YANKCORD_NATIVE_DEGRADE_LEVEL3_PEAK_DEPTH`, `YANKCORD_NATIVE_DEGRADE_LEVEL3_SCALE_DIVISOR`
  - `YANKCORD_NATIVE_DEGRADE_LEVEL3_BITRATE_NUMERATOR`, `YANKCORD_NATIVE_DEGRADE_LEVEL3_BITRATE_DENOMINATOR`
  - `YANKCORD_NATIVE_DEGRADE_RECOVER_AVG_DEPTH`, `YANKCORD_NATIVE_DEGRADE_RECOVER_PEAK_DEPTH`

### Threshold Calibration Structure (Telemetry-Driven)

Use `native_capture_status.native_sender` pressure fields during Windows runs to tune threshold defaults with additive, low-risk adjustments:

- `pressure_window_avg_depth`: current moving-window queue average.
- `pressure_window_peak_depth`: current moving-window queue peak.
- `pressure_window_max_avg_depth`: max moving-window average seen in current sender lifetime.
- `pressure_window_max_peak_depth`: max moving-window peak seen in current sender lifetime.

Recommended default baseline for queue capacity `6` (current default):

- Keep level-1 entry near light pressure: avg `2`, peak `4`.
- Keep level-2 entry near sustained pressure: avg `4`, peak `6`.
- Keep level-3 entry near persistent overload: avg `6`, peak `7`.
- Keep recovery conservative: avg `1`, peak `2`.

Windows verification status:

- Manual Windows validation passed with this baseline/default ladder.
- Keep the current defaults as the recommended production starting point.
- Only override via env vars when a specific host/GPU profile shows sustained pressure or early quality drop.

Windows calibration pass guidance:

1. Run 1080p30 share for at least 2-3 minutes and record max pressure fields.
2. If `pressure_window_max_peak_depth` stays <= level-1 thresholds but drops still rise, reduce thresholds by 1.
3. If stream quality degrades too early while max pressure remains low, increase level-2/3 avg thresholds by 1.
4. Keep each level monotonic (`L1 <= L2 <= L3`) and adjust one notch per pass.

## Phase 1: Stabilize Abstractions (No New Codec Enabled)

1. Introduce encoder abstraction in `client/src-tauri/src/capture/service`:
   - `VideoEncoderBackend` trait: `encode_frame`, `request_keyframe`, `codec_descriptor`.
   - `CodecDescriptor`: codec id, fmtp/profile metadata, frame dependencies.
2. Introduce packetizer abstraction:
   - `RtpPacketizer` trait with codec-specific implementation.
   - Keep current FU-A H264 packetizer as first implementation.
3. Keep runtime default to software OpenH264 backend.

Exit criteria:

- No behavior change in current H264 flow.
- Keyframe request path works through encoder abstraction.

## Phase 2: NVENC First (H264)

Why first:

- Lowest protocol churn because media contract remains H264.
- Largest expected CPU relief on 1080p/1440p screen capture.

Plan:

1. Add NVENC-backed H264 encoder backend under Windows-only module.
2. Startup selection policy:
    - Prefer NVENC when available and healthy.
    - Fallback to OpenH264 automatically on init/runtime errors.
3. Surface backend selection in diagnostics (`encoder_backend: "nvenc" | "openh264"`).
4. Keep RTP payload shape and H264 fmtp aligned with server canonical profile.

Current implementation status:

- Startup/runtime fallback policy to OpenH264 is wired.
- Backend selection is surfaced via `native_capture_status.native_sender.encoder_backend` and client diagnostic events.
- Backend selection intent and fallback reason are surfaced via `encoder_backend_requested` and `encoder_backend_fallback_reason`.
- Runtime backend downgrade path is wired (NVENC -> OpenH264 on sustained encode failures).
- NVENC frame encode path is implemented via `ffmpeg` `h264_nvenc` bridge (`YANKCORD_NATIVE_NVENC_FFMPEG_PATH` override supported).
- NVENC runtime path now uses a long-lived `ffmpeg` process (not per-frame spawn), which removes startup overhead from steady-state encoding.

Windows verification note:

- Manual Windows validation confirmed expected behavior with the persistent process path.

Guardrails:

- Runtime fallback stays idempotent.
- No changes to web/browser screen-share behavior.

## Phase 3: Codec Negotiation Generalization

1. Add additive capability signaling for native sender codec preferences.
2. Extend server native sender session response with negotiated codec descriptor (additive fields).
3. Keep current fields (`rtp_target`, `payload_type`, `ssrc`) unchanged.
4. Keep old clients compatible by defaulting to H264 when codec fields are absent.

## Phase 4: VP8/VP9/AV1 Decision Matrix

Decision order should prioritize operational risk over theoretical efficiency.

- `VP8`
  - Pros: broad SFU/interoperability support, simpler profile handling than H264/AV1.
  - Cons: screen-content quality/bitrate tradeoffs can be worse than tuned H264.
  - Recommendation: first non-H264 candidate if cross-vendor software encode path is needed.
- `VP9`
  - Pros: better compression than VP8/H264 in many cases.
  - Cons: significantly higher encode cost; hardware availability varies.
  - Recommendation: defer until hardware-backed path is proven for target GPUs.
- `AV1`
  - Pros: best compression potential and future-proofing.
  - Cons: highest integration complexity and mixed realtime hardware encode support.
  - Recommendation: evaluate last for realtime native screen-share.

Suggested rollout:

1. H264 (OpenH264 + NVENC)
2. VP8 (if needed)
3. VP9 (hardware-backed only)
4. AV1 (hardware-backed only, explicit opt-in)

## Validation Expectations Per Phase

- Server changes: `cargo fmt --all --manifest-path server/Cargo.toml -- --check`, `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`, `cargo test --manifest-path server/Cargo.toml`
- Client TS changes: `npm --prefix client run typecheck`, `npm --prefix client run build`
- Tauri changes: `cargo test --manifest-path client/src-tauri/Cargo.toml`

## Non-Goals

- No Linux/macOS native capture parity in this plan.
- No forced protocol redesign; additive signaling only.
