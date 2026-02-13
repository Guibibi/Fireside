# Native Sender -> Mediasoup Integration Plan (Next Session)

## Session Objective

- Move from local/native RTP debug path to real mediasoup publishing for Tauri native screen share.
- Keep hard fallback to browser `getDisplayMedia` path at all times.
- Keep server REST/WS contract stable unless a minimal additive change is strictly required.

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
