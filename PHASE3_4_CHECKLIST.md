# Phase 3.4 Execution Checklist (Camera Video Publish/Subscribe)

Goal: ship camera video alongside existing voice/audio with SFU routing, live tile updates, and safe error handling.

## PR 1 - Server foundation: producer ownership + camera limits

- [x] `server/src/media/transport.rs`
  - [x] Add metadata access needed to resolve producer owner connection.
  - [x] Enforce max one active video producer per connection.
  - [x] Return clear errors when a second camera producer is attempted.
  - **Acceptance criteria**
    - [x] Producing `audio` remains unchanged.
    - [x] Producing first `video` succeeds.
    - [x] Producing second `video` on same connection fails with explicit error.

- [x] `server/src/ws/handler.rs`
  - [x] Include producer owner `username` in `new_producer` events (both live broadcast and existing producer snapshot on recv transport creation).
  - **Acceptance criteria**
    - [x] `new_producer` payload includes `producer_id`, `kind`, and `username`.
    - [x] Existing consumers still receive `new_producer` on join/handshake.

## PR 2 - Server camera-off signaling

- [x] `server/src/ws/handler.rs`
  - [x] Add media signal action for explicit producer close (for camera off), e.g. `media_close_producer`.
  - [x] Validate producer belongs to caller and channel before closing.
  - [x] Emit success response for request/response flow.
  - [x] Reuse existing `producer_closed` channel broadcast so remote tiles drop immediately.
  - **Acceptance criteria**
    - [x] Caller can close own camera producer.
    - [x] Caller cannot close other users' producers.
    - [x] Remote members receive `producer_closed` without disconnecting audio.

- [x] `server/src/media/transport.rs`
  - [x] Add close-producer helper by `connection_id + channel_id + producer_id`.
  - **Acceptance criteria**
    - [x] Producer is removed from in-memory media state.
    - [x] Subsequent consume for closed producer fails.

## PR 3 - Client media runtime: local camera lifecycle

- [x] `client/src/api/media.ts`
  - [x] Extend media signal payload typing for owner username and close-producer action.
  - [x] Add local camera state: stream, track, producer, enabled flag.
  - [x] Implement `startLocalCameraProducer(channelId)`.
  - [x] Implement `stopLocalCameraProducer(channelId)` using close-producer signaling.
  - [x] Implement permission/device error normalization (denied, not found, device busy).
  - **Acceptance criteria**
    - [x] Toggling camera on creates one video producer.
    - [x] Toggling camera off closes producer and stops local camera track.
    - [x] Audio producer/consumers continue unaffected during camera toggles.
    - [x] User-facing error message is returned for permission/device failures.

## PR 4 - Client media runtime: remote video consumers + tile data

- [x] `client/src/api/media.ts`
  - [x] Track remote video consumer streams by producer id.
  - [x] Maintain producer-to-username mapping from `new_producer` payload.
  - [x] Expose subscription API for UI (`subscribeVideoTiles` or equivalent getter/signals).
  - [x] Remove remote tile entries when `producer_closed` arrives.
  - **Acceptance criteria**
    - [x] New remote video producer creates a renderable stream entry.
    - [x] `producer_closed` removes matching tile entry immediately.
    - [x] Reconnect/leave cleanup clears all remote tile state.

## PR 5 - UI integration: camera controls + video stage

- [x] `client/src/stores/voice.ts`
  - [x] Add camera UI state (`cameraEnabled`, `cameraError`, and optional `videoTiles` projection if not managed in media.ts).
  - **Acceptance criteria**
    - [x] State resets on `resetVoiceState` and disconnect.

- [x] `client/src/components/ChannelList.tsx`
  - [x] Add camera toggle button in connected voice dock.
  - [x] Wire button to camera on/off actions and error toast handling.
  - **Acceptance criteria**
    - [x] Button disabled/loading behavior matches existing voice action style.
    - [x] Toggle reflects current camera state.

- [x] `client/src/components/VideoStage.tsx` (new)
  - [x] Render local preview tile when camera enabled.
  - [x] Render remote participant tiles with usernames.
  - [x] Render stable empty/fallback state when no active video.
  - **Acceptance criteria**
    - [x] Local tile appears on camera on and disappears on off.
    - [x] Remote tiles update in real time with correct usernames.

- [x] `client/src/components/MessageArea.tsx`
  - [x] Mount `VideoStage` above message input (inside main content flow).
  - **Acceptance criteria**
    - [x] Message list/input behavior remains unchanged.
    - [x] Video stage does not break typing or message send flows.

## PR 6 - Styling and responsive pass

- [ ] `client/src/styles/global.css`
  - [ ] Add styles for camera button states and video stage grid.
  - [ ] Add responsive rules for narrow widths (single-column tiles or horizontal overflow).
  - **Acceptance criteria**
    - Desktop layout keeps tiles readable above composer.
    - Mobile/narrow layout avoids overflow and preserves chat usability.

## Verification Gate (must pass before marking Phase 3.4 complete)

- [ ] Command checks
  - [ ] `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
  - [ ] `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
  - [ ] `cargo test --manifest-path server/Cargo.toml`
  - [x] `npx tsc -p client/tsconfig.json --noEmit`
  - [x] `npm --prefix client run build`

- [ ] Manual QA
  - [ ] Two users, same channel: camera on/off repeatedly, remote tiles appear/disappear live.
  - [ ] Audio stays stable while camera toggles.
  - [ ] Camera permission denied path shows error and app remains usable.
  - [ ] No-camera-device path shows error and app remains usable.
  - [ ] Different channels do not receive each other's video producers.
  - [ ] Disconnect/leave/channel switch cleans up local and remote video tiles.
