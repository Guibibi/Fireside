# Yankcord Voice Chat Module - Comprehensive Review

## Executive Summary

The voice system implements a **Selective Forwarding Unit (SFU)** architecture using **mediasoup** on both client and server. The Rust server manages mediasoup workers, routers, and transports. The TypeScript client uses `mediasoup-client` with the Web Audio API for audio processing. The Tauri desktop client **reuses 100% of the web client's voice code** through its Chromium webview, adding only native screen capture (video-only) via Rust.

**Architecture is sound.** The codebase demonstrates clean separation of concerns, proper resource lifecycle management, and a well-designed signaling protocol. However, there are several critical and high-priority issues that need attention for production readiness.

---

## 1. Architecture Overview

```
                         CLIENT (Web / Tauri)
┌──────────────────────────────────────────────────────────────┐
│  ChannelList.tsx (orchestration)                             │
│    ├─ VoiceDock.tsx (controls UI)                            │
│    ├─ VideoStage.tsx (video grid)                            │
│    └─ voice.ts store (reactive state via SolidJS signals)    │
│                                                              │
│  api/media/ (15 modules)                                     │
│    ├─ transports.ts   (WebRTC send/recv transport lifecycle) │
│    ├─ producers.ts    (mic, camera, screen share outgoing)   │
│    ├─ consumers.ts    (remote audio/video incoming)          │
│    ├─ signaling.ts    (request-response over WebSocket)      │
│    ├─ voiceActivity.ts(VAD via FFT/RMS analysis)             │
│    ├─ microphoneProcessing.ts (outgoing gain control)        │
│    ├─ devices.ts      (hot-swap mic/camera/speaker)          │
│    ├─ constraints.ts  (media constraints builder)            │
│    ├─ codecs.ts       (codec selection & preference)         │
│    ├─ native.ts       (Tauri screen capture bridge)          │
│    ├─ subscriptions.ts(pub-sub for media state changes)      │
│    ├─ errors.ts       (user-friendly error messages)         │
│    └─ state.ts        (module-level non-reactive state)      │
└──────────────────────────────────────────────────────────────┘
                              │
                    WebSocket + WebRTC
                              │
                          SERVER (Rust)
┌──────────────────────────────────────────────────────────────┐
│  ws/handler.rs     (voice join/leave, speaking events)       │
│  ws/media_signal.rs(signaling protocol, 9 action types)      │
│  ws/voice.rs       (broadcast helpers)                       │
│  ws/broadcast.rs   (cleanup, state management)               │
│                                                              │
│  media/                                                      │
│    ├─ mod.rs          (MediaService, workers, router cache)  │
│    ├─ router.rs       (opus config, codec definitions)       │
│    ├─ transport.rs    (transport/producer/consumer mgmt)     │
│    └─ native_codec.rs (native RTP screen sharing)            │
│                                                              │
│  In-Memory State:                                            │
│    voice_members_by_connection: HashMap<ConnId, ChannelId>   │
│    voice_members_by_channel: HashMap<ChannelId, Set<User>>   │
│                                                              │
│  Database: channels table (opus_bitrate, opus_dtx, opus_fec) │
└──────────────────────────────────────────────────────────────┘
```

### Connection Lifecycle

```
1. Client sends JoinVoice { channel_id } over WebSocket
2. Server validates channel, updates in-memory state, broadcasts VoiceUserJoined
3. Server sends VoiceJoined back to client
4. Client calls initializeMediaTransports(channelId):
   a. Requests RTP capabilities from server
   b. Loads mediasoup Device
   c. Creates Send + Recv WebRTC transports
   d. Wires DTLS connect + ICE monitoring
   e. Starts local audio producer (getUserMedia → gain → produce)
   f. Starts voice activity monitoring (FFT/RMS loop)
   g. Flushes queued remote producer announcements → consume each
5. On new_producer signal: consumeRemoteProducer()
   - Audio: HTMLAudioElement → SourceNode → Compressor → GainNode → Destination
   - Video: RemoteVideoTile entry
6. On LeaveVoice: closeTransports() → cleanup all resources → reset state
```

---

## 2. Client-Side Review

### 2.1 File Inventory

| File | Purpose | Lines | Risk |
|------|---------|-------|------|
| `stores/voice.ts` | Reactive state (SolidJS signals) | 413 | Low |
| `api/media/state.ts` | Module-level non-reactive state | 144 | Low |
| `api/media/transports.ts` | WebRTC transport setup & lifecycle | 376 | Medium |
| `api/media/producers.ts` | Outgoing audio/video/screen | 737 | High |
| `api/media/consumers.ts` | Incoming audio/video playback | 382 | High |
| `api/media/voiceActivity.ts` | Speaking detection (VAD) | 111 | Medium |
| `api/media/microphoneProcessing.ts` | Outgoing volume gain | 104 | Medium |
| `api/media/signaling.ts` | WebSocket request-response | 178 | Medium |
| `api/media/subscriptions.ts` | Publisher-subscriber pattern | 122 | Low |
| `api/media/devices.ts` | Audio/video device management | 150+ | High |
| `api/media/constraints.ts` | Media constraints builder | 97 | Low |
| `api/media/codecs.ts` | Codec selection & preference | ~80 | Low |
| `api/media/errors.ts` | Error normalization | 72 | Low |
| `api/media/native.ts` | Tauri screen capture bridge | 88 | Medium |
| `components/channel-list/VoiceDock.tsx` | Voice control panel UI | 131 | Low |
| `components/VideoStage.tsx` | Video tile grid | 78 | Low |
| `components/settings/VoiceAudioPreferences.tsx` | Voice settings UI | 110 | Low |
| `components/ChannelList.tsx` | Main voice integration/orchestration | 1200+ | High |

### 2.2 Audio Processing Chain

**Outgoing (microphone):**
```
getUserMedia(constraints)
  → SourceNode
    → GainNode (outgoing volume 0-200%)
      → MediaStreamDestination (processed track)
        → mediasoup Producer
```

**Incoming (remote participants):**
```
mediasoup Consumer track
  → MediaStreamSource
    → DynamicsCompressorNode (auto-level normalization)
      → GainNode (per-user volume 0-200%)
        → AudioContext.destination
          → HTMLAudioElement (playback)
```

Normalization settings: threshold -24dB, knee 20dB, ratio 3:1, attack 3ms, release 250ms.

### 2.3 Voice Activity Detection

- FFT size: 512 samples
- Smoothing: 0.85 time constant
- Speaking threshold: RMS >= 0.04 (4%)
- Hold duration: 220ms (prevents jitter between speech segments)
- Runs via `requestAnimationFrame` (60fps)

### 2.4 Screen Share - Two Modes

**Browser mode** (web + Tauri fallback):
- Uses `getDisplayMedia()` API
- Supports 720p/1080p/1440p/4K at 30/60 FPS
- Codec preference: H.264 > VP8 > VP9
- Content hint: "motion" (high FPS) or "detail" (low FPS)

**Native Tauri mode** (desktop only):
- Uses Rust backend RTP sender
- H.264 only (NVENC hardware acceleration when available)
- Fallback monitoring every 1s for encoder failures
- Diagnostics reported to server
- Falls back to browser mode if native fails

### 2.5 Device Management

- Hot-swap microphone at runtime (replaces producer track)
- Hot-swap camera (replaces producer track)
- Speaker routing via `HTMLAudioElement.setSinkId()`
- Device change detection via `navigator.mediaDevices.ondevicechange`
- Automatic reset if current device disappears

---

## 3. Server-Side Review

### 3.1 File Inventory

| File | Purpose | Lines | Risk |
|------|---------|-------|------|
| `media/mod.rs` | MediaService, worker/router lifecycle | 177 | High |
| `media/router.rs` | Opus config, codec definitions | 91 | Medium |
| `media/transport.rs` | Transport/producer/consumer management | 656 | High |
| `media/native_codec.rs` | Native video codec, screen sharing | 215 | Medium |
| `ws/media_signal.rs` | Media signaling protocol handler | 1064 | High |
| `ws/voice.rs` | Voice broadcast functions | 118 | Low |
| `ws/handler.rs` | Voice join/leave, main WS handler | 1416 | High |
| `ws/broadcast.rs` | State cleanup, connection management | 400 | Medium |

### 3.2 MediaService Architecture

- **Workers**: Configurable count via `MEDIA_WORKER_COUNT` (default: 2)
- **Router caching**: Per-channel, deterministic worker assignment via `channel_id.as_bytes()[0] % worker_count`
- **Transport types**: WebRtcTransport (send/recv) + PlainTransport (native RTP)
- **Rate limiting**: 80 media signal events per 5-second window per connection
- **Payload limit**: 32 KB per media signal

### 3.3 Supported Codecs

**Audio**: Opus (48kHz, stereo, 2ch) with configurable bitrate/DTX/FEC per channel
**Video**: VP8, H.264 (packetization-mode=1, profile 42e01f), VP9, AV1
**RTCP Feedback**: Nack, NackPli, CcmFir, GoogRemb, TransportCc

### 3.4 Signaling Protocol

9 action types over WebSocket:

| Action | Purpose |
|--------|---------|
| `GetRouterRtpCapabilities` | Get channel's codec capabilities |
| `CreateWebrtcTransport` | Create send or recv transport |
| `ConnectWebrtcTransport` | Complete DTLS handshake |
| `MediaProduce` | Create audio/video producer |
| `MediaConsume` | Create consumer for remote producer |
| `MediaResumeConsumer` | Resume paused consumer |
| `MediaCloseProducer` | Close a producer |
| `CreateNativeSenderSession` | Setup native RTP screen sharing |
| `ClientDiagnostic` | Log client diagnostic data |

Request-response pattern with unique IDs (`media-{timestamp}-{counter}`), 10-second timeout.

### 3.5 In-Memory Voice State

```rust
voice_members_by_connection: HashMap<Uuid, Uuid>         // connection -> channel
voice_members_by_channel: HashMap<Uuid, HashSet<String>>  // channel -> usernames
```

No database persistence. Server restart loses all voice sessions.

### 3.6 Producer Constraints

- One camera producer per connection
- One screen producer per connection
- No limit on microphone producers
- Kind must match source (audio ↔ microphone, video ↔ camera/screen)
- Only "sfu" routing mode supported

---

## 4. Tauri Desktop Client

### What Tauri Adds

The Tauri Rust backend provides **only video capture** commands:
1. `list_native_capture_sources` - Enumerate screens/windows/apps
2. `native_codec_capabilities` - Report available video codecs
3. `start_native_capture` - Start hardware-accelerated screen capture
4. `stop_native_capture` - Stop capture
5. `native_capture_status` - Encoding/RTP metrics

### What Tauri Does NOT Do

- **No native audio capture** (no cpal, rodio, or dasp)
- **No native audio processing** (no noise suppression or echo cancellation)
- **No audio device management** (all via `navigator.mediaDevices`)
- **No separate voice transport** (same WebRTC via Chromium webview)

### Correct Architecture Choice

This is the right approach. Tauri's Chromium webview provides full WebRTC with optimized audio (libwebrtc's AEC, NS, AGC), making native audio redundant. Native screen capture adds value because `getDisplayMedia()` has limitations on desktop (no NVENC, limited window selection).

---

## 5. Issues & Recommendations

### CRITICAL

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| C1 | **No voice membership persistence** | Server in-memory only | Server restart drops all voice sessions silently. Clients have no mechanism to detect and rejoin. |
| C2 | **Router codec settings never update** | `media/mod.rs` router cache | Changing channel opus_bitrate/dtx/fec after first user joins has no effect until server restart. |
| C3 | **No consumer auto-cleanup on producer close** | `media/transport.rs` | Consumers remain in HashMap after producer closes, causing memory leak over time. |
| C4 | **No timeout on transport creation** | `transports.ts:279` | If server hangs responding to capabilities request, `initializeMediaTransports()` blocks indefinitely. |
| C5 | **Silent audio playback failure** | `consumers.ts:247-265` | If `audio.play()` fails twice, error is logged but user hears silence with no UI feedback. |

### HIGH

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| H1 | **No channel permission checks for voice** | `ws/handler.rs` | Any authenticated user can join any voice channel. No ACL or role-based access control. |
| H2 | **TOCTOU race on camera/screen limit** | `transport.rs:266-321` | Duplicate producer check happens twice with a gap. Concurrent requests could both pass. |
| H3 | **Producer owner lookup silently fails** | `transport.rs:555-600` | When recv transport created and owner disconnected, consumer doesn't receive producer notification. |
| H4 | **No mediasoup worker health monitoring** | `media/mod.rs` | Worker crash causes silent failure. No restart logic, no health checks. |
| H5 | **No reconnection logic** | Client transports | If WebSocket reconnects, media transports are not re-established automatically. User must manually retry. |
| H6 | **Screen share native fallback is sticky** | `producers.ts:680-685` | Once `nativeCaptureAttempted` set true, user can't retry browser mode without page reload. |
| H7 | **No bandwidth/bitrate enforcement** | Server consumers | Consumers created without bitrate limits. No congestion control feedback. Network overload possible. |

### MEDIUM

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| M1 | **VAD uses requestAnimationFrame** | `voiceActivity.ts` | 60fps monitoring is overkill. A 50ms `setInterval` (~20fps) would suffice and save CPU. |
| M2 | **Slow producer notification batching** | `transport.rs:555-600` | N producers = N separate JSON messages on recv transport creation. Should batch. |
| M3 | **Voice activity broadcast includes self** | `ws/handler.rs:611-632` | `exclude_connection_id` is None — client receives its own speaking event. |
| M4 | **VAD hold duration too short** | `voiceActivity.ts:77-78` | 220ms can miss natural speech pauses. 300-400ms or configurable would be better. |
| M5 | **Audio play() retry is naive** | `consumers.ts` | Hardcoded 500ms delay, no exponential backoff, only 2 attempts. |
| M6 | **Transport health race condition** | `transports.ts:106-112` | Multiple transports closing in parallel could set health state to wrong value. |
| M7 | **Microphone processing resource leak** | `microphoneProcessing.ts` | If `activateMicrophoneProcessing()` called without prior cleanup, old session is orphaned. |
| M8 | **No signaling retry logic** | `signaling.ts` | First 10-second timeout = permanent failure. No retry for transient network issues. |
| M9 | **Transport direction silently replaced** | `transport.rs` | Creating send transport twice replaces first without error. |
| M10 | **Mediasoup errors exposed to client** | `ws/media_signal.rs` | Internal error messages sent directly, potential information disclosure. |

### LOW / CODE QUALITY

| # | Issue | Location |
|---|-------|----------|
| L1 | Volume clamping function duplicated | `consumers.ts` + `microphoneProcessing.ts` |
| L2 | Magic numbers not extracted to constants | Multiple files (10000ms, 220ms, 512 FFT, 0.04 threshold) |
| L3 | Inconsistent error handling | Mix of `console.warn`, `console.error`, and throw |
| L4 | No subscriber count limits | `subscriptions.ts` — potential memory leak |
| L5 | NormalizationNode config recreated per consumer | `consumers.ts` — should be module constant |
| L6 | No video tile pagination | `VideoStage.tsx` — unwieldy with many participants |
| L7 | Native metrics polling always 1s | `VoiceDock.tsx` — constant IPC overhead during screen share |

---

## 6. Performance Notes

### Audio Contexts
The system creates up to 3 AudioContexts simultaneously (mic level monitoring, remote playback, mic processing). Browsers limit to ~10 contexts, so this is safe but could be consolidated.

### Voice Activity Detection
Running at 60fps via RAF is wasteful. Voice detection at 20fps (50ms interval) would be indistinguishable to users and reduce CPU usage by ~66%.

### Native Screen Capture Polling
1-second interval polling from Rust backend for metrics runs constantly during screen sharing. Could debounce to 2-3 seconds.

### Remote Audio Elements
`remoteAudioElements` map keeps references to all audio elements. Elements are disconnected on cleanup but not removed from DOM in all paths.

---

## 7. Security Considerations

| Area | Status | Notes |
|------|--------|-------|
| Rate limiting | Good | 80 events/5s per connection, 32KB payload limit |
| Payload validation | Good | Field length constraints on all signaling inputs |
| Codec negotiation | Adequate | Server validates against supported codec set |
| Channel permissions | Missing | No ACL — any authenticated user can join any voice channel |
| Transport auth | Good | DTLS parameters exchanged per-connection |
| Error exposure | Minor | Internal mediasoup errors forwarded to client |

---

## 8. Recommended Priority Order

### Phase 1 — Stability (Critical)
1. Add timeout to `initializeMediaTransports()` RPC calls
2. Surface audio playback failures to UI (toast/notification)
3. Invalidate router cache when channel codec settings change
4. Add consumer cleanup when producer closes (server-side)
5. Add auto-reconnect when WebSocket recovers

### Phase 2 — Security & Robustness (High)
6. Implement channel permission checks for voice join
7. Fix TOCTOU race on camera/screen producer limits (use lock)
8. Add mediasoup worker health monitoring + auto-restart
9. Handle producer owner lookup failures gracefully
10. Add bitrate enforcement on consumers

### Phase 3 — Optimization (Medium)
11. Switch VAD from RAF to 50ms setInterval
12. Batch producer notifications on recv transport creation
13. Add signaling retry with exponential backoff
14. Fix voice activity self-broadcast (exclude sender)
15. Make VAD hold duration configurable (default 300ms)
16. Consider voice membership DB persistence for crash recovery

### Phase 4 — Polish (Low)
17. Extract magic numbers to named constants
18. Consolidate volume clamping utility
19. Add video tile pagination for large groups
20. Debounce native capture metrics polling

---

*Report generated: 2026-02-23*
*Scope: client/src/api/media/*, client/src/stores/voice.ts, client/src/components/, client/src-tauri/, server/src/media/*, server/src/ws/*
