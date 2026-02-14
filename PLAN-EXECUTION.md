# Yankcord Execution Plan (Consolidated)

This file consolidates active execution plans.

- Master roadmap remains in `PLAN.md`.
- This file replaces `PLAN-NATIVE-MEDIASOUP-NEXT.md` and `PHASE3_PLAN.md`.

## Track A: Native Sender -> Mediasoup

### Objective

- Keep Tauri native screen-share publishing to mediasoup stable.
- Preserve browser `getDisplayMedia` fallback behavior.
- Keep protocol changes additive/minimal.

### Current Status

- [x] Native RTP ingest flow is live via additive signaling.
- [x] Native sender uses negotiated RTP params (`rtp_target`, `payload_type`, `ssrc`).
- [x] Runtime fallback to browser capture is implemented.
- [x] Diagnostics and debug surfaces are in place.
- [x] Windows manual verification pass completed.
- [x] Performance hardening and threshold tuning completed.
- [x] NVENC-backed native path wired with fallback policy.
- [x] Native sender session signaling now carries additive codec negotiation fields (`codec`, `available_codecs`) with backwards-compatible H264 defaults.
- [x] Native RTP packetizer abstraction now supports codec-specific packetizers (H264 + VP8), while preserving H264 behavior.
- [x] VP9 native encoder + RTP packetizer path is implemented but kept negotiation-planned for controlled rollout.
- [x] Codec catalog/negotiation now advertises `VP8` as `ready` and keeps `VP9`/`AV1` as `planned`.
- [x] Codec expansion complete for AV1 native encoder + packetizer path.
- [x] Native sender codec negotiation is additive and codec-aware (`codec`, `available_codecs`) with H264-compatible legacy fields.

### Near-Term Next Steps

1. Implement AV1 native encoder backend + RTP packetizer path. (completed)
2. Add manual client screen-share codec selection (Auto/AV1/VP9/VP8/H264) and thread it through native + browser codec preference paths. (completed)
3. Keep backwards compatibility: default to H264 when codec fields are absent.
4. Keep web/browser flows unchanged.
5. Add client codec capability checks and disable unsupported manual codec selections in the native screen-share UI. (completed)

### Validation

- `cargo fmt --manifest-path client/src-tauri/Cargo.toml`
- `cargo check --manifest-path client/src-tauri/Cargo.toml`
- `cargo test --manifest-path client/src-tauri/Cargo.toml`
- `npm --prefix client run typecheck`
- `npm --prefix client run build`

## Track B: Phase 3 Voice & Video

### Goal

- Ship practical channel-scoped voice/video/screen-share with resilient reconnection and device-change handling.

### Milestone Status

- [x] 3.1 Voice presence and signaling contract.
- [x] 3.2 Mediasoup transport handshake.
- [x] 3.3 Audio publish/subscribe.
- [x] 3.4 Camera video publish/subscribe (core implementation).
- [x] 3.5 Screen sharing publish/subscribe (core implementation).
- [x] 3.6 Reliability/polish implementation items.

### Remaining QA / Exit Checks

- [x] Re-run multi-client QA focused on audio continuity while repeatedly toggling camera.
- [x] Verify screen share stability and channel isolation.
- [x] Verify reconnect and device-change stability.
- [x] Confirm exit criteria via manual matrix:
  - [x] Single user join/leave repeatedly.
  - [x] Two users audio-only mute/unmute.
  - [x] Two users audio+video toggle loops.
  - [x] Three users same-channel smoke.
  - [x] Users split across two channels isolation.
  - [x] Unexpected disconnect cleanup behavior.

### Validation

- `cargo check --manifest-path server/Cargo.toml`
- `cargo test --manifest-path server/Cargo.toml`
- `npm --prefix client run build`

## Track B Status

- Phase 3 implementation and manual QA are complete.
