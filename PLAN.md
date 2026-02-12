# Yankcord Development Plan

## Vision

Yankcord is a self-hosted, minimal chat app. One server instance = one community. The server operator sets a server password in config. Clients install the app, point it at the server's URL/IP, enter the password + pick a username, and start chatting. No signup, no accounts, no email — just connect and talk.

---

## Phase 1: Minimal Working Chat (MVP)

Goal: a client can connect to a server, join a channel, and exchange messages with other users in real time.

### 1.1 Simplify auth model
- **Remove** user registration and per-user passwords entirely
- Server config gets a `SERVER_PASSWORD` env var
- New endpoint `POST /api/connect` — client sends `{ password, username }`
  - Validate password matches `SERVER_PASSWORD`
  - If username is taken by an active connection, reject
  - Return a JWT containing the username (no user ID needed for now)
- Remove `password_hash` from users table; the `users` table becomes a lightweight session ledger (username + connected_at) or can be dropped entirely in favor of in-memory tracking
- **Files:** `server/src/auth.rs`, `server/src/routes/auth_routes.rs`, `server/src/config.rs`, migration

### 1.2 Remove multi-server concept
- **Remove** `servers` table, `server_members` table, and all server CRUD routes
- Channels belong directly to the instance (drop `server_id` FK from channels, or keep a single implicit server row)
- Seed a `#general` channel on first startup if none exist
- **Remove** `server_routes.rs`, simplify `channel_routes.rs`
- **Files:** migration, `server/src/routes/server_routes.rs` (delete), `server/src/routes/channel_routes.rs`, `server/src/models.rs`

### 1.3 Connect screen (client)
- Replace Login + Register pages with a single **Connect** page
- Fields: **Server URL** (e.g. `http://192.168.1.50:3000`), **Password**, **Username**
- On success: save JWT + server URL to auth store, navigate to main chat view
- **Remove** `pages/Register.tsx`, repurpose `pages/Login.tsx` → `pages/Connect.tsx`
- Update `api/http.ts` to use the saved server URL as base instead of hardcoded localhost
- **Files:** `client/src/pages/Connect.tsx`, `client/src/stores/auth.ts`, `client/src/api/http.ts`, `client/src/index.tsx`

### 1.4 Simplify layout
- Remove `Sidebar.tsx` (no server list needed — you're connected to one server)
- Layout becomes 3-column: **ChannelList | MessageArea | MemberList**
- **Files:** `client/src/pages/ServerView.tsx` → rename to `Chat.tsx`, `client/src/components/Sidebar.tsx` (delete)

### 1.5 Wire up channels
- `ChannelList` fetches channels from `GET /api/channels` and renders them
- Clicking a channel sets it as active (SolidJS signal)
- Highlight the active channel
- **Files:** `client/src/components/ChannelList.tsx`, `server/src/routes/channel_routes.rs`

### 1.6 Wire up messaging
- **REST (history):** `GET /api/channels/:id/messages` — fetch past messages on channel select
- **WebSocket (real-time):**
  - Client sends `subscribe_channel { channel_id }` when switching channels
  - Client sends `send_message { channel_id, content }`
  - Server persists message to DB AND broadcasts `new_message` to all subscribers of that channel
  - Track channel subscriptions per WS connection in a shared map (`Arc<RwLock<HashMap<ChannelId, HashSet<UserId>>>>`)
- **MessageArea:** render message list, input box, auto-scroll on new messages
- **Files:** `server/src/ws/handler.rs`, `server/src/ws/messages.rs`, `client/src/components/MessageArea.tsx`, `client/src/api/ws.ts`

### 1.7 Wire up member list
- Track connected usernames via WebSocket connection state (shared map)
- `MemberList` shows all currently connected users
- Broadcast `user_connected` / `user_disconnected` on WS connect/disconnect
- **Files:** `server/src/ws/handler.rs`, `client/src/components/MemberList.tsx`

---

## Phase 2: Real-Time Polish

### 2.1 Typing indicators
- `typing_start` / `typing_stop` WS messages
- Show "X is typing..." in MessageArea
- Auto-expire after 3s timeout

### 2.2 Message editing & deletion
- `PATCH /api/messages/:id` and `DELETE /api/messages/:id` (author-only by username match)
- WS broadcast `message_edited` / `message_deleted`
- Inline edit UI in MessageArea

### 2.3 Channel management
- Create/delete channels (anyone for now, admin-only later)
- WS broadcast `channel_created` / `channel_deleted` so all clients update in real time

---

## Phase 3: Voice & Video (future)

- WebRTC via mediasoup
- Voice channels using existing `media/` module stubs
- VoicePanel component

---

## Phase 4: Hardening (future)

- Admin role (server operator can set via config or special token)
- Rate limiting
- Input validation & message length limits
- Kick/ban users

---

## File Reference

Key files to create/modify/delete per step:

| Step | Server | Client |
|------|--------|--------|
| 1.1 | `auth.rs`, `routes/auth_routes.rs`, `config.rs`, new migration | — |
| 1.2 | Delete `routes/server_routes.rs`, update `channel_routes.rs`, `models.rs`, new migration | — |
| 1.3 | — | New `pages/Connect.tsx`, delete `Register.tsx`, update `stores/auth.ts`, `api/http.ts`, `index.tsx` |
| 1.4 | — | Rename `ServerView.tsx` → `Chat.tsx`, delete `Sidebar.tsx` |
| 1.5 | Update `channel_routes.rs` (list all channels endpoint) | `components/ChannelList.tsx` |
| 1.6 | `ws/handler.rs`, `ws/messages.rs` (broadcast + persist + subscriptions) | `components/MessageArea.tsx`, `api/ws.ts` |
| 1.7 | `ws/handler.rs` (connection tracking) | `components/MemberList.tsx` |
| 2.1 | `ws/messages.rs`, `ws/handler.rs` | `components/MessageArea.tsx` |
| 2.2 | New message routes or update `channel_routes.rs` | `components/MessageArea.tsx` |
| 2.3 | `channel_routes.rs`, `ws/messages.rs` | `components/ChannelList.tsx` |
