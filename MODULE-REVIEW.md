# Yankcord Module Review

> **Purpose**: This document splits the entire Yankcord codebase into reviewable
> modules. Each section describes one module's scope, files, responsibilities,
> and key areas to inspect. Use this as a checklist — review each module one at a
> time.
>
> **Snapshot date**: 2026-02-14
>
> **Codebase totals**: ~3 840 LOC server Rust · ~6 670 LOC client TS/TSX/CSS ·
> ~5 510 LOC Tauri Rust = **~16 020 LOC** (source only, excludes config/docs)

---

## Table of Contents

| # | Module | Layer | LOC | Status |
|---|--------|-------|-----|--------|
| 1 | [Server — Startup & Config](#1-server--startup--config) | Server | 226 | Pending |
| 2 | [Server — Authentication & Errors](#2-server--authentication--errors) | Server | 85 | Pending |
| 3 | [Server — REST Routes](#3-server--rest-routes) | Server | 620 | Pending |
| 4 | [Server — WebSocket Layer](#4-server--websocket-layer) | Server | 1 795 | Pending |
| 5 | [Server — Media / SFU](#5-server--media--sfu) | Server | 1 083 | Pending |
| 6 | [Server — Database & Models](#6-server--database--models) | Server | 95 | Pending |
| 7 | [Client — App Shell & Routing](#7-client--app-shell--routing) | Frontend | 166 | Pending |
| 8 | [Client — API Layer (HTTP + WS)](#8-client--api-layer-http--ws) | Frontend | 357 | Pending |
| 9 | [Client — Media API (mediasoup + Native Bridge)](#9-client--media-api-mediasoup--native-bridge) | Frontend | 2 412 | Pending |
| 10 | [Client — Stores (State)](#10-client--stores-state) | Frontend | 679 | Pending |
| 11 | [Client — UI Components](#11-client--ui-components) | Frontend | 2 635 | Pending |
| 12 | [Client — Styles](#12-client--styles) | Frontend | 1 165 | Pending |
| 13 | [Tauri — Entry & Source Enumeration](#13-tauri--entry--source-enumeration) | Desktop | 165 | Pending |
| 14 | [Tauri — Capture Service Core](#14-tauri--capture-service-core) | Desktop | 1 402 | Pending |
| 15 | [Tauri — Encoders (H.264, VP8, VP9, AV1, NVENC)](#15-tauri--encoders-h264-vp8-vp9-av1-nvenc) | Desktop | 2 015 | Pending |
| 16 | [Tauri — RTP Pipeline (Packetizer + Sender)](#16-tauri--rtp-pipeline-packetizer--sender) | Desktop | 621 | Pending |
| 17 | [Tauri — Native Sender & Metrics](#17-tauri--native-sender--metrics) | Desktop | 1 084 | Pending |
| 18 | [Infrastructure — Deploy & Scripts](#18-infrastructure--deploy--scripts) | Ops | N/A | Pending |

---

## 1. Server — Startup & Config

**Scope**: Application bootstrap, dependency wiring, Axum router setup,
configuration loading.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `server/src/main.rs` | 133 | Axum app builder, state init, migrations, mediasoup workers |
| `server/src/config.rs` | 93 | Env/TOML config struct (`ServerConfig`, `DatabaseConfig`, `JwtConfig`, `MediaConfig`) |

**Review focus**:
- Is shared state (`AppState`) built correctly? Any lock contention risk with
  `Arc<Mutex<...>>` vs `Arc<RwLock<...>>`?
- Are all env vars validated at startup (fail-fast)?
- CORS policy — is it scoped appropriately or wide-open `*`?
- Graceful shutdown handling — are mediasoup workers, WS connections, and DB
  pool cleaned up?
- Does the server bind to `0.0.0.0` by default? Is that intended?
- Are mediasoup workers started with proper log levels and resource limits?

---

## 2. Server — Authentication & Errors

**Scope**: JWT issuance, validation, middleware extraction, error mapping.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `server/src/auth.rs` | 40 | JWT token create/verify with `jsonwebtoken` |
| `server/src/errors.rs` | 45 | `AppError` enum → HTTP response mapping |

**Review focus**:
- Token expiry and claims structure — what's in the payload?
- Is the JWT secret configurable and rotatable without downtime?
- Are auth errors mapped to proper HTTP 401/403 (not 500)?
- Does the server password comparison use constant-time comparison (avoid
  timing side-channel)?
- Does `errors.rs` leak internal details (stack traces, DB errors) to clients?
- Is the JWT algorithm pinned (prevent `alg: none` attacks)?

---

## 3. Server — REST Routes

**Scope**: HTTP handlers for auth, channels, users, messages.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `server/src/routes/mod.rs` | 3 | Module re-exports |
| `server/src/routes/auth_routes.rs` | 64 | `POST /api/connect` — server password + username → JWT |
| `server/src/routes/channel_routes.rs` | 443 | Channel CRUD + message CRUD (list, create, edit, delete) |
| `server/src/routes/user_routes.rs` | 110 | `GET /api/users`, `PATCH /api/users/me` |

**Review focus**:
- Input validation and sanitization on all endpoints (channel names, message
  content, usernames).
- SQL injection surface — SQLx compile-time checks help, but verify all queries
  use parameterized binds.
- Pagination on message listing — is there a max limit? Cursor vs offset?
- Authorization: can any user delete any message/channel, or only authors/admins?
- Are channel types (`text`/`voice`) validated on creation and enforced on
  message endpoints (e.g., no messages in voice channels)?
- Race conditions on concurrent channel create/delete?
- `channel_routes.rs` at 443 lines — does it mix too many concerns?

---

## 4. Server — WebSocket Layer

**Scope**: Real-time messaging, presence tracking, typing indicators, voice
join/leave, mediasoup signaling relay.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `server/src/ws/mod.rs` | 5 | Module re-exports |
| `server/src/ws/handler.rs` | 1 452 | Connection lifecycle, auth, message dispatch, media signaling |
| `server/src/ws/messages.rs` | 130 | Serde-tagged client/server message type definitions |
| `server/src/ws/broadcast.rs` | 208 | Fan-out broadcast helpers (channel-scoped, global) |

**Review focus**:
- `handler.rs` is the **largest file in the server** (1 452 lines). It handles
  auth, chat, presence, voice, and media signaling all in one — should it be
  split into sub-handlers?
- Is the WS authenticated on upgrade (JWT in query param or first message)?
- Back-pressure: what happens if a slow client can't keep up with broadcasts?
  Unbounded channels?
- Memory cleanup on disconnect — are voice/media resources
  (transports, producers, consumers) freed?
- Does the broadcast fan-out block the Tokio event loop?
- Message ordering guarantees — is there a sequence number?
- Are mediasoup signaling messages validated before forwarding, or is the
  `payload` passed through blindly?
- Heartbeat: is there a server-side timeout for stale connections?
- Typing indicators: are they rate-limited to prevent spam?

---

## 5. Server — Media / SFU

**Scope**: mediasoup worker/router/transport/producer/consumer management,
codec capability negotiation, native RTP ingestion for screen-share.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `server/src/media/mod.rs` | 157 | `MediaService`, worker pool, router/transport top-level API |
| `server/src/media/router.rs` | 63 | Per-channel router creation and lookup |
| `server/src/media/transport.rs` | 857 | WebRTC + PlainRTP transport setup, codec capabilities |
| `server/src/media/producer.rs` | 3 | Producer stub (re-export only) |
| `server/src/media/consumer.rs` | 3 | Consumer stub (re-export only) |

**Review focus**:
- `transport.rs` at 857 lines is the **second-largest server file**. Should codec
  capability definitions be extracted?
- Codec negotiation: are `RtpCodecCapability` lists correct for VP8, H.264, VP9,
  AV1? Do payload types match client expectations?
- Router lifecycle — are routers cleaned up when the last user leaves a channel?
- Native RTP transport: is the UDP listener bound safely? Port allocation and
  reuse? What happens if the port is already in use?
- Are DTLS/SRTP parameters correct for WebRTC transports?
- Is there a limit on concurrent transports/producers per user to prevent
  resource exhaustion?
- `producer.rs` / `consumer.rs` are 3-line stubs — is the real logic inlined in
  `handler.rs`? Should it be extracted?
- ICE candidate handling — is there a timeout for ICE completion?

---

## 6. Server — Database & Models

**Scope**: Data model definitions and database schema migrations.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `server/src/models.rs` | 30 | `Channel`, `Message`, `User` Rust structs (SQLx `FromRow`) |
| `server/migrations/20260210000001_initial.sql` | 56 | Initial schema: users, channels, messages, (legacy servers) |
| `server/migrations/20260212000002_simplify_auth.sql` | 2 | Auth simplification |
| `server/migrations/20260212000003_drop_server_tables.sql` | 5 | Drop multi-server tables |
| `server/migrations/20260212000004_remove_channel_server_id.sql` | 2 | Remove `server_id` from channels |

**Review focus**:
- Do migrations run idempotently? Are destructive migrations (drop tables) safe
  in production with existing data?
- Schema: are there proper indexes for common queries (`messages` by
  `channel_id` + `created_at`)?
- Are `ON DELETE CASCADE` / foreign key constraints set correctly?
- Does `models.rs` align with the final migration state (after all 4 migrations)?
- Any missing fields (updated_at timestamps, soft-delete flags)?
- Is password_hash still in the users table even though auth is server-password
  based? Dead column?
- Are UUID primary keys used, or sequential integers?

---

## 7. Client — App Shell & Routing

**Scope**: Root component, router setup, page-level layout, auth guards.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `client/src/index.tsx` | 39 | SolidJS root mount + `<Router>` |
| `client/src/App.tsx` | 11 | Top-level route wrapper |
| `client/src/pages/Connect.tsx` | 80 | Login form (server URL, password, username) |
| `client/src/pages/Chat.tsx` | 35 | Main chat layout (sidebar + content + members) |
| `client/src/vite-env.d.ts` | 1 | Vite type reference |

**Review focus**:
- Route guards: is the user redirected to `/connect` if not authenticated?
- Does `Connect.tsx` handle connection errors gracefully (wrong password, server
  unreachable)?
- Is there a loading or reconnecting state between pages?
- Any global error boundary for uncaught exceptions?
- Is the server URL stored and reused across sessions (localStorage)?

---

## 8. Client — API Layer (HTTP + WS)

**Scope**: REST client abstraction and WebSocket connection management.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `client/src/api/http.ts` | 50 | Fetch wrapper with `Authorization: Bearer` header |
| `client/src/api/ws.ts` | 307 | WebSocket connect, reconnect, heartbeat, message routing |

**Review focus**:
- Does `http.ts` handle token expiry / 401 responses? Auto-redirect to login?
- WS reconnection strategy: exponential backoff? Max retries? Jitter?
- Is there a heartbeat/ping to detect stale connections?
- Message buffering during reconnect — are outgoing messages queued or lost?
- Type safety between WS message type strings and handler callbacks.
- Is the WS URL constructed correctly from the server URL (http→ws scheme)?
- Does `ws.ts` clean up event listeners on unmount?

---

## 9. Client — Media API (mediasoup + Native Bridge)

**Scope**: mediasoup-client device management, transport lifecycle,
audio/video/screen producers, remote consumers, codec negotiation,
native capture Tauri bridge.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `client/src/api/media.ts` | 2 304 | **LARGEST FILE** — full mediasoup client integration |
| `client/src/api/nativeCapture.ts` | 108 | Tauri invoke wrappers for native capture commands |

**Review focus**:
- `media.ts` at **2 304 lines** is the single largest file in the codebase.
  Major review target. Should it be decomposed into transport, producer,
  consumer, and codec-negotiation modules?
- Is the mediasoup `Device` loaded once and reused across voice joins?
- Transport lifecycle: are send/recv transports closed on voice leave?
- Producer cleanup: mic, camera, screen — are all stopped and closed on leave?
- Consumer event handling: `transportclose`, `producerclose`, `trackended`?
- Codec preference logic: does it match server `RtpCodecCapability` definitions?
- Error recovery: what happens if `produce()` or `consume()` fails mid-call?
- Native capture bridge: is the Tauri invoke contract type-safe? What if invoked
  in a browser (non-Tauri) context?
- Memory leaks: are event listeners removed on cleanup?
- `nativeCapture.ts` (108 lines): does it guard against Tauri-not-available?
  Does it expose all capture commands (start, stop, status, set codec/encoder)?

---

## 10. Client — Stores (State)

**Scope**: SolidJS reactive state management for auth, chat, voice, and
user settings.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `client/src/stores/auth.ts` | 70 | Token, username, server URL, connected status (localStorage) |
| `client/src/stores/chat.ts` | 46 | Active channel, messages, unread counts |
| `client/src/stores/voice.ts` | 318 | Voice state machine: joined channel, participants, camera/screen, speaking |
| `client/src/stores/settings.ts` | 245 | Device preferences, screen-share settings (resolution, fps, bitrate, codec, encoder) |
| `client/src/utils/platform.ts` | 13 | Tauri detection helper |

**Review focus**:
- Are stores properly scoped? Any global mutation from unexpected places?
- `voice.ts` (318 lines) — is the voice state machine clear? Edge cases on
  rapid join/leave? What happens if the server disconnects mid-voice?
- `settings.ts` (245 lines) — does it persist to localStorage? Is stored data
  validated on load (schema migration if shape changes)?
- Are store updates batched to avoid excess SolidJS re-renders?
- Does `auth.ts` clear all state on logout (including voice, chat)?
- Cross-store dependencies: does `voice.ts` depend on `settings.ts` for device
  selection? Is the update order well-defined?
- `settings.ts` now includes screen-share codec/encoder/bitrate/fps preferences.
  Are these validated before being sent to native capture?

---

## 11. Client — UI Components

**Scope**: All visual components for the chat and voice/video application.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `client/src/components/ChannelList.tsx` | 1 525 | Channel sidebar, creation modal, share modal, encoder/codec settings |
| `client/src/components/MessageArea.tsx` | 470 | Message list, input box, edit/delete, typing indicators |
| `client/src/components/UserSettingsDock.tsx` | 381 | Settings dock: audio/video device selection, username update |
| `client/src/components/MemberList.tsx` | 105 | Online/offline member list, voice presence indicators |
| `client/src/components/VideoStage.tsx` | 78 | Video tile grid (local camera, local screen, remote tracks) |
| `client/src/components/VoicePanel.tsx` | 76 | Voice channel join/leave controls, participant list |

**Review focus**:
- `ChannelList.tsx` at **1 525 lines** is the largest component — it handles
  channel list rendering, channel creation modal, screen-share source picker
  modal, encoder/codec/bitrate/fps settings UI, and likely context menus. Should
  be decomposed into sub-components.
- `MessageArea.tsx` (470 lines): message rendering, input, edit, delete —
  is user-generated content (messages, usernames) XSS-safe? Keyboard
  navigation and accessibility?
- `UserSettingsDock.tsx` (381 lines): are device changes applied immediately
  or require save? Does it enumerate devices reactively?
- `MemberList.tsx` (105 lines): does it update in real-time with presence?
- `VideoStage.tsx` (78 lines): are `<video>` elements properly
  attached/detached on track changes? `srcObject` cleanup?
- `VoicePanel.tsx` (76 lines): does it show speaking indicators? Mute state?
- Component re-render efficiency: are `createMemo` / `createEffect` used
  appropriately, or are there unnecessary re-renders on store updates?

---

## 12. Client — Styles

**Scope**: Global CSS styling for the entire application.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `client/src/styles/global.css` | 1 165 | All application styles (layout, chat, voice, video, modals, settings) |

**Review focus**:
- At 1 165 lines in a single file, should styles be co-located with components
  or split into modules?
- Is there a consistent naming convention (BEM, utility-first, etc.)?
- Dark theme: is it the only theme, or is light theme supported?
- Responsive breakpoints: does it handle mobile/tablet viewports?
- Are modals (share, create channel, settings) properly layered with z-index?
- Are there any hardcoded pixel values that should be relative (rem/em)?
- Accessibility: sufficient color contrast ratios? Focus indicators?

---

## 13. Tauri — Entry & Source Enumeration

**Scope**: Tauri plugin entry point, command registration, and platform-specific
capture source listing.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `client/src-tauri/src/main.rs` | 6 | Windows entry point (`main` calls `client_lib::run`) |
| `client/src-tauri/src/lib.rs` | 17 | Tauri plugin setup, command registration, capture service state |
| `client/src-tauri/src/capture_sources.rs` | 115 | Enumerate monitors, windows, and apps via DXGI/Windows API |
| `client/src-tauri/build.rs` | 27 | Tauri build script |

**Review focus**:
- Are Tauri commands registered with proper permissions (`capabilities/`)?
- `capture_sources.rs`: are Windows API handles released properly? Does
  enumeration work on multi-monitor setups?
- Is the source enumeration async or does it block the main/UI thread?
- Error handling on unavailable displays or permission denied?
- `lib.rs`: is the capture service state (`Mutex<Option<...>>`) safe for
  concurrent Tauri command invocations?

---

## 14. Tauri — Capture Service Core

**Scope**: Main capture coordinator — starts/stops capture sessions, manages
encoder and sender lifecycle, codec probing.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `client/src-tauri/src/capture/mod.rs` | 2 | Module declarations |
| `client/src-tauri/src/capture/service.rs` | 659 | Capture orchestrator: start/stop/status, codec probing, session management |
| `client/src-tauri/src/capture/windows_capture.rs` | 741 | Windows Graphics Capture API wrapper, BGRA frame dispatch |

**Review focus**:
- `service.rs` (659 lines): is the state machine for start/stop/restart clear?
  What states can the service be in?
- Thread safety: are shared resources (encoder, sender) properly synchronized?
  `Arc<Mutex>` vs `tokio::sync::Mutex`?
- `windows_capture.rs` (741 lines): Direct3D / DXGI frame acquisition — are GPU
  resources (textures, surfaces, device) released on stop?
- Frame pipeline: capture → encode → packetize → send — any bottleneck points?
- Back-pressure: what happens if encoding is slower than capture rate? Are frames
  dropped or queued unboundedly?
- Does stopping capture reliably clean up all resources (no dangling threads,
  no leaked GPU handles)?
- Codec change mid-session: does the restart flow handle codec switches cleanly
  (e.g., H264 → VP9)?
- Codec probing: how does the service determine which codecs/encoders are
  available at runtime?

---

## 15. Tauri — Encoders (H.264, VP8, VP9, AV1, NVENC)

**Scope**: Video encoding backends for the native capture pipeline. All encoders
implement a common trait, selected by the encoder-backend factory.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `client/src-tauri/src/capture/service/encoder_backend.rs` | 244 | Encoder trait, backend factory, selection logic, env-var config |
| `client/src-tauri/src/capture/service/h264_encoder.rs` | 130 | OpenH264 software encoder (always available, Rust-native) |
| `client/src-tauri/src/capture/service/nvenc_encoder.rs` | 501 | NVIDIA NVENC hardware H.264 via FFmpeg subprocess |
| `client/src-tauri/src/capture/service/vp8_encoder.rs` | 387 | VP8 via FFmpeg subprocess, IVF frame parsing |
| `client/src-tauri/src/capture/service/vp9_encoder.rs` | 378 | VP9 via FFmpeg subprocess, IVF frame parsing |
| `client/src-tauri/src/capture/service/av1_encoder.rs` | 374 | AV1 via FFmpeg subprocess, IVF frame parsing |

**Review focus**:
- `encoder_backend.rs` (244 lines): is the auto-selection logic correct? What's
  the fallback chain? (`auto` → NVENC → OpenH264 for H.264; FFmpeg for VP8/VP9/AV1)
- `h264_encoder.rs`: are OpenH264 parameters tuned for real-time (low latency,
  baseline profile)? BGRA → I420 color conversion correct?
- `nvenc_encoder.rs` (501 lines): is the FFmpeg subprocess managed correctly?
  Stdin/stdout piping? What happens on FFmpeg crash? The 12-failure fallback
  mechanism — is it reliable?
- `vp8_encoder.rs` / `vp9_encoder.rs` / `av1_encoder.rs`: these use FFmpeg
  subprocesses — are the CLI arguments constructed safely (no shell injection)?
  Is the IVF container parsing correct (header skipping, frame size reading)?
- Is the encoder trait well-defined and uniform across all backends?
- Are encoders recreated per session or reused?
- Color space conversion: is BGRA → I420/NV12 correct across all encoders?
- FFmpeg path configuration: env vars `YANKCORD_NATIVE_VP8_FFMPEG_PATH` etc. —
  are they validated?
- Force-keyframe: do all encoders support it? Is it triggered correctly on
  PLI/FIR RTCP feedback?

---

## 16. Tauri — RTP Pipeline (Packetizer + Sender)

**Scope**: Assembling encoded video frames into RTP packets per codec-specific
RFC, and transmitting them via UDP.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `client/src-tauri/src/capture/service/rtp_packetizer.rs` | 144 | `RtpPacketizer` trait + H.264/VP8/VP9/AV1 implementations |
| `client/src-tauri/src/capture/service/rtp_sender.rs` | 477 | UDP socket management, RTCP feedback polling, codec-specific send paths |

**Review focus**:
- `rtp_packetizer.rs`: does each codec packetizer follow its RFC?
  - H.264: FU-A fragmentation (RFC 6184)?
  - VP8: payload descriptor (RFC 7741)?
  - VP9: flexible mode descriptor (draft)?
  - AV1: OBU aggregation (draft-ietf-payload-av1)?
- RTP header correctness: sequence number wrapping at 65535, timestamp
  increments at 90kHz clock rate, SSRC consistency.
- Payload type mappings: do they match the server's `RtpCodecCapability`
  definitions exactly?
- MTU handling: how are large frames (>1200 bytes) fragmented? Is the MTU
  configurable?
- `rtp_sender.rs` (477 lines): is the send loop async? Does it handle
  `EAGAIN`/`WouldBlock`?
- RTCP feedback: does it poll for PLI/FIR and relay keyframe requests to the
  encoder?
- Socket lifecycle: is the UDP socket reused across codec changes or recreated?
- Packet loss: is there any FEC, NACK, or retransmission, or is this purely
  SFU-side?

---

## 17. Tauri — Native Sender & Metrics

**Scope**: High-level native sender coordination (frame capture → encode →
packetize → UDP send) and performance telemetry for adaptive quality.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `client/src-tauri/src/capture/service/native_sender.rs` | 814 | Main sender loop, degradation control, frame pipeline orchestration |
| `client/src-tauri/src/capture/service/metrics.rs` | 270 | Atomic counters: FPS, bitrate, encode time, queue depth, degradation level |

**Review focus**:
- `native_sender.rs` at **814 lines** is the largest Tauri file. Should it be
  decomposed (e.g., separate degradation controller)?
- Is the pipeline running on a dedicated thread or tokio task? Does it block
  the Tauri main thread?
- Adaptive quality / degradation control:
  - 3 levels: FPS reduction → resolution scaling → bitrate reduction.
  - Pressure sampling: 20-sample window at 250ms intervals.
  - Are thresholds well-calibrated? (avg ≤2/4/6, peak ≤4/6/7)
  - Recovery: avg ≤1, peak ≤2 — is hysteresis sufficient to avoid oscillation?
- `metrics.rs` (270 lines): are all counters `AtomicU64`? Any overflow risk on
  long sessions (hours)?
- Are metrics exposed to the frontend UI for debugging/telemetry?
- Graceful degradation: what happens when the encoder consistently falls behind?
  Is there a "give up" threshold?
- Frame drop policy: when the queue is full, are oldest or newest frames dropped?

---

## 18. Infrastructure — Deploy & Scripts

**Scope**: Deployment automation, Docker orchestration, and operational scripts.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `docker-compose.prod.yml` | — | Production container orchestration |
| `scripts/bootstrap-ubuntu-vm.sh` | — | Ubuntu VM provisioning (deps, Rust, Node, Postgres) |
| `scripts/deploy-docker.sh` | — | Docker build + deploy automation |
| `scripts/deploy-ovh.sh` | — | OVH-specific deployment |
| `docs/deploy.md` | — | Deployment documentation |
| `docs/native-codec-encoder-expansion.md` | — | Codec expansion plan, env var reference, calibration guide |

**Review focus**:
- Are secrets (JWT_SECRET, DB password, SERVER_PASSWORD) properly externalized
  (env vars, not hardcoded in scripts or compose files)?
- Docker: is the image built with multi-stage (builder + minimal runtime)?
- Are health checks defined for the server container?
- Is the database backed up before running destructive migrations?
- Are deploy scripts idempotent (safe to re-run)?
- Firewall/network: are only necessary ports exposed (3000 HTTP, mediasoup
  UDP range)?
- Is mediasoup's native C++ worker bundled correctly in the Docker image?
- TLS: is HTTPS/WSS termination handled (reverse proxy, Let's Encrypt)?

---

## Review Order Recommendation

For a bottom-up review, work through these groups:

1. **Foundation** (modules 1, 2, 6) — Config, auth, data model
2. **Server API** (modules 3, 4) — REST + WebSocket
3. **Server Media** (module 5) — SFU transport layer
4. **Client Core** (modules 7, 8, 10) — Shell, API, stores
5. **Client Media** (module 9) — mediasoup integration (largest file)
6. **Client UI** (modules 11, 12) — Components + styles
7. **Native Capture** (modules 13–17) — Tauri pipeline
8. **Ops** (module 18) — Deploy infrastructure

---

## Flags for Cross-Cutting Review

These concerns span multiple modules and should be checked across the board:

- **Error propagation**: Do errors bubble up cleanly from server → WS → client
  → UI? Is the user informed when things fail?
- **Resource cleanup**: Voice/video join → leave. Are ALL resources freed
  (transports, producers, consumers, sockets, GPU memory, FFmpeg subprocesses)?
- **Concurrency**: Tokio tasks, `Arc<Mutex>`, broadcast channels — any deadlock
  scenarios? Any `await` while holding a lock?
- **Type consistency**: Do WS message types match between
  `server/src/ws/messages.rs` and `client/src/api/ws.ts`? Any message the server
  sends that the client doesn't handle (or vice versa)?
- **Codec alignment**: Do codec names, payload types, and clock rates match
  across server `transport.rs` codec capabilities, client `media.ts` producer
  options, and native encoder/packetizer/sender?
- **Security boundary**: User input flows through messages, usernames, and
  channel names — are all sanitized before DB insertion and before DOM rendering?
- **Subprocess safety**: FFmpeg is spawned by VP8/VP9/AV1/NVENC encoders —
  are arguments passed as arrays (not shell strings)? Are processes killed on
  cleanup?
- **Large file decomposition**: Five files exceed 800 lines — `media.ts` (2 304),
  `ChannelList.tsx` (1 525), `handler.rs` (1 452), `global.css` (1 165),
  `transport.rs` (857), `native_sender.rs` (814). Each should be evaluated for
  splitting.
