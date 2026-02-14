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
- [ ] Codec expansion complete (VP8/VP9/AV1 native packetizer paths as desired).
- [ ] Native sender codec negotiation generalized beyond fixed H264 profile.

### Near-Term Next Steps

1. Add codec-specific native RTP packetizer support where needed beyond H264.
2. Generalize native sender session negotiation to return negotiated codec descriptor(s) additively.
3. Keep backwards compatibility: default to H264 when codec fields are absent.
4. Keep web/browser flows unchanged.

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

- [ ] Re-run multi-client QA focused on audio continuity while repeatedly toggling camera.
- [ ] Verify screen share stability and channel isolation.
- [ ] Verify reconnect and device-change stability.
- [ ] Confirm exit criteria via manual matrix:
  - [ ] Single user join/leave repeatedly.
  - [ ] Two users audio-only mute/unmute.
  - [ ] Two users audio+video toggle loops.
  - [ ] Three users same-channel smoke.
  - [ ] Users split across two channels isolation.
  - [ ] Unexpected disconnect cleanup behavior.

### Validation

- `cargo check --manifest-path server/Cargo.toml`
- `cargo test --manifest-path server/Cargo.toml`
- `npm --prefix client run build`

## Supporting Checklists

- Detailed 3.5 checklist: `PHASE3_5_CHECKLIST.md`
- Detailed 3.6 checklist: `PHASE3_6_CHECKLIST.md`
