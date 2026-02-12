# Yankcord Development Plan

## Vision

Yankcord is a self-hosted, minimal chat app. One server instance = one community. The server operator sets a server password in config. Clients install the app, point it at the server URL/IP, enter password + username, and start chatting. No signup, no email, no multi-tenant server directory.

## Ground Rules (Important for Scope)

- We ship both sides together for each MVP step: **server API/WS + client UI/state**.
- JWT identity is `username`-based for MVP; no per-user password.
- Keep the `users` table for now (stable `author_id` foreign key in `messages`), but remove credential fields.
- Single-community mode: remove server/guild management from API and UI.

---

## Phase 1: Minimal Working Chat (MVP)

Goal: a user can connect, select a channel, load history, and exchange real-time messages with others.

### 1.1 Simplify authentication

**Server**
- Add/keep `SERVER_PASSWORD` in config.
- `POST /api/connect` accepts `{ password, username }`.
- Validate server password and username constraints.
- Reject if username is currently connected.
- Return JWT with username claim.
- Remove credential field(s) from schema (`password_hash`), keep lightweight user rows.

**Client**
- Connect form submits `{ serverUrl, password, username }`.
- Save token, username, and server URL in auth store.
- Use saved server URL for HTTP + WS base URLs.

### 1.2 Remove multi-server concept

**Server**
- Remove server CRUD/member routes and server-scoped channel endpoints.
- Drop `servers` and `server_members` tables.
- Make channels instance-scoped (no `server_id`).
- Seed `#general` if no channels exist.

**Client**
- Remove server-centric routing/props (`serverId`) from chat flow.
- Update API calls to non-server-scoped endpoints (`/api/channels`, etc.).

### 1.3 Finalize connect flow and routes

**Server**
- Ensure `/api/connect` is the only auth entrypoint for MVP.

**Client**
- Keep a single Connect page.
- Route unauthenticated users to Connect; authenticated users to chat.
- Remove stale `/login` and `/register` route aliases.

### 1.4 Simplify chat layout

**Server**
- No API changes required.

**Client**
- Remove `Sidebar` (no server list).
- Use 3-column layout: `ChannelList | MessageArea | MemberList`.
- Rename `ServerView` to `Chat` (or equivalent) and update router imports.

### 1.5 Wire channels end-to-end

**Server**
- `GET /api/channels` returns all channels ordered by position.

**Client**
- `ChannelList` fetches channels, renders list, tracks active channel.
- Clicking a channel updates active channel state and highlight.

### 1.6 Wire messaging end-to-end

**Server**
- REST history: `GET /api/channels/:id/messages`.
- WS events:
  - Client -> server: `subscribe_channel`, `send_message`.
  - Server -> client: `new_message`.
- Persist messages before broadcast.
- Track subscriptions by **connection id** (not user id) to support reconnects and future multi-tab behavior.
- Include enough author data in outbound message payload to render UI without extra round trips.

**Client**
- On channel switch: fetch history + send `subscribe_channel`.
- On submit: send `send_message` via WS.
- Render message list and input; auto-scroll on new messages.

### 1.7 Wire member list end-to-end

**Server**
- Track connected usernames from authenticated WS sessions.
- Emit `presence_snapshot` on auth success.
- Emit `user_connected` / `user_disconnected` on join/leave.

**Client**
- `MemberList` consumes presence events and displays connected users.

---

## Phase 2: Real-Time Polish

### 2.1 Typing indicators
- [x] WS events: `typing_start` / `typing_stop`.
- [x] Show `X is typing...` in message area.
- [x] Client-side auto-expire typing state after 3s.

### 2.2 Message edit/delete
- [x] REST: `PATCH /api/messages/:id`, `DELETE /api/messages/:id` (author-only by username ownership).
- [x] WS broadcast: `message_edited`, `message_deleted`.
- [x] Inline edit/delete controls in message UI.

### 2.3 Channel management
- [x] REST: create/delete channels.
- [x] WS broadcast: `channel_created`, `channel_deleted`.
- [x] Live channel list updates on all clients.
- [x] Global `channel_activity` event added for unread badges without cross-channel message leakage.
- [x] Channel delete guard prevents deleting the last text channel, with atomic transaction + lock.
- [x] Non-blocking client error toast for channel action failures.

---

## Phase 3: Voice & Video (future)

- Reuse mediasoup infrastructure already in `server/src/media`.
- Add practical voice-channel flow and membership signaling.
- Integrate client voice panel with real transports/producers/consumers.

---

## Phase 4: Hardening (future)

- Server operator/admin role.
- Rate limiting and abuse controls.
- Stronger validation (length, charset, payload sizes).
- Kick/ban and moderation actions.

---

## File Map (Primary Touch Points)

| Step | Server | Client |
|------|--------|--------|
| 1.1 | `server/src/config.rs`, `server/src/auth.rs`, `server/src/routes/auth_routes.rs`, migration(s) | `client/src/pages/Connect.tsx`, `client/src/stores/auth.ts`, `client/src/api/http.ts`, `client/src/api/ws.ts` |
| 1.2 | `server/src/main.rs`, `server/src/routes/server_routes.rs` (delete), `server/src/routes/channel_routes.rs`, `server/src/models.rs`, migration(s) | `client/src/index.tsx`, `client/src/pages/ServerView.tsx` (or replacement), channel/member components |
| 1.3 | auth route cleanup | `client/src/index.tsx`, connect redirects/guards |
| 1.4 | — | `client/src/pages/ServerView.tsx` -> `client/src/pages/Chat.tsx` (or equivalent), `client/src/components/Sidebar.tsx` (delete) |
| 1.5 | `server/src/routes/channel_routes.rs` | `client/src/components/ChannelList.tsx` |
| 1.6 | `server/src/ws/messages.rs`, `server/src/ws/handler.rs`, `server/src/routes/channel_routes.rs` | `client/src/api/ws.ts`, `client/src/components/MessageArea.tsx` |
| 1.7 | `server/src/ws/messages.rs`, `server/src/ws/handler.rs` | `client/src/components/MemberList.tsx` |
| 2.x | channel/message/ws route handlers | message/channel UI components |

---

## Implementation Checklist (Execution Order)

Use this as the working checklist while coding. Every MVP step includes both server and client tasks.

### MVP 1.1 - Simplify authentication

- [x] **Server:** Ensure `SERVER_PASSWORD` exists in config loading + docs.
- [x] **Server:** Keep `POST /api/connect` as `{ password, username }` and validate:
  - [x] password matches server config
  - [x] username length/format is valid
  - [x] username is not already in active connection set
- [x] **Server:** Keep/create lightweight user row for username if missing.
- [x] **Server:** JWT contains username claim and works for REST + WS auth.
- [x] **Server:** Migration removes `users.password_hash` and leaves schema valid.
- [x] **Client:** Connect page sends server URL, password, username.
- [x] **Client:** Save token + username + normalized server URL in auth store.
- [x] **Client:** HTTP and WS base URLs come from saved server URL.
- [x] **Verify:** Connect succeeds with correct password and fails with wrong password.

### MVP 1.2 - Remove multi-server model

- [x] **Server:** Delete server CRUD/member routes from router and module exports.
- [x] **Server:** Migration drops `servers` and `server_members` safely.
- [x] **Server:** Migration removes `channels.server_id` and updates constraints/indexes.
- [x] **Server:** Add startup seed to ensure at least one `general` text channel exists.
- [x] **Client:** Remove `serverId` dependencies from route params and components.
- [x] **Client:** Update API calls from server-scoped endpoints to instance-scoped endpoints.
- [x] **Verify:** App works without any `/servers/:id/*` path assumptions.

### MVP 1.3 - Finalize connect route flow

- [x] **Server:** Keep `/api/connect` as the only MVP auth entrypoint.
- [x] **Client:** Keep only Connect page in routing flow.
- [x] **Client:** Remove `/login` and `/register` aliases and stale redirects.
- [x] **Client:** Add simple route guard: unauthenticated -> Connect, authenticated -> chat.
- [x] **Verify:** Refresh keeps session; logout returns to Connect.

### MVP 1.4 - Simplify chat layout

- [x] **Client:** Remove `Sidebar` component usage and file if unused.
- [x] **Client:** Rename `ServerView` to `Chat` (or equivalent) and update imports/routes.
- [x] **Client:** Render 3-column layout: `ChannelList | MessageArea | MemberList`.
- [x] **Verify:** Layout is usable at common desktop and narrow widths.

### MVP 1.5 - Wire channels end-to-end

- [x] **Server:** Add/confirm `GET /api/channels` returns channels ordered by position.
- [x] **Client:** `ChannelList` fetches and renders channels from `/api/channels`.
- [x] **Client:** Clicking channel updates active channel signal/store.
- [x] **Client:** Active channel visual state is clearly highlighted.
- [x] **Verify:** Channel list loads after connect and channel switching updates selection.

### MVP 1.6 - Wire messaging end-to-end

- [x] **Server REST:** `GET /api/channels/:id/messages` returns recent history.
- [x] **Server WS:** Add `subscribe_channel` client event.
- [x] **Server WS:** `send_message` validates content, persists message, then broadcasts `new_message` to current channel subscribers.
- [x] **Server WS:** Track subscriptions by connection id.
- [x] **Server WS:** `new_message` payload includes `author_username` (or equivalent display-ready author field).
- [x] **Client:** On channel select, fetch history and send WS `subscribe_channel`.
- [x] **Client:** On message submit, send WS `send_message` and clear input.
- [x] **Client:** Render history + realtime messages in one list and auto-scroll on new items.
- [x] **Verify:** Two clients in same channel see real-time messages; other channels do not.

### MVP 1.7 - Wire member list end-to-end

- [x] **Server WS:** Maintain connected authenticated usernames.
- [x] **Server WS:** Send `presence_snapshot` after successful WS auth.
- [x] **Server WS:** Broadcast `user_connected` and `user_disconnected` events.
- [x] **Client:** `MemberList` initializes from snapshot and updates on presence events.
- [x] **Verify:** Member list updates when another client connects/disconnects.

### MVP Exit Criteria

- [x] User can connect from a fresh client using server URL + password + username.
- [x] User can select channels and load message history.
- [x] User can send and receive real-time messages across multiple clients.
- [x] User can see currently connected members in real time.
- [x] No remaining runtime path uses deleted multi-server API/UI assumptions.
- [x] Server and client build successfully.

### Verification Commands

- [x] Server: `cd server && cargo test`
- [x] Server: `cd server && cargo build`
- [x] Client: `cd client && npm run build`

### Phase 2 Verification Commands

- [x] Server: `cd server && cargo check`
- [x] Client: `cd client && npm run build`
