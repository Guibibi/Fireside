# Yankcord Phase 3 Plan: Voice & Video

## Goal

Ship practical, end-to-end voice/video for channels using the existing mediasoup foundation, with clear UX for join/leave, device state, and participant media tiles.

## Scope and Guardrails

- Build on current single-community channel model (no multi-server assumptions).
- Keep text chat behavior unchanged while adding voice/video as an adjacent real-time layer.
- Ship server + client slices together for each milestone.
- Prefer incremental, testable steps over one large media rewrite.
- Default media routing architecture is mediasoup SFU.
- Keep transport/session abstractions structured so an optional P2P mode can be added without breaking SFU wire contracts.

---

## Milestone 3.1 - Voice Presence and Signaling Contract

Goal: users can see who is in a voice session per channel, even before full media streaming is enabled.

### Server

- Define/confirm WS message schema for voice presence and signaling events:
  - Client -> server: `voice_join`, `voice_leave`
  - Server -> client: `voice_presence_snapshot`, `voice_user_joined`, `voice_user_left`
- Track voice membership by connection id and channel id.
- Broadcast membership changes to all connected clients (or channel subscribers per current architecture).
- Ensure disconnect cleanup removes stale voice membership.

### Client

- Add voice state store (joined channel, participants, self media flags).
- Render voice participant list in channel/member UI context.
- Implement join/leave actions with optimistic disabled/loading states.
- Initialize from snapshot and update from incremental WS events.

### Verify

- Two clients joining/leaving same channel see membership updates in real time.
- Forced disconnect cleans up participant presence without manual refresh.

### Phase 3.1 File-Level Breakdown (Concrete Order)

1. `server/src/main.rs`
   - Add voice presence maps to `AppState`:
     - `voice_members_by_connection: HashMap<Uuid, Uuid>` (connection -> voice channel)
     - `voice_members_by_channel: HashMap<Uuid, HashSet<String>>` (voice channel -> usernames)
   - Initialize both maps in startup state.

2. `server/src/ws/messages.rs`
   - Keep current client events (`join_voice`, `leave_voice`) for compatibility.
   - Add server events for presence sync:
     - `voice_presence_snapshot { channels: [{ channel_id, usernames[] }] }`
     - `voice_user_joined { channel_id, username }`
     - `voice_user_left { channel_id, username }`
   - Keep existing `voice_joined`/`voice_left` as transitional events only if client still needs them.

3. `server/src/ws/handler.rs`
   - On WS auth success, send `voice_presence_snapshot` from in-memory voice maps.
   - `JoinVoice` flow:
     - remove prior voice membership for that connection (if any),
     - set new channel membership,
     - broadcast `voice_user_joined` (and `voice_user_left` for previous channel when moving).
   - `LeaveVoice` flow:
     - remove connection membership,
     - broadcast `voice_user_left`.
   - On disconnect, ensure voice membership cleanup happens before/with regular cleanup.

4. `server/src/ws/broadcast.rs`
   - Extend `cleanup_connection(...)` to remove voice membership by `connection_id`.
   - Return optional cleanup metadata (`left_channel_id`, `username`) or emit `voice_user_left` from caller after cleanup.
   - Keep lock ordering consistent to avoid deadlocks when touching multiple maps.

5. `client/src/stores/voice.ts` (new)
   - Add voice store signals:
     - `joinedVoiceChannelId: string | null`
     - `participantsByChannel: Record<string, string[]>`
     - `voiceActionState: "idle" | "joining" | "leaving"`
   - Add actions: `applyVoiceSnapshot`, `applyVoiceJoined`, `applyVoiceLeft`, `setJoinedVoiceChannel`, `resetVoiceState`.

6. `client/src/api/ws.ts`
   - Extend `ServerMessage` union with new voice presence event payloads.
   - Preserve existing events while migrating UI to snapshot + incremental presence updates.
   - Keep reconnect behavior so cached snapshot is replayed to late subscribers.

7. `client/src/components/VoicePanel.tsx`
   - Replace placeholder with:
     - Join/leave buttons for active channel,
     - Joined state indicator,
     - participant list for joined/active voice channel.
   - Disable controls while action state is `joining` or `leaving`.

8. `client/src/pages/Chat.tsx`
   - Mount `VoicePanel` in chat layout (likely under `MessageArea` or near `MemberList`).
   - On logout, also clear voice store via `resetVoiceState`.

9. `client/src/components/MemberList.tsx` (optional in 3.1)
   - Add a small "in voice" indicator per member if present in active channel voice participants.
   - Keep optional to avoid blocking core presence milestone.

10. Verification pass
    - Manual: connect 2 clients, join/leave/move voice channels, close one tab/process.
    - Commands:
      - `cd server && cargo check`
      - `cd client && npm run build`

---

## Milestone 3.2 - Mediasoup Transport Handshake

Goal: create and connect send/recv transports between client and server.

### Server

- Finalize media service APIs used by WS handlers:
  - Router capabilities request
  - Create WebRTC transport (send/recv)
  - Connect transport (DTLS params)
- Bind transport lifecycle to authenticated connection id.
- Add structured error responses for signaling failures.

### Client

- Initialize `mediasoup-client` `Device` from server router RTP capabilities.
- Request and create send/recv transports from signaling API.
- Connect transports with DTLS params through WS signaling.
- Handle transport state transitions and reconnection fallbacks.

### Verify

- A connected client can complete media handshake without producing/consuming tracks.
- Rejoin after leaving channel recreates transports cleanly.

---

## Milestone 3.3 - Audio Publish/Subscribe

Goal: users can hear each other in a voice-enabled channel.

### Server

- Add signaling events for produce/consume flow:
  - Client -> server: `media_produce`, `media_consume`, `media_resume_consumer`
  - Server -> client: `media_produced`, `new_producer`, `media_consumer_created`
- Create producer on send transport for microphone track.
- Create consumers on recv transport for remote producers in same channel.
- Enforce channel-scoped media routing; no cross-channel audio leakage.
- Close producers/consumers/transports on leave/disconnect.

### Client

- Capture local mic stream and produce audio track.
- Subscribe to remote audio producers and attach to hidden audio elements.
- Add mute/unmute toggle (track enabled + signaling/state reflection).
- Handle producer/consumer closure events gracefully.

### Verify

- Two or more clients in one channel can hear each other.
- Muting updates local behavior immediately and does not break transport.
- Users in different channels cannot hear each other.

---

## Milestone 3.4 - Camera Video Publish/Subscribe (SFU)

Goal: optional camera video works alongside voice using mediasoup SFU routing.

### Server

- Reuse produce/consume signaling paths for video kind.
- Apply basic per-connection limits (e.g., one camera producer initially).
- Broadcast producer availability changes for UI tile updates.

### Client

- Add camera on/off controls and local preview.
- Produce video track on existing send transport.
- Consume remote video tracks and render participant tiles.
- Handle permission denial and missing camera devices without crashing.

### Verify

- Participants can enable/disable camera dynamically.
- Remote tiles appear/disappear in real time.
- Audio remains stable while toggling video.

---

## Milestone 3.5 - Screen Sharing Publish/Subscribe (SFU first, optional P2P mode)

Goal: users can share their screen independently from camera, with SFU as default and optional P2P mode as a separate transport strategy.

### Server

- Add explicit signaling semantics for screen-share producer lifecycle (start/stop/update).
- Keep screen-share routing channel-scoped through mediasoup SFU by default.
- Define mode contract for media routing:
  - `sfu` (default)
  - `p2p` (optional, guarded/feature-flagged)
- If/when `p2p` is enabled, keep auth and channel membership checks identical to SFU path.

### Client

- Add screen-share start/stop using `getDisplayMedia` and separate local state from camera state.
- Render remote screen-share tiles with clear presenter identity.
- Define coexistence behavior (camera + screen allowed or mutually exclusive) and enforce consistently.
- Add UX affordances for share end events (browser stop button, permission revocation, window close).

### Verify

- One user can start/stop screen share without dropping voice.
- Other channel members see screen tile lifecycle changes in real time.
- Same-channel only visibility is preserved (no cross-channel leakage).
- If P2P mode is enabled, behavior matches SFU feature parity for core share flow.

---

## Milestone 3.6 - UX and Reliability Pass

Goal: make voice/video usable in day-to-day sessions.

### Server

- Add heartbeat/timeout handling to clear ghost media sessions.
- Improve media-related WS error payloads and logs for diagnostics.
- Add lightweight rate/validation guards on signaling payload sizes and event frequency.

### Client

- Add clear connection states: joining, connected, reconnecting, failed.
- Show actionable error toasts/messages for media failures.
- Persist preferred devices (mic/camera ids) and restore when possible.
- Add push-to-talk placeholder hook or keyboard toggle foundation (optional MVP+).

### Verify

- Restarting server/client leads to predictable reconnection behavior.
- Device unplug/replug path does not leave UI in broken state.

---

## Implementation Checklist (Execution Order)

### Phase 3.1 - Voice presence signaling

- [x] **Server:** Add WS message types for `voice_join`, `voice_leave`, snapshot, join, leave.
- [x] **Server:** Track voice members by connection/channel and clean on disconnect.
- [x] **Client:** Add voice store for membership and self channel join state.
- [x] **Client:** Render participant presence and join/leave controls.
- [x] **Verify:** Multi-client voice presence updates in real time.

### Phase 3.2 - Transport handshake

- [x] **Server:** Expose signaling handlers for RTP capabilities and transport create/connect.
- [x] **Server:** Bind transport lifecycle to authenticated connection.
- [x] **Client:** Initialize mediasoup `Device` and send/recv transports.
- [x] **Client:** Handle transport connect/retry states.
- [x] **Verify:** Handshake succeeds repeatedly across join/leave cycles.

### Phase 3.3 - Audio streaming

- [x] **Server:** Implement produce/consume signaling and channel-scoped routing.
- [x] **Server:** Create/close audio producers and consumers safely.
- [x] **Client:** Produce microphone track and consume remote audio tracks.
- [x] **Client:** Implement mute/unmute UX and state sync.
- [x] **Verify:** Same-channel audio works; cross-channel audio isolation holds.

### Phase 3.4 - Video streaming

- [ ] **Server:** Support video producers/consumers and availability events.
- [ ] **Client:** Add camera toggle, local preview, and remote video tiles.
- [ ] **Client:** Handle camera permission/device errors gracefully.
- [ ] **Verify:** Video toggles live without degrading audio continuity.

### Phase 3.5 - Screen sharing

- [ ] **Server:** Add screen-share signaling and channel-scoped SFU routing.
- [ ] **Client:** Add start/stop share, presenter tile UI, and share-end handling.
- [ ] **Client:** Implement/guard optional routing mode toggle (`sfu` default, `p2p` optional).
- [ ] **Verify:** Screen share is stable and isolated per channel.

### Phase 3.6 - Reliability and polish

- [ ] **Server:** Add media session cleanup guards and stronger signaling validation.
- [ ] **Client:** Add clear voice/video connection status and actionable failure UI.
- [ ] **Client:** Persist media device preferences when available.
- [ ] **Verify:** Reconnect and device-change paths are stable.

### Phase 3 Exit Criteria

- [ ] Users can join/leave voice sessions and see live participant presence.
- [ ] Users can publish and receive channel-scoped audio.
- [ ] Users can publish and receive optional camera video streams.
- [ ] Users can publish and receive optional screen-share streams.
- [ ] SFU remains the default routing mode; optional P2P mode does not break SFU behavior.
- [ ] Voice/video state recovers from expected disconnect and device-change scenarios.
- [ ] Server and client complete build/check commands successfully.

### Verification Commands

- [ ] Server: `cd server && cargo check`
- [ ] Server: `cd server && cargo test`
- [ ] Client: `cd client && npm run build`

### Manual QA Matrix

- [ ] Single user join/leave voice channel repeatedly.
- [ ] Two users audio only (mute/unmute both sides).
- [ ] Two users audio + video (toggle camera repeatedly).
- [ ] Three users same channel stability smoke test.
- [ ] Users split across two channels (confirm isolation).
- [ ] One user disconnects unexpectedly (presence/media cleanup).
