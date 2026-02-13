# Phase 3.6 Execution Checklist (UX and Reliability Pass)

Goal: make voice/video behavior predictable under reconnects, signaling failures, and device changes, while keeping channel-scoped SFU semantics unchanged.

## PR 1 - Server heartbeat, timeout, and cleanup hardening

- [x] `server/src/ws/messages.rs`
  - [x] Add client heartbeat message shape (`heartbeat`) for authenticated WS sessions.

- [x] `server/src/ws/handler.rs`
  - [x] Add idle timeout enforcement for authenticated sockets.
  - [x] Accept and treat `heartbeat` as connection liveness.
  - [x] Ensure timeout/disconnect path always runs voice/media cleanup and producer-close broadcasts.
  - **Acceptance criteria**
    - [x] Ghost connections are cleaned without manual intervention.
    - [x] Valid connected clients stay alive by sending periodic heartbeats.

## PR 2 - Server signaling validation and rate limiting

- [x] `server/src/main.rs`
  - [x] Add app-state storage for per-connection media-signal rate accounting.

- [x] `server/src/ws/handler.rs`
  - [x] Add media payload size guard before request execution.
  - [x] Validate request field lengths and request_id constraints.
  - [x] Add per-connection media-signal rate limiting window.
  - [x] Improve warning/error logs for rejected signaling requests.
  - **Acceptance criteria**
    - [x] Oversized or malformed signaling requests are rejected with `signal_error`.
    - [x] High-frequency signaling bursts are throttled without crashing WS handlers.

## PR 3 - Client connection-state UX

- [x] `client/src/api/ws.ts`
  - [x] Add explicit WS status model (`disconnected`, `connecting`, `connected`, `reconnecting`, `failed`).
  - [x] Add status subscription API for UI stores/components.
  - [x] Send periodic `heartbeat` while connected.

- [x] `client/src/stores/voice.ts`
  - [x] Mirror WS status into voice UI state with subscription lifecycle helpers.

- [x] `client/src/components/ChannelList.tsx`
  - [x] Show clear voice/media connection status in dock.
  - [x] Show actionable recovery text when reconnecting/failed.
  - **Acceptance criteria**
    - [x] Users can distinguish joining/leaving vs transport reconnecting states.
    - [x] Failure state gives a clear retry/rejoin action.

## PR 4 - Device preference persistence and device-change resilience

- [x] `client/src/stores/settings.ts`
  - [x] Persist preferred camera input device id.
  - [x] Include camera reset in preference reset helpers.

- [x] `client/src/api/media.ts`
  - [x] Use preferred camera id during camera start when available.
  - [x] Add camera device switching helper mirroring microphone behavior.
  - [x] Add media-device change listener handling:
    - [x] fallback when preferred mic/camera/speaker disappears,
    - [x] keep UI state/errors actionable,
    - [x] unregister listener during media cleanup.

- [x] `client/src/components/UserSettingsDock.tsx`
  - [x] Add camera device selector and refresh wiring.
  - [x] Keep UX consistent with existing audio device controls.
  - **Acceptance criteria**
    - [x] Preferred camera is restored when available.
    - [x] Device unplug/replug does not leave stale enabled state in UI.

## PR 5 - Verification gate and docs sync

- [x] Command checks
  - [x] `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
  - [x] `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
  - [x] `cargo test --manifest-path server/Cargo.toml`
  - [x] `npm --prefix client run typecheck`
  - [x] `npm --prefix client run build`

- [ ] Manual QA
  - [ ] Reconnect after server restart updates UI states predictably.
  - [ ] Disconnect/reconnect does not leave ghost voice/media participants.
  - [ ] Mic unplug/replug recovers without a full app restart.
  - [ ] Camera unplug/replug or track end recovers without stale local tile.

- [ ] `PHASE3_PLAN.md`
  - [x] Mark 3.6 checklist items with final pass/fail status.
