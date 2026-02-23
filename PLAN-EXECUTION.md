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
