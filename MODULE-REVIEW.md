# Yankcord Module Review

> **Purpose**: This document splits the entire Yankcord codebase into reviewable
> modules. Each section describes one module's scope, files, responsibilities,
> and key areas to inspect. Use this as a checklist — review each module one at a
> time.
>
> **Codebase totals**: ~3 840 LOC server Rust, ~5 870 LOC client TS/TSX,
> ~4 740 LOC Tauri Rust = **~14 450 LOC**

---

## Table of Contents

| # | Module | Layer | LOC (approx) | Status |
|---|--------|-------|-------------|--------|
| 1 | [Server — Startup & Config](#1-server--startup--config) | Server | 226 | Pending |
| 2 | [Server — Authentication](#2-server--authentication) | Server | 104 | Pending |
| 3 | [Server — REST Routes](#3-server--rest-routes) | Server | 620 | Pending |
| 4 | [Server — WebSocket Layer](#4-server--websocket-layer) | Server | 1 795 | Pending |
| 5 | [Server — Media / SFU](#5-server--media--sfu) | Server | 1 084 | Pending |
| 6 | [Server — Database & Models](#6-server--database--models) | Server | 30 + migrations | Pending |
| 7 | [Client — App Shell & Routing](#7-client--app-shell--routing) | Frontend | 166 | Pending |
| 8 | [Client — API Layer (HTTP + WS)](#8-client--api-layer-http--ws) | Frontend | 357 | Pending |
| 9 | [Client — Media API (mediasoup)](#9-client--media-api-mediasoup) | Frontend | 2 182 | Pending |
| 10 | [Client — Stores (State)](#10-client--stores-state) | Frontend | 637 | Pending |
| 11 | [Client — UI Components](#11-client--ui-components) | Frontend | 2 418 | Pending |
| 12 | [Tauri — Entry & Source Enumeration](#12-tauri--entry--source-enumeration) | Desktop | 137 | Pending |
| 13 | [Tauri — Capture Service Core](#13-tauri--capture-service-core) | Desktop | 1 353 | Pending |
| 14 | [Tauri — Encoders (H.264, VP8, VP9, NVENC)](#14-tauri--encoders-h264-vp8-vp9-nvenc) | Desktop | 1 627 | Pending |
| 15 | [Tauri — RTP Pipeline (Packetizer + Sender)](#15-tauri--rtp-pipeline-packetizer--sender) | Desktop | 539 | Pending |
| 16 | [Tauri — Native Sender & Metrics](#16-tauri--native-sender--metrics) | Desktop | 1 084 | Pending |
| 17 | [Infrastructure — Deploy & Scripts](#17-infrastructure--deploy--scripts) | Ops | N/A | Pending |

---

## 1. Server — Startup & Config

**Scope**: Application bootstrap, dependency wiring, Axum router setup,
configuration loading.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `server/src/main.rs` | 133 | Axum app builder, state init, startup |
| `server/src/config.rs` | 93 | Env/TOML config struct and loading |

**Review focus**:
- Is shared state (`AppState`) built correctly? Any lock contention risk?
- Are all env vars validated at startup (fail-fast)?
- CORS policy — is it scoped appropriately?
- Graceful shutdown handling?
- Are mediasoup workers started and cleaned up properly?

---

## 2. Server — Authentication

**Scope**: JWT issuance, validation, middleware extraction.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `server/src/auth.rs` | 40 | JWT token create / verify |
| `server/src/errors.rs` | 45 | Error types and HTTP mapping |

**Review focus**:
- Token expiry and claims structure.
- Is the JWT secret rotatable without downtime?
- Are auth errors properly mapped to HTTP 401/403?
- Any timing-side-channel risk in password comparison?
- Does `errors.rs` leak internal details to clients?

---

## 3. Server — REST Routes

**Scope**: HTTP handlers for auth, channels, users.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `server/src/routes/mod.rs` | 3 | Module re-exports |
| `server/src/routes/auth_routes.rs` | 64 | `POST /api/connect` login flow |
| `server/src/routes/channel_routes.rs` | 443 | Channel + message CRUD |
| `server/src/routes/user_routes.rs` | 110 | User profile endpoints |

**Review focus**:
- Input validation and sanitization on all endpoints.
- SQL injection surface (SQLx compile-time checks help, but verify).
- Pagination on message listing — is there a limit? Cursor vs offset?
- Authorization checks — can any user delete any message/channel?
- Are channel types (`text`/`voice`) enforced correctly?
- Race conditions on concurrent channel operations?

---

## 4. Server — WebSocket Layer

**Scope**: Real-time messaging, presence, typing indicators, mediasoup signaling
relay.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `server/src/ws/mod.rs` | 5 | Module re-exports |
| `server/src/ws/handler.rs` | 1 452 | Connection lifecycle + message dispatch |
| `server/src/ws/messages.rs` | 130 | WS message type definitions (serde) |
| `server/src/ws/broadcast.rs` | 208 | Fan-out to connected clients |

**Review focus**:
- `handler.rs` is the **largest file in the server** (1 452 lines). Does it need
  splitting?
- Is the WS authenticated on connect (JWT in query/header)?
- Back-pressure: what happens if a slow client can't keep up with broadcasts?
- Memory cleanup on disconnect — are voice/media resources freed?
- Does the broadcast fan-out block the event loop?
- Message ordering guarantees?
- Are mediasoup signaling messages validated before forwarding?

---

## 5. Server — Media / SFU

**Scope**: mediasoup worker/router/transport/producer/consumer management, native
RTP ingestion.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `server/src/media/mod.rs` | 157 | Media state, worker pool, top-level API |
| `server/src/media/router.rs` | 63 | Per-channel router create/lookup |
| `server/src/media/transport.rs` | 858 | WebRTC + Plain RTP transport setup |
| `server/src/media/producer.rs` | 3 | Producer stub |
| `server/src/media/consumer.rs` | 3 | Consumer stub |

**Review focus**:
- `transport.rs` is the **largest single file** in the project (858 lines).
  Should it be split?
- Codec negotiation: are the `RtpCodecCapability` lists correct for each codec?
- Router lifecycle — are routers cleaned up when channels empty?
- Native RTP transport: is the UDP listener bound safely? Port reuse?
- Are DTLS/SRTP settings correct for WebRTC transports?
- Is there a limit on concurrent transports/producers per user?
- `producer.rs` / `consumer.rs` are 3-line stubs — is logic inlined elsewhere?

---

## 6. Server — Database & Models

**Scope**: Data model definitions and database migrations.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `server/src/models.rs` | 30 | Rust struct definitions |
| `server/migrations/20260210000001_initial.sql` | — | Initial schema |
| `server/migrations/20260212000002_simplify_auth.sql` | — | Auth simplification |
| `server/migrations/20260212000003_drop_server_tables.sql` | — | Remove multi-server |
| `server/migrations/20260212000004_remove_channel_server_id.sql` | — | Channel cleanup |

**Review focus**:
- Do migrations run idempotently? Are they destructive in production?
- Schema: are there proper indexes for common queries (messages by channel)?
- Are `ON DELETE CASCADE` / constraints set correctly?
- Does `models.rs` align with the final migration state?
- Any missing fields (timestamps, soft-delete flags)?

---

## 7. Client — App Shell & Routing

**Scope**: Root component, router setup, page-level layout.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `client/src/index.tsx` | 39 | SolidJS root mount + Router |
| `client/src/App.tsx` | 11 | Top-level route wrapper |
| `client/src/pages/Connect.tsx` | 80 | Login page |
| `client/src/pages/Chat.tsx` | 35 | Main chat view |
| `client/src/vite-env.d.ts` | 1 | Vite type reference |

**Review focus**:
- Route guards: is the user redirected if not authenticated?
- Does `Connect.tsx` handle connection errors gracefully?
- Is there a loading / reconnecting state?
- Any global error boundary?

---

## 8. Client — API Layer (HTTP + WS)

**Scope**: REST client and WebSocket connection management.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `client/src/api/http.ts` | 50 | Fetch wrapper with auth headers |
| `client/src/api/ws.ts` | 307 | WebSocket connect, reconnect, message routing |

**Review focus**:
- Does `http.ts` handle token expiry / 401 responses?
- WS reconnection strategy: exponential backoff? Max retries?
- Is there a heartbeat/ping to detect stale connections?
- Message buffering during reconnect — are messages lost?
- Type safety between WS message definitions and handlers.

---

## 9. Client — Media API (mediasoup)

**Scope**: mediasoup-client device, transports, producers, consumers,
screen-share, codec negotiation.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `client/src/api/media.ts` | 2 182 | Full mediasoup client integration |
| `client/src/api/nativeCapture.ts` | 97 | Tauri invoke bridge for native capture |

**Review focus**:
- `media.ts` is the **single largest file in the entire codebase** (2 182 lines).
  Major review target.
- Is the mediasoup Device loaded once and reused?
- Transport lifecycle: are send/recv transports closed on leave?
- Producer cleanup: mic, camera, screen — all stopped on leave?
- Consumer event handling: `transportclose`, `producerclose`?
- Codec preference logic: does it match server capabilities?
- Error recovery: what happens if `produce()` or `consume()` fails mid-call?
- Native capture bridge: is the Tauri invoke contract type-safe?
- Memory leaks: are event listeners removed on cleanup?
- `nativeCapture.ts` — does it handle Tauri-not-available gracefully?

---

## 10. Client — Stores (State)

**Scope**: SolidJS reactive state management for auth, chat, voice, and
settings.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `client/src/stores/auth.ts` | 70 | JWT, username, connected status |
| `client/src/stores/chat.ts` | 46 | Channels, messages, selected channel |
| `client/src/stores/voice.ts` | 318 | Voice/video state, media tracks, presence |
| `client/src/stores/settings.ts` | 203 | Device selection, preferences, persistence |

**Review focus**:
- Are stores properly scoped? Any global mutation from unexpected places?
- `voice.ts` (318 lines) — is the voice state machine clear? Edge cases on
  join/leave?
- Does `settings.ts` persist to localStorage? Any XSS via stored values?
- Are store updates batched to avoid excess re-renders?
- Does `auth.ts` clear all state on logout?
- Cross-store dependencies — is the update order well-defined?

---

## 11. Client — UI Components

**Scope**: All visual components for the chat/voice application.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `client/src/components/ChannelList.tsx` | 1 308 | Channel sidebar + creation + share UI |
| `client/src/components/MessageArea.tsx` | 470 | Message list, input, edit/delete |
| `client/src/components/UserSettingsDock.tsx` | 381 | Audio/video device settings |
| `client/src/components/MemberList.tsx` | 105 | Online users panel |
| `client/src/components/VideoStage.tsx` | 78 | Video grid / screen-share display |
| `client/src/components/VoicePanel.tsx` | 76 | Voice channel controls |

**Review focus**:
- `ChannelList.tsx` is **1 308 lines** — likely needs decomposition. Does it
  handle channel list, creation modal, share modal, and context menus all in one
  file?
- `MessageArea.tsx` (470 lines): message rendering, input, edit, delete —
  accessibility? Keyboard navigation?
- `UserSettingsDock.tsx` (381 lines): are device changes applied immediately or
  on save?
- XSS: is user-generated content (messages, usernames) sanitized before render?
- Responsive layout: does it handle small screens?
- Video rendering in `VideoStage.tsx` — are `<video>` elements properly
  attached/detached on track changes?
- Component re-render efficiency: are `createMemo` / `createEffect` used
  appropriately?

---

## 12. Tauri — Entry & Source Enumeration

**Scope**: Tauri plugin entry point and screen/window capture source listing.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `client/src-tauri/src/main.rs` | 6 | Windows entry point |
| `client/src-tauri/src/lib.rs` | 16 | Tauri plugin setup, command registration |
| `client/src-tauri/src/capture_sources.rs` | 115 | Enumerate monitors/windows/apps |

**Review focus**:
- Are Tauri commands registered with proper permissions?
- `capture_sources.rs`: Windows API calls — are handles released properly?
- Is the source enumeration fast enough to not block the UI thread?
- Error handling on unavailable displays?

---

## 13. Tauri — Capture Service Core

**Scope**: Main capture coordinator — starts/stops capture, manages encoder and
sender lifecycle.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `client/src-tauri/src/capture/mod.rs` | 2 | Module declarations |
| `client/src-tauri/src/capture/service.rs` | 610 | Capture orchestrator |
| `client/src-tauri/src/capture/windows_capture.rs` | 741 | Windows Graphics Capture API |

**Review focus**:
- `service.rs` (610 lines): is the state machine for start/stop/restart clear?
- Thread safety: are shared resources (encoder, sender) properly synchronized?
- `windows_capture.rs` (741 lines): Direct3D / DXGI integration — are GPU
  resources released on stop?
- Frame pipeline: capture → encode → packetize → send — any bottleneck?
- Back-pressure: what happens if encoding is slower than capture rate?
- Does stopping capture reliably clean up all resources (no dangling threads)?
- Codec change: does the restart flow handle mid-stream codec switches?

---

## 14. Tauri — Encoders (H.264, VP8, VP9, NVENC)

**Scope**: Video encoding backends for the native capture pipeline.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `client/src-tauri/src/capture/service/encoder_backend.rs` | 231 | Encoder trait + selection logic |
| `client/src-tauri/src/capture/service/h264_encoder.rs` | 130 | OpenH264 software encoder |
| `client/src-tauri/src/capture/service/nvenc_encoder.rs` | 501 | NVIDIA NVENC hardware encoder |
| `client/src-tauri/src/capture/service/vp8_encoder.rs` | 387 | VP8 encoder via FFmpeg (scaffolded) |
| `client/src-tauri/src/capture/service/vp9_encoder.rs` | 378 | VP9 encoder via FFmpeg (scaffolded) |

**Review focus**:
- `encoder_backend.rs`: is the auto-selection logic correct? Fallback chain?
- `h264_encoder.rs`: are OpenH264 parameters tuned for real-time (low latency)?
- `nvenc_encoder.rs` (501 lines): is GPU memory managed correctly? Feature-gate
  working?
- `vp8_encoder.rs` / `vp9_encoder.rs`: these are scaffolded — are the FFmpeg
  CLI invocations safe? Any shell injection risk?
- Is the encoder trait well-defined for adding future codecs (AV1)?
- Color space conversion: is BGRA→I420/NV12 handled correctly?
- Are encoders reusable or recreated per session?

---

## 15. Tauri — RTP Pipeline (Packetizer + Sender)

**Scope**: Assembling encoded frames into RTP packets and sending them via UDP.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `client/src-tauri/src/capture/service/rtp_packetizer.rs` | 151 | RTP packet assembly (headers, sequence, timestamp) |
| `client/src-tauri/src/capture/service/rtp_sender.rs` | 388 | UDP socket management, send loop |

**Review focus**:
- RTP header correctness: sequence number wrapping, timestamp increments, SSRC.
- Payload type mappings: do they match server expectations?
- Fragmentation: how are large frames (>MTU) split?
- `rtp_sender.rs` (388 lines): is the send loop async? Does it handle EAGAIN?
- Socket lifecycle: is the UDP socket reused across restarts?
- Packet loss handling: any FEC or retransmission (or is this SFU-side)?

---

## 16. Tauri — Native Sender & Metrics

**Scope**: High-level native sender coordination and performance telemetry.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `client/src-tauri/src/capture/service/native_sender.rs` | 814 | Orchestrates encoder → packetizer → RTP send |
| `client/src-tauri/src/capture/service/metrics.rs` | 270 | FPS, bitrate, encode time, dropped frames |

**Review focus**:
- `native_sender.rs` (814 lines) is the **largest Tauri file**. Should it be
  decomposed?
- Is the pipeline running on a dedicated thread / tokio task?
- Adaptive quality: does it respond to metrics (e.g., drop quality on high
  encode time)?
- `metrics.rs`: are counters atomic? Any overflow risk on long sessions?
- Are metrics exposed to the UI for debugging?
- Graceful degradation: what happens when the encoder falls behind?

---

## 17. Infrastructure — Deploy & Scripts

**Scope**: Deployment automation, Docker setup, and operational scripts.

**Files**:
| File | Lines | Purpose |
|------|-------|---------|
| `docker-compose.prod.yml` | — | Production container orchestration |
| `scripts/bootstrap-ubuntu-vm.sh` | — | VM provisioning |
| `scripts/deploy-docker.sh` | — | Docker deploy automation |
| `scripts/deploy-ovh.sh` | — | OVH-specific deployment |
| `docs/deploy.md` | — | Deployment documentation |
| `docs/native-codec-encoder-expansion.md` | — | Codec expansion technical doc |

**Review focus**:
- Are secrets (JWT_SECRET, DB password) properly externalized (not hardcoded)?
- Docker: is the image built with multi-stage (small final image)?
- Are health checks defined?
- Is the database backed up before destructive migrations?
- Are deploy scripts idempotent?
- Firewall/network: are only necessary ports exposed?

---

## Review Order Recommendation

For a bottom-up review, work through these groups:

1. **Foundation** (modules 1, 2, 6) — Config, auth, data model
2. **Server API** (modules 3, 4) — REST + WebSocket
3. **Server Media** (module 5) — SFU transport layer
4. **Client Core** (modules 7, 8, 10) — Shell, API, stores
5. **Client Media** (module 9) — mediasoup integration
6. **Client UI** (module 11) — Components
7. **Native Capture** (modules 12–16) — Tauri pipeline
8. **Ops** (module 17) — Deploy infrastructure

---

## Flags for Cross-Cutting Review

These concerns span multiple modules and should be checked across the board:

- **Error propagation**: Do errors bubble up cleanly from server → WS → client
  → UI?
- **Resource cleanup**: Voice/video join → leave. Are ALL resources freed
  (transports, producers, consumers, sockets, GPU memory)?
- **Concurrency**: Tokio tasks, channels, mutexes — any deadlock scenarios?
- **Type consistency**: Do WS message types match between
  `server/src/ws/messages.rs` and `client/src/api/ws.ts`?
- **Codec alignment**: Do codec IDs/names match across server transport config,
  client media API, and native encoders?
- **Security boundary**: User input flows: message content, usernames, channel
  names — are all sanitized?
