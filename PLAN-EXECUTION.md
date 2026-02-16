# Yankcord Execution Plan (Current Phase)

`PLAN-EXECUTION.md` is a living implementation document for the active phase only.
Long-term roadmap and completed milestone tracking live in `PLAN.md`.

## Active Phase

- Phase 5.4: User profiles and DMs

## Phase Goal

- Add richer user profiles with editable profile description and profile status text.
- Add profile viewing UX for other users from member list and profile surfaces.
- Add one-to-one DM conversations outside channels with sidebar list, unread state, and live updates.
- Keep protocol and transport behavior stable for existing channel chat.

## Product Decisions Locked

- Profile status is a short custom text line, not presence state.
- Presence remains transport-driven (`online`/`idle`) and separate from profile status text.
- DM identity and storage use `user_id` internally (not mutable username keys).
- DM conversation uniqueness is per sorted user pair.
- Username remains login identity; user-editable profile identity is `display_name`.

## Architecture Direction

### Data Model

- Extend `users` table with:
  - `profile_description TEXT`
  - `profile_status TEXT`
- Add DM tables:
  - `dm_threads` (`id`, `user_a_id`, `user_b_id`, `created_at`, unique pair)
  - `dm_messages` (`id`, `thread_id`, `author_id`, `content`, `created_at`, `edited_at`)
  - `dm_read_state` (`thread_id`, `user_id`, `last_read_message_id`, `updated_at`)
- Add indexes for:
  - thread pair uniqueness and lookup by participant
  - message pagination by `(thread_id, created_at DESC, id DESC)`
  - unread/read-state lookup by `(user_id, thread_id)`

### REST Surface

- User profile endpoints:
  - `GET /users/{username}` for profile viewing
  - `GET /users/me` include profile fields
  - `PATCH /users/me` support updating `display_name`, profile description, and profile status
  - `GET /users` include profile summary fields needed by member list and popovers
- DM endpoints:
  - `POST /dms/with/{username}` create-or-open thread
  - `GET /dms` list current user DM threads
  - `GET /dms/{thread_id}/messages?before=&limit=` paginated fetch
  - `POST /dms/{thread_id}/messages` send DM message
  - `PATCH /dm-messages/{message_id}` edit own DM
  - `DELETE /dm-messages/{message_id}` delete own DM
  - `POST /dms/{thread_id}/read` update read marker

### WebSocket Contract Additions

- Client -> server:
  - `subscribe_dm`
  - `typing_start_dm`
  - `typing_stop_dm`
  - `send_dm_message`
  - `dm_read`
- Server -> client:
  - `new_dm_message`
  - `dm_message_edited`
  - `dm_message_deleted`
  - `dm_typing_start`
  - `dm_typing_stop`
  - `dm_thread_created`
  - `dm_thread_updated`
  - `dm_unread_updated`
- Contract parity must be maintained in both:
  - `server/src/ws/messages.rs`
  - `client/src/api/ws.ts`

### Client State Direction

- Add DM store (`client/src/stores/dms.ts`) to hold:
  - thread list
  - active thread id
  - unread counts
  - per-thread typing users
  - thread member profile summaries
- Introduce message context abstraction in UI:
  - active target is either channel or DM thread
  - shared message timeline/composer behavior with context-specific API and WS payload mapping

## Validation and Constraints

- Enforce profile field limits server-side:
  - `display_name`: max 32 chars (non-empty)
  - `profile_status`: max 80 chars
  - `profile_description`: max 280 chars
- Trim inputs; map empty string to `NULL`.
- Preserve channel message paths and behavior unchanged.
- Ensure display-name updates do not break DM ownership or thread linkage.
- Keep wire payloads in `snake_case`.

## Iteration Plan (Detailed)

1. Add migrations and backend model structs for profile fields + DM tables.
2. Extend user routes for profile read/write and profile viewing.
3. Add DM routes and DB query layer for list/fetch/send/edit/delete/read.
4. Add WS contract variants and DM routing in handler/broadcast paths.
5. Add frontend API clients for profile and DM endpoints.
6. Build profile viewing modal and profile actions wiring from member context menu.
7. Build DM sidebar group and DM thread selection UX.
8. Extend message area flow to support channel or DM thread context.
9. Wire unread, typing, and live updates for DMs.
10. Stabilize, validate, and document touch points.

## Ordered Checklist

### 5.4.A Backend schema and models

- [x] Migration: add `users.profile_description`
- [x] Migration: add `users.profile_status`
- [x] Migration: create `dm_threads`
- [x] Migration: create `dm_messages`
- [x] Migration: create `dm_read_state`
- [x] Migration: add indexes and unique constraints for thread pair + message paging
- [x] Server: add Rust structs for DM thread/message/read-state shapes

### 5.4.B Profile APIs

- [x] Server: extend `GET /users/me` response with profile fields (including `display_name`)
- [x] Server: extend `PATCH /users/me` request/response with profile fields (`display_name`, description, status)
- [x] Server: add `GET /users/{username}` endpoint for profile viewing
- [x] Server: extend `GET /users` summary payload for profile metadata as needed
- [x] Server: add validation for profile status/description limits

### 5.4.C DM APIs

- [x] Server: create `dm_routes.rs`
- [x] Server: add create-or-open DM endpoint
- [x] Server: add list DM threads endpoint
- [x] Server: add fetch thread messages endpoint
- [x] Server: add send/edit/delete DM message endpoints
- [x] Server: add DM read marker endpoint
- [x] Server: register DM routes in `routes/mod.rs` and `main.rs`

### 5.4.D WebSocket contract and routing

- [x] Server: add DM client/server message variants in `ws/messages.rs`
- [x] Client: add matching DM unions in `api/ws.ts`
- [x] Server: add DM subscribe/send/typing/read handlers in `ws/handler.rs`
- [x] Server: add DM-targeted fanout helper(s) in `ws/broadcast.rs`
- [x] Server: emit DM unread/thread activity events

### 5.4.E Frontend profile UX

- [x] Client: extend `userProfiles` store with description/status fields
- [x] Client: update settings profile form to edit description/status
- [x] Client: add `UserProfileModal` (view other user profile)
- [x] Client: wire context-menu `View Profile` in `MemberList.tsx`
- [x] Client: add `Send Message` CTA in profile modal

### 5.4.F Frontend DM UX and state

- [x] Client: add DM store (`stores/dms.ts`)
- [x] Client: add DM API module (`api/dms.ts`)
- [x] Client: render DM section in sidebar (`ChannelList.tsx` or extracted module)
- [x] Client: support initiating DM from member list/profile modal
- [x] Client: support selecting DM thread as active conversation
- [x] Client: update message area to fetch/send/edit/delete in DM context
- [x] Client: add DM typing indicator and unread badge behavior

### 5.4.G Refactor guardrail

- [ ] Extract cohesive modules if `ChannelList.tsx` grows further
- [ ] Extract cohesive modules if `MessageArea.tsx` grows further
- [ ] Extract cohesive modules if `SettingsPage.tsx` grows further

### 5.4.H Validation

- [x] `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
- [x] `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
- [x] `cargo test --manifest-path server/Cargo.toml`
- [x] `npm --prefix client run typecheck`
- [x] `npm --prefix client run build`

## Touch Points

### Backend

- `server/migrations/*.sql`
- `server/src/models.rs`
- `server/src/routes/user_routes.rs`
- `server/src/routes/dm_routes.rs` (new)
- `server/src/routes/mod.rs`
- `server/src/main.rs`
- `server/src/ws/messages.rs`
- `server/src/ws/handler.rs`
- `server/src/ws/broadcast.rs`

### Frontend

- `client/src/api/ws.ts`
- `client/src/api/dms.ts` (new)
- `client/src/stores/userProfiles.ts`
- `client/src/stores/dms.ts` (new)
- `client/src/stores/chat.ts`
- `client/src/components/SettingsPage.tsx`
- `client/src/components/MemberList.tsx`
- `client/src/components/ContextMenuContainer.tsx`
- `client/src/components/ChannelList.tsx`
- `client/src/components/MessageArea.tsx`
- `client/src/components/MessageTimeline.tsx`
- `client/src/components/UserProfileModal.tsx` (new)
- `client/src/styles/channel-list.css`
- `client/src/styles/messages.css`
- `client/src/styles/members.css`

## Validation Commands

- Backend
  - `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
  - `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
  - `cargo test --manifest-path server/Cargo.toml`

- Frontend
  - `npm --prefix client run typecheck`
  - `npm --prefix client run build`

## Exit Criteria

- Users can edit profile description and profile status in settings.
- Any member can view another user profile from member list actions.
- Users can start a DM from profile/member context menu.
- DM list appears in sidebar with unread counts.
- DM messages support history pagination, realtime send/receive, typing, edit, and delete.
- Existing channel chat behavior remains unchanged.
