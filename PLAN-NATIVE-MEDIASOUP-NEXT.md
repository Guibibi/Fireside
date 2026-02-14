# Native Sender -> Mediasoup Integration Plan (Next Session)

## Session Objective

- Move from local/native RTP debug path to real mediasoup publishing for Tauri native screen share.
- Keep hard fallback to browser `getDisplayMedia` path at all times.
- Keep server REST/WS contract stable unless a minimal additive change is strictly required.

## Master Checklist (Current Status)

- [x] Native Windows capture path publishes to mediasoup through server-managed native RTP ingest.
- [x] Native bootstrap uses additive WS signaling (`create_native_sender_session`) without breaking existing web flows.
- [x] Native sender uses server-negotiated RTP params (`rtp_target`, `payload_type`, `ssrc`) end-to-end.
- [x] Native-first startup falls back to browser capture on startup/runtime instability.
- [x] Native sender internals are modularized (`native_sender.rs`, `h264_encoder.rs`, `rtp_sender.rs`, `metrics.rs`).
- [x] Debug and diagnostics are production-safe (dev-gated panel + structured fallback/health fields).
- [x] Server native RTP target is configurable for remote deployment (`NATIVE_RTP_LISTEN_IP`, `NATIVE_RTP_ANNOUNCED_IP`).
- [x] Client emits structured diagnostic events for negotiation/fallback failures (`client_diagnostic`).
- [ ] Windows E2E validation matrix complete (screen/window/game capture, restart loops, forced fallback cases).
- [x] Keyframe request handling complete (PLI/FIR -> force IDR/intra).
- [ ] Performance hardening complete (copy minimization, queue tuning, adaptive degradation).
- [ ] Optional diagnostics-only UDP mirror finalized and explicitly feature/env-guarded.
- [ ] Codec expansion complete (VP8/VP9/AV1 where desired) with RTP packetizer support per codec.
- [ ] Hardware encoder support complete (NVENC first; optional AMF/QSV backends).
- [ ] Server/client codec negotiation for native sender generalized beyond fixed H264 profile.

## Session Handoff (Updated)

### What Landed This Session

- [x] Keyframe request handling wired end-to-end.
  - [x] Server native H264 producer advertises PLI/FIR RTCP feedback support
  - [x] Native RTP sender now polls RTCP feedback and detects PLI/FIR requests
  - [x] Native OpenH264 encoder forces intra/IDR frame on keyframe request
- [x] Performance hardening kickoff landed (initial pass).
  - [x] Reused YUV conversion buffer per frame dimensions to reduce allocation churn
  - [x] Queue capacity tuned for latency (`YANKCORD_NATIVE_FRAME_QUEUE_CAPACITY`, default 6)
  - [x] Adaptive degradation now drops frames under sustained queue pressure
  - [x] Adaptive degradation upgraded to moving-window queue pressure (avg + peak)
  - [x] Split counters added for dropped-before-encode vs dropped-during-send
- [x] Codec/packetizer abstraction scaffolding landed for follow-up expansion work.
  - [x] `VideoEncoderBackend` abstraction with current OpenH264 backend
  - [x] `RtpPacketizer` abstraction with current H264 RTP packetizer
  - [x] Encoder backend selector scaffold added (`YANKCORD_NATIVE_ENCODER_BACKEND`)
  - [x] NVENC module/feature scaffold added (`native-nvenc`, Windows-gated)
- [x] Codec/encoder expansion path drafted (`docs/native-codec-encoder-expansion.md`).

- [x] Native sender publishes into mediasoup via server-managed native RTP ingest.
  - [x] Additive WS action: `create_native_sender_session`
  - [x] Server creates mediasoup `PlainTransport` + screen `Producer` with canonical H264 RTP params
  - [x] Server returns native `rtp_target` (`ip:port`) for the Tauri sender
- [x] Tauri native start accepts dynamic `rtp_target` (no debug-env-only route).
- [x] Screen-share startup is native-first on Tauri, with browser fallback on native bootstrap failure.
- [x] Runtime fallback monitor is wired.
  - [x] Native sender instability reason polled from `native_capture_status`
  - [x] App closes native producer/capture and auto-switches to browser capture path
- [x] Native sender internals modularized (`native_sender.rs`, `h264_encoder.rs`, `rtp_sender.rs`, `metrics.rs`).
- [x] Diagnostics/dev UX updates landed.
  - [x] Debug panel is dev-gated (`import.meta.env.DEV` or `localStorage["yankcord_debug_native_sender"] === "1"`)
  - [x] Status includes fallback reason, degradation level, producer/transport state, lifecycle counters
- [x] RTP parameter alignment fixes landed.
  - [x] Native sender now uses server-negotiated `payload_type` + `ssrc`
  - [x] Client validates negotiated RTP params before native start
- [x] Remote deployment path fixes landed.
  - [x] Server native RTP bind/announce configuration added
  - [x] Docs/examples updated for native RTP deploy settings
- [x] Client-to-server diagnostic reporting landed for native failure classes.
- [x] Native degradation ladder now applies resolution and bitrate pressure controls.
  - [x] Level 2+ applies downscaled encode input before H264 encode
  - [x] Level 3 applies bitrate token-bucket cap on encoded output
  - [x] Degradation thresholds/scales are env-tunable for Windows pass calibration
- [x] Diagnostics-only UDP mirror path is now feature/env gated.
  - [x] Feature flag: `native-diagnostic-udp-mirror`
  - [x] Env guard: `YANKCORD_NATIVE_ENABLE_DIAGNOSTIC_UDP_MIRROR` + `YANKCORD_NATIVE_DIAGNOSTIC_UDP_MIRROR_TARGET`
- [x] Native sender status/diagnostics now include selected encoder backend.
  - [x] `native_capture_status.native_sender.encoder_backend`
  - [x] Client diagnostic events include encoder backend on native startup/runtime fallback

### Contract Impact

- Existing REST/WS contract preserved for current web flows.
- One additive media-signal action introduced: `create_native_sender_session`.

### Validated in CI/Local Linux

- `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
- `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
- `cargo test --manifest-path server/Cargo.toml`
- `cargo test --manifest-path client/src-tauri/Cargo.toml`
- `npm --prefix client run typecheck`
- `npm --prefix client run build`

### Remaining for Next Session

- [ ] Windows manual verification pass (end-to-end native publish + forced-fallback scenarios).
- [ ] Performance workstream items.
  - [x] Frame copy minimization / pooling (YUV reuse in OpenH264 path)
  - [x] Adaptive degradation ladder behavior (moving-window avg/peak pressure)
  - [x] Queue tuning split counters (before-encode vs during-send)
  - [x] Add resolution/bitrate degradation tiers (currently frame dropping only)
  - [ ] Tune ladder thresholds based on Windows manual runs
- [x] Optional diagnostics-only UDP mirror finalized as explicitly feature/env-guarded.
- [ ] Codec and encoder expansion implementation.
  - [x] Define backend abstraction for encoder and RTP packetizer by codec
  - [x] Add VP8/VP9/AV1 feasibility + rollout decision
  - [x] Add encoder backend selector + NVENC scaffold (feature/env-gated)
  - [ ] Implement real NVENC backend and runtime fallback policy
  - [x] Surface selected encoder backend in client diagnostics payload/status

## Current Baseline (Starting Point)

- Native pipeline exists: Windows capture -> BGRA frame queue -> H264 encode -> RTP packetization.
- Worker metrics/status are exposed and visible in UI debug panel.
- RTP output currently targets optional UDP endpoint via `YANKCORD_NATIVE_RTP_TARGET` (debug harness).
- Browser capture fallback path is still the production path.

## Main Deliverables

1. Wire native sender output into real mediasoup producer flow.
2. Add robust failure policy (auto-fallback on encode/send instability).
3. Improve frame-path efficiency and backpressure behavior.
4. Make debug visibility production-safe (dev-gated panel + richer telemetry).
5. Refactor native sender internals into focused modules.

## Workstream A: Mediasoup Wiring (Core)

### A1. Transport/Producer Strategy Decision

- Confirm target approach for this session:
  - Preferred: keep existing signaling semantics and add a Rust-side thin producer client.
  - Avoid introducing broad new server APIs unless unavoidable.
- Document selected path and expected message flow before coding.

### A2. Native Producer Session Bootstrap

- Implement Rust-side setup sequence for native publishing:
  - authenticate with existing WS session context
  - obtain/connect send transport
  - request producer creation with H264 RTP parameters
- Reuse existing channel/voice context from frontend state to avoid parallel auth models.

### A3. RTP Parameter Alignment

- Ensure encoded stream parameters match mediasoup expectations:
  - codec mime type: H264
  - packetization mode, profile-level-id, clock rate
  - SSRC/PT and RTCP expectations
- Keep mapping centralized in a single RTP capability helper.

### A4. Sender Runtime Hooks

- Replace debug-only UDP target as primary route with mediasoup transport send path.
- Keep optional UDP mirror as diagnostics-only (feature/env-guarded).
- Ensure keyframe request handling path exists (PLI/FIR -> force intra frame).

## Workstream B: Failure Policy and Fallback (Reliability)

### B1. Failure Classifier

- Define explicit fatal vs transient failures:
  - fatal: producer negotiation failure, transport closed, repeated encode failures
  - transient: occasional packet send miss, temporary queue pressure

### B2. Auto-Fallback Rules

- Add thresholds in native sender service, for example:
  - encode failures > N in rolling window
  - RTP send errors > N in rolling window
  - queue drops consistently above threshold for T seconds
- On threshold breach:
  - stop native worker/capture cleanly
  - emit structured event/reason
  - switch to existing browser capture path automatically

### B3. Idempotent Recovery

- Guard against start/stop races during fallback transitions.
- Ensure repeated stop/dispose calls are safe and leak-free.

## Workstream C: Performance and Backpressure

### C1. Frame Copy Minimization

- Profile current BGRA copy cost in callback.
- If safe with current capture API ownership rules, reduce allocations/copies:
  - buffer pooling or reusable frame arena
  - avoid extra clone paths in worker handoff

### C2. Adaptive Degradation

- Add simple downgrade ladder under sustained pressure:
  - lower fps first
  - then lower resolution tier
  - then reduce target bitrate
- Keep this bounded and observable through status metrics.

### C3. Queue Tuning

- Revisit bounded queue size and drop strategy for interactive latency.
- Track separate counters for dropped-before-encode vs dropped-during-send.

## Workstream D: UI/Diagnostics and Developer Experience

### D1. Dev-Gated Debug Panel

- Keep native sender debug panel, but gate display behind dev flag:
  - dev build or explicit debug setting
- Avoid exposing low-level transport details in standard user UX.

### D2. Diagnostics Surface

- Expand `native_capture_status` with health snapshot fields:
  - recent fallback reason
  - current degradation level
  - producer/transport connected state

### D3. Logging/Telemetry Conventions

- Use consistent event names and reason codes for:
  - sender_started / sender_stopped
  - encode_error / transport_error
  - fallback_triggered / fallback_completed

## Workstream E: Refactor and Structure

- Extract from `client/src-tauri/src/capture/service.rs` into focused modules:
  - `native_sender.rs` (worker lifecycle + thresholds)
  - `h264_encoder.rs` (frame conversion + encoder wrapper)
  - `rtp_sender.rs` (packetization + transport abstraction)
  - `metrics.rs` (shared counters/snapshots)
- Keep command surface and external types stable while refactoring.

## Proposed Execution Order (Next Session)

1. Implement transport/producer bootstrap skeleton and compile-safe plumbing.
2. Wire RTP send path to mediasoup transport abstraction.
3. Add fallback classifier + thresholds + event reasons.
4. Add dev gating for debug panel and status additions.
5. Apply targeted refactor into modules (no behavior changes after refactor).
6. Validate and run manual Windows checks.

## Acceptance Criteria

- Native Tauri share can publish to real mediasoup consumer path without local UDP receiver.
- On native sender instability, app auto-falls back to browser capture without stuck state.
- Non-Windows and web paths continue to work unchanged.
- Debug panel is hidden in normal UX unless explicitly enabled.
- Service code is modularized enough for follow-up codec/transport work.

## Validation Checklist

### Required Commands

- `cargo fmt --manifest-path client/src-tauri/Cargo.toml`
- `cargo check --manifest-path client/src-tauri/Cargo.toml`
- `npm --prefix client run typecheck`
- `npm --prefix client run build`

### Manual Verification (Windows)

- Start native share at 1080p30 and confirm remote participants receive stream.
- Verify stop/start loop remains stable across multiple cycles.
- Force error scenarios (invalid source, induced transport drop) and confirm auto-fallback.
- Confirm fallback reason is visible in diagnostics status/logs.
- Confirm debug panel visibility follows dev-gate rules.

## Risks and Mitigations

- Risk: H264 fmtp mismatch with mediasoup capabilities.
  - Mitigation: lock canonical codec parameter builder and log final negotiated params.
- Risk: sender thread complexity regresses lifecycle reliability.
  - Mitigation: strict state machine and idempotent teardown APIs.
- Risk: performance overhead at 1440p/4k tiers.
  - Mitigation: enforce adaptive downgrade and conservative defaults.

## Out of Scope for This Session

- Linux/macOS native capture/send path parity.
- New server protocol redesign.
- AV1/VP9 native encoding.
