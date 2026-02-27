# Screen Sharing V2 Plan (Native-First)

Status: Draft (2026-02-27)

## Product Direction (Locked)

- Native-first MVP for game streaming performance.
- Windows-first implementation for V2 native capture.
- Video first, selected-application audio in a follow-up milestone.
- NVENC is planned but not a blocker for first ship.

## Goals

- Restore screen sharing with a clean, modular pipeline.
- Achieve stable low-latency streaming suitable for fast-motion content (games).
- Keep server/client/Tauri contracts synchronized and easy to evolve.
- Ship in incremental milestones with measurable acceptance criteria.

## Non-Goals (M1)

- Selected-application audio capture.
- Full stream-watch UX polish and overlays.
- Deep diagnostics UI beyond minimal operational telemetry.

## Success Criteria

- M1 supports reliable native screen streaming on Windows in voice channels.
- Baseline target: 1080p60 on capable hardware with graceful degradation when constrained.
- No protocol drift between media signaling server/client contracts.
- Failures recover cleanly (stop/restart, transport reconnect, source change).

## Architecture Principles

- Keep native capture V2 in isolated modules (`capture_v2`) to avoid reviving legacy complexity.
- Separate concerns: source discovery, capture loop, encode backend, RTP sender, lifecycle orchestration.
- Preserve explicit typed contracts at all boundaries (Tauri commands, WS payloads, TS types).
- Prefer safe fallback behavior over hard failure under load.

## Milestones

### M0 - Contracts + Skeleton

- [ ] Reintroduce `screen` media source contract in `server/src/ws/media_signal.rs`.
- [ ] Reintroduce synchronized client transport types in `client/src/api/media/types.ts` and signaling in `client/src/api/media/signaling.ts`.
- [ ] Add Tauri V2 namespace (`client/src-tauri/src/capture_v2/`) with command stubs and typed request/response models.
- [ ] Add TS native bridge for V2 command calls and runtime parsing.
- [ ] Define producer lifecycle states and error taxonomy (start, running, degraded, stopping, stopped, failed).

Acceptance criteria:

- [ ] End-to-end signaling compiles on server/client with no legacy native capture dependencies.
- [ ] Tauri command surface exists and is callable from client without runtime panics.

### M1 - Native Video MVP (First Ship)

- [ ] Implement source enumeration (monitor/window/app) and start/stop capture sessions.
- [ ] Implement software encoder baseline path with predictable latency and bounded queues.
- [ ] Implement sender pipeline to mediasoup-compatible producer flow.
- [ ] Restore minimal UI controls (start/stop + error state) in voice dock/channel list.
- [ ] Restore remote screen tile consumption and teardown handling.
- [ ] Add lightweight telemetry (capture FPS, encode FPS, queue depth, dropped frames, send errors).

Acceptance criteria:

- [ ] User can start and stop native screen share repeatedly without process restart.
- [ ] Remote participants receive stream consistently in active voice channel.
- [ ] Pipeline survives transient failures via controlled restart path.

### M1.5 - Performance Hardening

- [ ] Add adaptive frame pacing and bitrate bounds for high-motion content.
- [ ] Add overload policy (drop/degrade before disconnect).
- [ ] Tune keyframe request/interval behavior for fast scene changes.
- [ ] Improve source-switch handling with minimal interruption.

Acceptance criteria:

- [ ] Under load, stream degrades predictably instead of stalling/crashing.
- [ ] Telemetry surfaces fallback/degradation reasons.

### M2 - Selected-Application Audio

- [ ] Design and implement per-app audio capture strategy (process-bound capture).
- [ ] Add audio producer path coordinated with screen video session lifecycle.
- [ ] Add UI controls for "share app audio" and source-specific behavior.
- [ ] Validate A/V sync strategy and drift handling.

Acceptance criteria:

- [ ] Users can share selected app video + app audio together.
- [ ] Audio stop/start and app-close scenarios are handled safely.

### M3 - NVENC Backend

- [ ] Add hardware encoder backend capability detection.
- [ ] Implement NVENC path behind backend selection with safe software fallback.
- [ ] Add backend telemetry (requested backend, active backend, fallback reason).
- [ ] Compare and tune CPU/latency tradeoffs against software baseline.

Acceptance criteria:

- [ ] NVENC-enabled environments use hardware encoding when available.
- [ ] Unsupported/failed NVENC falls back automatically without session loss.

## Risk Register

- App audio API complexity on Windows can delay M2.
  - Mitigation: keep M1 video-only and isolate audio pipeline additions.
- Hardware and driver variance (especially encoder behavior).
  - Mitigation: strict capability checks + fallback-first design.
- Protocol drift between server and client.
  - Mitigation: single PR updates for WS contract changes with paired type updates.

## Validation Matrix

Run from repo root unless noted:

- `npm --prefix client run typecheck`
- `npm --prefix client run build`
- `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
- `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
- `cargo test --manifest-path server/Cargo.toml`
- `cargo fmt --all --manifest-path client/src-tauri/Cargo.toml -- --check`
- `cargo clippy --manifest-path client/src-tauri/Cargo.toml --all-targets -- -D warnings`
- `cargo test --manifest-path client/src-tauri/Cargo.toml`

## Notes

- Keep manual verification backlog in `QA.md` (not this plan file).
- Keep each milestone implementation in focused slices to avoid regressing maintainability.
