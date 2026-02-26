# Yankcord Execution Plan (Current Phase)

`PLAN-EXECUTION.md` is a living implementation document for the active phase only.
Long-term roadmap and completed milestone tracking live in `PLAN.md`.

## Active Phase

- Phase 5.2: Persistent channel unread state

## Phase Goal

- Ensure channel notification dots/counts remain accurate across disconnects and logouts.
- Move channel unread tracking from transient websocket-only increments to server-authoritative state.
- Keep realtime UX responsive while making initial state deterministic on login/session restore.

## Product Decisions Locked

- Channel unread state is derived from persisted per-user read markers plus message history.
- Initial channel list load includes unread counts so badges are correct before new WS events arrive.
- Selecting/reading a channel updates read state on the backend and clears local unread immediately.
- Realtime websocket events continue to drive incremental updates while connected.

## Architecture Direction

### Backend/API

- Add persisted channel read marker storage (`channel_read_state`) keyed by `channel_id` + `user_id`.
- Use `ON DELETE SET NULL` for `last_read_message_id` FK (unlike DM's `RESTRICT`) so message deletion doesn't break read markers.
- Create a separate `ChannelWithUnread` response type for channel list — `Channel` is shared with WS broadcasts (`ChannelCreated`/`ChannelUpdated`) which go to all users, so per-user `unread_count` cannot live on that struct.
- Extend channel list responses to include `unread_count` per channel for the requesting user.
- Exclude self-authored messages from unread counts (mirror DM pattern: `m.author_id <> $user_id`).
- Auto-update sender's read marker when they send a channel message (mirror DM `handle_send_message` pattern).
- Add channel read marker update endpoint (or equivalent existing-route extension), e.g. `POST /channels/{channel_id}/read`.
- Keep websocket contract stable where possible; if adding an unread-specific WS event, update server/client contracts together.

### Frontend

- Initialize channel unread store from API-provided unread counts at channel list load.
- Stop relying exclusively on `channel_activity` for offline durability.
- On channel selection/visibility restore, mark channel as read via API and clear local unread state optimistically.
- Preserve existing badge pulse/cue behavior for live activity while connected.

## Validation and Constraints

- Preserve DM unread behavior and existing DM read marker flows.
- Keep WS payload `type` values and snake_case field names synchronized (`server/src/ws/messages.rs`, `client/src/api/ws.ts`).
- Avoid regressions in channel switching, focus/visibility handling, and message loading.
- Do not break existing notification cues for active live sessions.

## Iteration Plan (Detailed)

1. Audit current channel unread flow in client (`channel_activity`, local unread store) and backend message broadcast paths.
2. Add DB migration and backend helpers for per-user channel read markers.
3. Add backend unread count computation for channel list responses.
4. Add/extend backend channel read-marker endpoint and integrate with latest visible message semantics.
5. Wire client channel list bootstrap to server unread counts.
6. Wire client channel open/focus read-marking to backend and keep optimistic local clear behavior.
7. Verify websocket/live behavior remains correct for connected sessions.
8. Run full relevant validation commands.

## Ordered Checklist

### 5.2.A Backend persistence and unread computation

- [x] Add migration for `channel_read_state` table and indexes (use `ON DELETE SET NULL` for `last_read_message_id` FK)
- [x] Create `ChannelWithUnread` response type in `models.rs` (keep `Channel` untouched for WS use)
- [x] Add backend query/helper to compute per-channel unread for current user (exclude self-authored messages)
- [x] Include `unread_count` in channel list API response via `ChannelWithUnread`
- [x] Add endpoint/update flow to persist channel read marker for current user
- [x] Auto-update sender's read marker when they send a channel message
- [x] Ensure authorization/ownership checks mirror existing channel access rules

### 5.2.B Frontend unread integration

- [x] Extend channel API client types to include `unread_count`
- [x] Initialize channel unread store from channel list payload
- [x] On channel open, clear unread locally and submit read marker update (add inline or create `api/channels.ts`)
- [x] Keep `channel_activity` handling for live increments when channel is not active
- [x] Preserve existing badge pulse/audio behavior for live activity

### 5.2.C Contract sync and regression checks

- [x] If WS payload changes are needed, sync `server/src/ws/messages.rs` and `client/src/api/ws.ts` (no WS payload changes required)
- [ ] Verify DM unread flows remain unchanged and correct
- [ ] Verify channel unread survives logout/login and offline periods

### 5.2.D Validation

- [x] `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
- [x] `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
- [x] `cargo test --manifest-path server/Cargo.toml`
- [x] `npm --prefix client run typecheck`
- [x] `npm --prefix client run build`

## Touch Points (Expected)

- `server/migrations/*_channel_read_state*.sql`
- `server/src/models.rs` (new `ChannelWithUnread` response type)
- `server/src/routes/channel_routes.rs`
- `server/src/ws/messages.rs` (only if contract update required)
- `server/src/ws/handler.rs` (auto-update sender read marker on message send)
- `client/src/api/channels.ts` (or current channel API module)
- `client/src/stores/chat.ts`
- `client/src/components/ChannelList.tsx`
- `client/src/api/ws.ts` (only if WS contract update required)

## Validation Commands

- Backend
  - `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
  - `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
  - `cargo test --manifest-path server/Cargo.toml`
- Frontend
  - `npm --prefix client run typecheck`
  - `npm --prefix client run build`

## Exit Criteria

- Channel unread badges are correct immediately after login/app open without relying on missed WS events.
- If messages arrive while user is logged out/disconnected, unread badges reflect those messages on next load.
- Opening a channel marks it read and clears badge consistently across refresh/reconnect.
- Connected realtime behavior still increments/pulses unread for non-active channels.

---

## Focused Plan: DXGI Window/Application Capture Migration

### Goal

- Route native streaming for `screen:*`, `window:*`, and `application:*` through DXGI Desktop Duplication.
- Remove runtime dependence on `windows-capture` for active window/app stream capture.
- Keep visible-pixels behavior explicit (occlusion/minimize are expected DXGI constraints).
- Prevent NVENC CUDA teardown crashes currently triggered by window/app capture path.

### Product Decisions Locked

- Window and application capture use the visible desktop pixels model (not hidden/offscreen window composition).
- `application:<pid>` resolves to one concrete window at session start and remains locked to that window for the active session.
- Source listing UX stays unchanged for now (`windows_capture::list_sources`), but stream ingestion moves to DXGI.
- If the target window rect is invalid or minimized, capture loop skips frames and keeps session alive.

### Architecture Direction

#### DXGI capture module

- Extend `client/src-tauri/src/capture/dxgi_capture.rs` to parse source ids (`screen`, `window`, `application`) into a capture target.
- Add monitor/window resolution helpers and monitor remap logic when a window moves displays.
- Add GPU region-copy path (`CopySubresourceRegion`) so window/app sources crop the duplicated desktop texture to the target rect.
- Keep texture allocation cached and recreate only when dimensions or monitor target changes.

#### Capture service routing

- Update `client/src-tauri/src/capture/service.rs` so all native source kinds start DXGI capture threads.
- Stop invoking `windows_capture::start_capture` for active sender sessions.
- Preserve current stop lifecycle (`stop_dxgi_capture`, sender worker teardown, status snapshots).

#### Sender/encoder stability

- Keep GPU-texture fast path (`encode_gpu_frame`) as primary for all DXGI-fed sources.
- Keep CPU readback fallback available, but no longer rely on windows-capture CPU frame path for window/app sessions.
- Add defensive logging around window target loss/remap events to simplify production diagnosis.

### Iteration Plan (Detailed)

1. Add source-target parsing and window/app monitor resolution helpers in DXGI module.
2. Implement cropped-texture output for window/app targets while retaining full-frame path for screen targets.
3. Implement window/app monitor-change detection and session recreation hooks.
4. Update capture service routing to start DXGI for all source kinds.
5. Remove windows-capture active start path from native sender flow while preserving source listing.
6. Add/adjust diagnostics for window invalid/minimized/monitor-move events.
7. Run validation commands and complete manual QA backlog in `QA.md`.

### Ordered Checklist

#### NATIVE.DXGI.A Source modeling and monitor resolution

- [ ] Add DXGI target enum for `screen`, `window`, and `application` source ids
- [ ] Resolve `window` target HWND + rect and reject invalid handles safely
- [ ] Resolve `application` target PID to one locked window at session start
- [ ] Map window target to monitor device name used by DXGI session

#### NATIVE.DXGI.B Cropped GPU frame pipeline

- [ ] Add reusable crop texture path with `CopySubresourceRegion`
- [ ] Clamp crop rect to monitor bounds and skip zero-area regions
- [ ] Emit `GpuTexture` packets with cropped dimensions for window/app
- [ ] Keep full-monitor `CopyResource` path for `screen` sources

#### NATIVE.DXGI.C Service integration

- [ ] Update `start_dxgi_capture` to accept all source kinds
- [ ] Route `start_native_capture` to DXGI for screen/window/application
- [ ] Remove runtime `windows_capture::start_capture` dependency for active sessions
- [ ] Preserve stop/restart behavior and active-session cache semantics

#### NATIVE.DXGI.D Stability and observability

- [ ] Add logs for target-window minimized/lost/monitor-moved events
- [ ] Add safe handling for transient resolution changes without panics
- [ ] Verify no worker crash on window/app start, stop, or target loss

#### NATIVE.DXGI.E Validation

- [ ] `cargo check --manifest-path client/src-tauri/Cargo.toml --features native-nvenc`
- [ ] `cargo clippy --manifest-path client/src-tauri/Cargo.toml --all-targets --features native-nvenc -- -D warnings`
- [ ] `cargo test --manifest-path client/src-tauri/Cargo.toml --features native-nvenc`
- [ ] `npm --prefix client run typecheck`
- [ ] `npm --prefix client run build`

### Touch Points (Expected)

- `client/src-tauri/src/capture/dxgi_capture.rs`
- `client/src-tauri/src/capture/service.rs`
- `client/src-tauri/src/capture/service/native_sender.rs`
- `client/src-tauri/src/capture/windows_capture.rs` (source listing only; no active stream start path)
- `client/src/api/nativeCapture.ts` (only if request/telemetry payload changes)
- `client/src/api/media/native.ts` (only if native start options change)

### Exit Criteria

- Starting native stream from `window:*` no longer crashes `native-sender-worker`.
- Window/app streams are delivered via DXGI and appear watchable remotely with LIVE badge behavior unchanged.
- Window move between monitors triggers stable remap/recovery without process crash.
- Occlusion/minimized behavior matches visible-pixels model and is documented in QA outcomes.
