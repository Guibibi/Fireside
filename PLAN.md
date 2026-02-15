# Yankcord Development Plan

## Vision

Yankcord is a self-hosted, minimal chat app. One server instance = one community. The server operator sets a server password in config. Clients install the app, point it at the server URL/IP, enter password + username, and start chatting. No signup, no email, no multi-tenant server directory.

## Scope Rules

- Ship server and client together for each milestone (REST/WS + UI/state).
- Preserve existing protocol behavior unless a milestone explicitly changes it.
- Keep changes additive and migration-safe by default.
- Track human verification in `QA.md` (not in this plan).

---

## Completed Milestones

- MVP chat flow is shipped: connect, channels, history, real-time messaging, presence.
- Real-time polish is shipped: typing indicators, edit/delete, channel management updates.
- Voice/video core is shipped: channel-scoped voice, camera, screen share, reconnect/device-change resilience.
- Native sender codec expansion is shipped: additive codec negotiation, strict codec mode, codec telemetry, codec readiness rollout (`VP8`/`VP9`/`AV1` ready).
- Phase 5.1 is shipped: channel list now renders separate `Text Channels` and `Voice Channels` sections while preserving existing unread and voice presence behavior.
- Phase 5.2 is shipped: native-style context menus for channels, messages, and members with keyboard (Context Menu key / Shift+F10), right-click, and long-press invocation, plus focus restoration after dismissal.

---

## Active Roadmap

## Phase 4: Hardening

### 4.1 Operator/admin role boundaries

- Add explicit server-side role checks for privileged actions.
- Define role capability matrix for channel management, moderation, and future media/admin controls.
- Surface permission failures with stable error codes/messages for client handling.

### 4.2 Rate limiting and abuse controls

- Add request limits for auth/connect, message send, and high-cost media endpoints.
- Add WS event throttling for spam-prone actions (message send, typing, reaction bursts).
- Add temporary penalties/backoff behavior with clear client-safe errors.

### 4.3 Stronger validation and payload safety

- Enforce stricter length/charset/shape validation at server boundaries.
- Cap payload sizes for text/JSON/media metadata and reject malformed payloads early.
- Keep schema/model validation and transport-layer validation aligned.

### 4.4 Moderation controls (kick/ban)

- Add operator/admin moderation actions with audit-friendly event trails.
- Enforce kick/ban checks on REST and WS auth/session paths.
- Add client UX for moderation feedback and forced-session cleanup handling.

### 4.5 Bot detection and scraper blocking

- Add automated detection for AI bots, crawlers, and scrapers at the request/WS handshake layer.
- Implement transparent challenge mechanisms (e.g., CAPTCHA, proof-of-work) for suspicious traffic patterns.
- Add operator-configurable allowlist/blocklist for known user-agents or IP ranges.
- Block or rate-limit detected bots with clear server responses; preserve legitimate client access.

---

## Phase 5: Social + UX Expansion

### Execution Order

1. Separate text/voice channel groups in UI
2. Native-style context menus
3. Media pipeline foundation (storage abstraction + processing)
4. User avatars + chat image uploads
5. Custom emojis/icons
6. Per-voice-channel codec configuration
7. Message reactions
8. GIF search support
9. Voice participant avatars polish

### 5.1 Separate text and voice channel groups in UI (completed)

**Goal**
- Improve navigation clarity by rendering explicit `Text Channels` and `Voice Channels` sections.

**Implementation details**
- Client: split channel list rendering by channel type while preserving sort/position semantics.
- Client: keep unread/activity badges on text channels and voice presence affordances on voice channels.
- Server: keep channel list endpoint compatible; include/confirm channel type field is authoritative.

### 5.2 Native-style context menus (completed)

**Goal**
- Provide desktop-native-feeling right-click menus for channels, users, messages, and member entries.

**Implementation details**
- Client: add shared context menu action registry keyed by target type (`channel`, `user`, `message`, `member`).
- Client: support mouse right-click, keyboard context key, and long-press fallback behavior.
- Server/client: enforce role-aware actions (show/enable only when permitted, re-check on server).
- UX: use confirmation affordances for destructive actions.

### 5.3 Media storage + optimization foundation

**Goal**
- Add a self-hosted media pipeline with local storage first and optional S3-compatible backend later.

**Implementation details**
- Server: introduce storage abstraction (`local` backend default, `s3`/MinIO optional via config).
- Server: store media metadata in Postgres (`owner_id`, `mime_type`, `bytes`, `checksum`, `storage_key`, timestamps, processing status).
- Server: process uploads into optimized derivatives and track lifecycle (`processing`, `ready`, `failed`).
- Server: add cleanup job for orphaned/failed derivatives.

### 5.4 User avatars

**Goal**
- Add profile avatars with optimized delivery.

**Implementation details**
- Upload constraints: `jpeg|png|webp`, max `2 MB`.
- Processing: normalize square variants (`256x256 webp` and `64x64 webp`), strip EXIF.
- Client: render avatars in member list, message list, and presence surfaces with fallback initials.

### 5.5 Image support in chat

**Goal**
- Support image attachments with preview and optimized transfer.

**Implementation details**
- Upload constraints: `image/jpeg|png|webp|gif`, max `10 MB`.
- Processing: display derivative (`max 1920x1920`, webp quality ~82) + thumbnail (`max 320x320`, quality ~75), EXIF stripped.
- Client: preview in message timeline; include open/download actions.
- Server: sniff MIME by content, not extension, and enforce dimension/payload limits before persist.

### 5.6 Custom emojis/icons

**Goal**
- Add per-instance custom emoji management and message usage.

**Implementation details**
- Upload constraints: `png|webp|gif` (static-first rollout), max `512 KB`, bounded to `128x128`.
- Server: CRUD APIs for emoji set and shortcode uniqueness validation.
- Client: emoji picker + `:shortcode:` parsing/rendering in composer and message body.

### 5.7 Per-voice-channel codec configuration

**Goal**
- Let operators configure preferred voice codec policy per voice channel.

**Implementation details**
- Server: add channel-level codec policy fields with migration-safe defaults.
- Negotiation precedence: channel policy > user preference > runtime auto fallback.
- Compatibility: when channel policy is absent, preserve current behavior.
- Client: expose codec config in channel settings with clear capability/compatibility messaging.

### 5.8 Message reactions

**Goal**
- Add lightweight emoji reactions with real-time updates.

**Implementation details**
- Server: reaction add/remove endpoints + WS broadcast events.
- Data model: enforce per-user uniqueness per message/reaction key.
- Client: render reaction chips, counts, and active-user state.

### 5.9 GIF search support

**Goal**
- Add GIF picker integration for rich inline content.

**Implementation details**
- Client: provider-backed GIF search UI (e.g., Tenor/Giphy) with safe insertion UX.
- Server: treat GIF embeds as attachment metadata payloads with validation.
- Client: render GIF embeds consistently with other attachment types.

### 5.10 Voice participant avatars

**Goal**
- Improve voice UI legibility with participant avatars and speaking emphasis.

**Implementation details**
- Client: show avatar tiles/rows for active voice participants.
- Client: preserve speaking-state emphasis and active-media affordances.
- Server/client: reuse existing presence and voice state streams without protocol breakage.

---

## Nice to Have (Future Considerations)

### Link Support with Embeds

- Detect URLs in message text and render them as clickable links.
- Optionally fetch and display rich embeds (title, description, image) similar to Discord.
- Security: validate and sanitize embed content; respect privacy (no prefetch without user action).

### Web Instance Auto-Configuration

- When running the web version (non-Tauri), automatically default the instance address to the current website origin.
- Skip the server address input step for web deployments while preserving it for desktop app users.
  - For tauri user, they should be prompted to select their instance, and then presented with the username and password



### @ Mentions for Users

- Support `@username` mentions in chat messages with autocomplete.
- Highlight mentioned messages for the target user.
- Send notification to mentioned users (in-app and optional push).

### Private Messages (Direct Messages)

- Enable one-to-one private messaging between users outside of channels.
- Add a DM list to the sidebar for easy access to conversations.
- Support initiating DMs from user profiles or member lists.

### Native Desktop Notifications

- Integrate with the OS notification system for message alerts, mentions, and calls.
- Include notification preferences (sounds, badges, quiet hours).
- Deep link notifications to the relevant channel or conversation.

### Voice Activity Detection (VAD) Sensitivity

- Expose VAD sensitivity controls in audio settings.
- Allow users to tune how aggressively their microphone activates on voice.
- Provide presets (low/medium/high) and fine-grained slider control.

### Noise Suppression / Echo Cancellation

- Toggleable noise suppression to reduce background noise.
- Echo cancellation to prevent feedback during voice calls.
- Use WebRTC built-in processing or integrate libraries like RNNoise.

### Network Quality Indicator

- Display real-time connection quality metrics in voice UI (packet loss, jitter, latency).
- Visual indicator (bars/colors) for quick assessment.
- Tooltip or panel with detailed stats for troubleshooting.

### Audio Normalization

- Normalize incoming voice audio levels so all participants sound equally loud.
- Apply dynamic range compression per remote audio track.
- Prevent loud users from overwhelming quiet ones automatically.

### Message Grouping by Day

- Group messages in the timeline with date headers ("Today", "Yesterday", "Monday, Jan 15").
- Improve scannability in busy channels with long history.
- Sticky date header while scrolling through messages.

### Auto-updater
- Add an auto updater for the tauri build to allow distribution of new version easily.
- User tauri update plugin https://v2.tauri.app/plugin/updater/
---

## Validation Baseline

Run these for relevant milestones:

- Backend: `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
- Backend: `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
- Backend: `cargo test --manifest-path server/Cargo.toml`
- Frontend: `npm --prefix client run typecheck`
- Frontend: `npm --prefix client run build`
