# Phase 3.5 Execution Checklist (Screen Sharing Publish/Subscribe)

Goal: ship channel-scoped screen sharing on top of the current media pipeline, while keeping camera and screen independent with SFU routing.

Implementation note: routing mode selection is currently surfaced in the voice dock (`client/src/components/ChannelList.tsx`) instead of `UserSettingsDock`. Keep this placement unless/until product UX explicitly moves it.

## PR 1 - Server signaling contract and source metadata

- [x] `server/src/ws/handler.rs`
  - [x] Extend media signaling payload handling with optional `source` metadata for video producers.
  - [x] Keep `audio` behavior unchanged and backward-compatible for clients that do not send `source`.
  - [x] Include `source` in `media_produced`, `new_producer`, and producer close lifecycle payloads.
  - **Acceptance criteria**
    - [x] Existing audio and camera flows still work without client changes.
    - [x] New screen producers emit explicit `source: "screen"`.
    - [x] Receivers can distinguish camera vs screen producers from signaling payloads.

- [x] `server/src/ws/broadcast.rs`
  - [x] Broadcast `producer_closed` with matching `source` metadata.
  - **Acceptance criteria**
    - [x] Remote clients can remove only the closed source tile without affecting other sources.

## PR 2 - Server media constraints and lifecycle

- [x] `server/src/media/transport.rs`
  - [x] Track producer metadata by source (`microphone`, `camera`, `screen`) instead of kind-only assumptions.
  - [x] Enforce per-connection source limits:
    - [x] 1 active camera producer max
    - [x] 1 active screen producer max
  - [x] Preserve channel-scoped consume validation for all producer sources.
  - [x] Return source metadata from producer list/snapshot and close helpers.
  - **Acceptance criteria**
    - [x] A connection can publish camera and screen simultaneously.
    - [x] A second screen producer from same connection is rejected with clear error.
    - [x] Closing a screen producer does not close camera or audio producers.

## PR 3 - SFU routing enforcement

- [x] `server/src/config.rs`
- [x] `server/.env.example`
- [x] `server/config.toml.example`
  - [x] Keep media routing configuration SFU-only.

- [x] `server/src/ws/handler.rs`
  - [x] Validate `routing_mode` on media requests (`sfu` only).
  - [x] Keep auth + channel membership checks identical across media requests.
  - **Acceptance criteria**
    - [x] Server accepts `sfu` values for screen-share flow.
    - [x] Non-`sfu` values are rejected with a clear error payload.

## PR 4 - Client media runtime: local screen lifecycle

- [x] `client/src/api/media.ts`
  - [x] Add local screen state (`screenProducer`, `screenTrack`, `screenStream`, enabled/error flags).
  - [x] Implement `startLocalScreenProducer(channelId)` via `getDisplayMedia`.
  - [x] Implement `stopLocalScreenProducer(channelId)` via `media_close_producer`.
  - [x] Send `source: "screen"` and `routing_mode: "sfu"` on produce/close requests.
  - [x] Handle browser-driven share stop (`track.onended`) and cleanly notify server.
  - **Acceptance criteria**
    - [ ] Starting screen share does not drop voice or camera.
    - [x] Browser stop-share button tears down local and remote screen tiles.
    - [x] Permission-denied / unavailable display errors are surfaced as readable UI errors.

## PR 5 - Client media runtime: remote screen tiles

- [x] `client/src/api/media.ts`
  - [x] Maintain producer source metadata map from `new_producer` announcements.
  - [x] Track remote screen streams separately from camera streams.
  - [x] Remove correct remote tile type on `producer_closed`.
  - [x] Keep reconnect/leave cleanup clearing all remote screen state.
  - **Acceptance criteria**
    - [ ] Remote screen tiles appear/disappear live.
    - [x] Camera tiles remain unaffected when screen producer closes.

## PR 6 - Store and UI integration

- [x] `client/src/stores/voice.ts`
  - [x] Add screen-share UI state and subscriptions.
  - [x] Ensure resets clear screen state in `resetVoiceMediaState` and `resetVoiceState`.
  - **Acceptance criteria**
    - [x] Logout/disconnect/channel leave clears all screen-share state.

- [x] `client/src/components/ChannelList.tsx`
  - [x] Add start/stop screen-share control in the voice dock.
  - [x] Add start/stop screen-share control in share UX.
  - [x] Match existing dock behavior for disabled/loading/error presentation.
  - **Acceptance criteria**
    - [x] Toggle is unavailable when voice is not joined.
    - [x] Toggle reflects active screen-share state.
    - [x] Screen share starts and stops from the voice dock.

- [x] `client/src/stores/settings.ts`
  - [x] Keep media device preferences scoped to input/output device IDs.

- [x] `client/src/components/VideoStage.tsx`
  - [x] Render remote screen-share tiles with clear presenter identity.
  - [x] Keep camera and screen tiles coexisting in stage layout.
  - **Acceptance criteria**
    - [x] Presenter identity is clear for each active screen-share tile.
    - [x] Layout remains usable on desktop and narrow/mobile widths.

- [x] `client/src/styles/global.css`
  - [x] Add styles for screen-share control states and screen tile treatment.
  - [x] Preserve existing responsiveness and avoid overflow regressions.

## PR 7 - End-to-end screen share parity

- [x] `client/src/api/media.ts`
- [x] `client/src/components/ChannelList.tsx`
- [x] `server/src/ws/handler.rs`
  - [x] Keep screen-share lifecycle semantics stable for start/stop/cleanup.
  - **Acceptance criteria**
    - [ ] Screen share works reliably with SFU routing.
    - [ ] Core UX parity holds (start, stop, remote tile updates, cleanup).

## Verification Gate (must pass before marking Phase 3.5 complete)

- [x] Command checks
  - [x] `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
  - [x] `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
  - [x] `cargo test --manifest-path server/Cargo.toml`
  - [x] `npx tsc -p client/tsconfig.json --noEmit`
  - [x] `npm --prefix client run build`

- [ ] Manual QA
  - [ ] One user can start/stop screen share repeatedly without dropping voice.
  - [ ] Two users in same channel see screen tile lifecycle changes in real time.
  - [ ] Camera and screen can run simultaneously for one user.
  - [ ] Users in different channels never receive each other's screen share.
  - [ ] Start share and verify expected SFU flow end-to-end.
  - [ ] Browser-level stop sharing (native toolbar/button) cleans up correctly.
  - [ ] Disconnect, reconnect, and rejoin paths clear stale screen state.
