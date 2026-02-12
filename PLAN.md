# Yankcord Development Plan

## Phase 1: Core Chat App (MVP)

### 1.1 Fix post-login navigation
- Create a server browser/list page at `/servers/browse`
- Show joined servers with option to create or join new ones
- Route there after login/register

### 1.2 Wire up frontend components
- **Sidebar**: Fetch and render joined servers, highlight active server
- **ChannelList**: Fetch and render channels for selected server, handle text/voice distinction
- **MessageArea**: Render message history, send messages via input box, auto-scroll
- **MemberList**: Fetch and render server members

### 1.3 WebSocket message broadcasting
- Track channel subscriptions per WebSocket connection (who is viewing which channel)
- On `send_message`: persist to database AND broadcast `new_message` to all channel subscribers
- Handle user disconnect cleanup
- Replace the current echo-back behavior in `server/src/ws/handler.rs`

---

## Phase 2: Real-Time Polish

### 2.1 Presence system
- Track connected users via WebSocket connection state
- Broadcast `user_online` / `user_offline` events to relevant servers
- Show online/offline indicators in MemberList

### 2.2 Typing indicators
- Add `typing_start` / `typing_stop` WebSocket message types
- Show "X is typing..." in MessageArea
- Auto-expire typing state after timeout

### 2.3 Message editing & deletion
- REST endpoints for PATCH and DELETE on messages (author-only)
- WebSocket broadcast for `message_edited` / `message_deleted`
- Update `edited_at` field on edit
- Frontend inline editing UI

---

## Phase 3: Voice & Video

### 3.1 Server-side media transport
- Implement `server/src/media/transport.rs` — WebRTC transport creation via mediasoup
- Implement `server/src/media/producer.rs` — audio/video producer management
- Implement `server/src/media/consumer.rs` — consumer management
- Wire signaling through WebSocket (`media_signal` messages)

### 3.2 Client-side WebRTC
- Handle media signaling responses in `client/src/api/media.ts`
- Create mediasoup-client Device, send/recv transports
- Capture microphone/camera via getUserMedia
- Implement `VoicePanel` component — controls, participant list, mute/deafen

### 3.3 Voice channel state
- Track who is in which voice channel on the server
- Broadcast join/leave to other participants
- Show connected users in ChannelList and VoicePanel

---

## Phase 4: Hardening

### 4.1 Auth middleware
- Replace per-route manual token extraction with an Axum middleware/extractor
- Consistent 401 responses for expired/invalid tokens

### 4.2 Permission checks
- Verify server membership before allowing access to channels/messages
- Owner-only actions (delete server, manage channels)
- Consider role system (admin, moderator, member)

### 4.3 Input validation & rate limiting
- Validate message length, channel names, server names
- Rate limit message sending and auth attempts
- Sanitize user input to prevent stored XSS

---

## File Reference

Key files to modify per phase:

| Phase | Server | Client |
|-------|--------|--------|
| 1.1 | — | New page + router update |
| 1.2 | — | `components/Sidebar.tsx`, `ChannelList.tsx`, `MessageArea.tsx`, `MemberList.tsx` |
| 1.3 | `ws/handler.rs` (add broadcast + persist) | `api/ws.ts` (handle incoming messages) |
| 2.1 | `ws/handler.rs` (connection tracking) | `components/MemberList.tsx` |
| 2.2 | `ws/messages.rs`, `ws/handler.rs` | `components/MessageArea.tsx` |
| 2.3 | `routes/channel_routes.rs` or new message routes | `components/MessageArea.tsx` |
| 3.x | `media/transport.rs`, `producer.rs`, `consumer.rs` | `api/media.ts`, `components/VoicePanel.tsx` |
| 4.1 | New middleware file | — |
| 4.2 | Routes + middleware | — |
| 4.3 | Routes + middleware | — |
