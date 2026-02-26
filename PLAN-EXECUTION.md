# Yankcord Execution Plan (Current Phase)

`PLAN-EXECUTION.md` is a living implementation document for the active phase only.
Long-term roadmap and completed milestone tracking live in `PLAN.md`.

## Active Phase

- Phase 5.2: Persistent channel unread state
- Focused track: Windows native screen share rewrite (`zed-scap` + `playa-ffmpeg`, H264-first)

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

---

## Focused Plan: Windows Native Screen Share Rewrite (Scorched Earth, H264-First)

### Goal

- Replace the current Windows native screen-share implementation end-to-end with a new pipeline based on `zed-scap` capture and `playa-ffmpeg` encoding.
- Keep native sender codec support locked to `video/H264` for this phase.
- Keep a clean scaffold for future codec expansion (`VP8`, `VP9`, `AV1`) without enabling them yet.
- Preserve existing user-facing flow (native source picker -> start -> LIVE -> stop) while replacing internals.

### Scope (Locked)

- Windows only for this rewrite.
- Linux/macOS native capture work is explicitly deferred.
- No broad media transport redesign in this phase (keep current native RTP ingest model).

### Non-Goals

- No VP8/VP9/AV1 production enablement in this phase.
- No browser screen-share redesign.
- No server-wide mediasoup codec matrix changes outside native sender compatibility/scaffold work.

### Product Decisions Locked

- Native sender negotiated codec is H264 only for now (`video/H264`, packetization-mode `1`, baseline profile).
- Native command surface remains stable:
  - `list_native_capture_sources`
  - `native_codec_capabilities`
  - `start_native_capture`
  - `stop_native_capture`
  - `native_capture_status`
- Existing signaling shape for native sender session remains backward compatible (`rtp_target`, `payload_type`, `ssrc`, codec metadata fields).
- Windows source listing should continue to expose screen/window/application-compatible ids where feasible, even if implementation maps application to a concrete window target internally.

### Architecture Direction

#### A. Capture subsystem (`zed-scap`)

- Introduce a dedicated Windows capture adapter module that wraps `zed-scap` target enumeration and frame pumping.
- Normalize `zed-scap` target/frame structures into Yankcord-native structures used by service/runtime.
- Standardize source id parsing and mapping:
  - `screen:*` -> display target
  - `window:*` -> window target
  - `application:*` -> compatibility mapping to selected window target
- Keep frame output normalized to one internal format contract (`bgra8` bytes + width/height + timestamp) before encoder handoff.

#### B. Encoder subsystem (`playa-ffmpeg`)

- Replace subprocess/x264 and direct NVENC SDK codepaths with one in-process FFmpeg backend.
- Implement H264 encoder selection policy inside the backend (Windows):
  1. `h264_nvenc` (if available)
  2. `h264_qsv` or `h264_amf` (if available)
  3. `libx264` fallback
- Ensure produced bitstream is Annex B and fed through existing H264 RTP packetizer path.
- Preserve low-latency settings and keyframe request support (RTCP PLI/FIR -> next-frame keyframe).

#### C. Codec scaffold (future-proofing)

- Introduce explicit native codec catalog model with readiness states (`ready` vs `planned`).
- Keep runtime selection hard-gated to H264 for this phase.
- Add codec-factory extension points so future codecs can register:
  - codec descriptor
  - encoder builder
  - RTP packetizer builder
- For non-H264 requests, fail deterministically with clear diagnostics instead of silent fallback.

#### D. Sender/runtime service

- Keep one bounded frame queue between capture and sender worker.
- Preserve existing metrics surface consumed by frontend diagnostics (worker active, queue pressure, encode/send errors, backend label).
- Remove old DXGI/cuda-specific lifecycle assumptions and replace with backend-agnostic worker lifecycle.
- Keep stop/start idempotent and panic-safe.

#### E. Server/native signaling compatibility

- Keep current `create_native_sender_session` flow and payload stable.
- Keep server `native_codec` representation H264-ready; add optional planned-codec scaffold fields only if backward compatible.
- Do not change first-message auth or general WS contract behavior.

### Iteration Plan (Detailed)

1. Freeze contracts and capture all existing command/signaling payload shapes as compatibility targets.
2. Add new capture adapter around `zed-scap` (Windows only), including target normalization and source id mapping.
3. Build new in-process H264 encoder backend using `playa-ffmpeg`.
4. Wire sender worker to new backend, preserving RTP packetization/send path and feedback loop.
5. Add codec scaffold primitives (catalog, readiness, factory hooks) while keeping H264-only gate active.
6. Replace/remove legacy modules (DXGI, Windows Graphics Capture adapter for active streaming, subprocess x264, NVENC SDK backend).
7. Update build/release wiring to remove obsolete FFmpeg binary bundling assumptions.
8. Keep frontend API stable; update only diagnostics labels/fields if needed.
9. Run validation matrix and complete manual QA backlog in `QA.md`.

### Ordered Checklist

#### WIN.REWRITE.A Contract freeze and compatibility envelope

- [ ] Record current Tauri command request/response contracts from `client/src/api/nativeCapture.ts`
- [ ] Record native sender signaling payload shape from `client/src/api/media/types.ts` and `server/src/ws/media_signal.rs`
- [ ] Lock H264-only negotiation behavior and define explicit error for unsupported codec requests
- [ ] Confirm no WS discriminator drift (`server/src/ws/messages.rs` <-> `client/src/api/ws.ts`)

#### WIN.REWRITE.B Dependencies and build system

- [ ] Update `client/src-tauri/Cargo.toml` to add `zed-scap` and `playa-ffmpeg` (Windows target scope)
- [ ] Remove obsolete encoder/capture deps tied to legacy implementation where no longer used
- [ ] Remove/adjust `native-nvenc` feature semantics if it no longer reflects runtime behavior
- [ ] Update `client/src-tauri/build.rs` to remove hard requirement for bundled `ffmpeg.exe`
- [ ] Update `client/src-tauri/tauri.conf.json` resources only if no longer needed for legacy binary bundling
- [ ] Update `.github/workflows/tauri-release.yml` Windows job assumptions (no CUDA/NVCodec SDK precheck unless still needed)

#### WIN.REWRITE.C New Windows capture adapter (`zed-scap`)

- [ ] Add capture adapter module under `client/src-tauri/src/capture/` for `zed-scap` target/frame integration
- [ ] Implement `list_sources` conversion to existing `NativeCaptureSource` shape
- [ ] Implement source id parsing and deterministic target selection
- [ ] Implement capture loop start/stop lifecycle with bounded frame dispatch
- [ ] Normalize incoming frame variants to internal `bgra8` payload contract
- [ ] Add robust error mapping for permission denied, target lost, and unsupported states

#### WIN.REWRITE.D New H264 encoder backend (`playa-ffmpeg`)

- [ ] Add new encoder backend module replacing `x264_encoder.rs` + `nvenc_sdk.rs`
- [ ] Implement encoder probing and backend-selection diagnostics (selected vs requested)
- [ ] Implement H264 encode loop with Annex B output for packetizer consumption
- [ ] Implement keyframe request hook for RTCP feedback
- [ ] Implement width/height change handling (session reinit without panic)
- [ ] Implement deterministic fallback order and explicit failure reason propagation

#### WIN.REWRITE.E Codec scaffold for future expansion

- [ ] Add codec catalog abstraction with readiness statuses (`ready`, `planned`)
- [ ] Keep `video/H264` as only `ready` codec in runtime gate
- [ ] Add factory interfaces for future codec-specific encoder/packetizer registration
- [ ] Ensure unsupported codec path emits structured diagnostic reason
- [ ] Keep server/client codec metadata fields additive and backward compatible

#### WIN.REWRITE.F Native sender worker and RTP integration

- [ ] Rewire `native_sender` worker to new capture frame envelope and encoder backend
- [ ] Keep existing H264 RTP packetizer behavior and MTU fragmentation path
- [ ] Keep RTCP feedback polling and keyframe request path active
- [ ] Preserve queue pressure/degradation/fallback metric fields consumed by frontend
- [ ] Ensure worker shutdown is graceful on capture stop, queue disconnect, or encoder failure

#### WIN.REWRITE.G Service command surface and status model

- [ ] Keep command handlers in `client/src-tauri/src/capture/service.rs` signature-compatible
- [ ] Keep `NativeCaptureStatus` payload shape compatible for frontend callers
- [ ] Keep `native_codec_capabilities` command returning H264-ready data (plus optional planned entries)
- [ ] Keep start idempotency semantics for same source/options + active worker
- [ ] Keep stop idempotency semantics with best-effort cleanup

#### WIN.REWRITE.H Frontend integration safeguards

- [ ] Verify no required API callsite changes in `client/src/api/media/native.ts`
- [ ] Keep native session negotiation path stable in `client/src/api/media/producers.ts`
- [ ] Keep diagnostics parsing compatible (backend labels and fallback reason fields)
- [ ] Keep source picker UX compatible in `client/src/components/channel-list/hooks/useScreenShareModal.ts`

#### WIN.REWRITE.I Legacy cleanup (scorched-earth completion)

- [ ] Remove legacy active-stream capture modules and thread wiring replaced by new adapter
- [ ] Remove legacy encoder backend modules superseded by new FFmpeg backend
- [ ] Remove dead env vars/config references tied only to removed modules
- [ ] Update docs that mention removed paths (`docs/zero-copy-nvenc.md`, `client/src-tauri/bin/README.md`, related notes)

#### WIN.REWRITE.J Validation

- [ ] `cargo fmt --all --manifest-path client/src-tauri/Cargo.toml -- --check`
- [ ] `cargo clippy --manifest-path client/src-tauri/Cargo.toml --all-targets -- -D warnings`
- [ ] `cargo test --manifest-path client/src-tauri/Cargo.toml`
- [ ] `npm --prefix client run typecheck`
- [ ] `npm --prefix client run build`

#### WIN.REWRITE.K Manual QA linkage

- [ ] Execute Windows-native rewrite checklist from `QA.md`
- [ ] Capture logs for at least one hardware-accelerated run and one software-fallback run
- [ ] Validate remote viewer playback quality/stability on start, stop, and repeated sessions

### Touch Points (Expected)

- `client/src-tauri/Cargo.toml`
- `client/src-tauri/build.rs`
- `client/src-tauri/tauri.conf.json`
- `client/src-tauri/src/capture/mod.rs`
- `client/src-tauri/src/capture/service.rs`
- `client/src-tauri/src/capture/service/encoder_backend.rs`
- `client/src-tauri/src/capture/service/native_sender.rs`
- `client/src-tauri/src/capture/service/rtp_packetizer.rs`
- `client/src-tauri/src/capture/service/rtp_sender.rs`
- `client/src-tauri/src/capture/service/metrics.rs`
- `client/src-tauri/src/capture/windows_capture.rs` (replace/remove active-stream responsibilities)
- `client/src-tauri/src/lib.rs`
- `client/src/api/nativeCapture.ts` (only for additive status/capability fields)
- `client/src/api/media/native.ts` (only if diagnostics fields change)
- `client/src/api/media/producers.ts` (only if codec metadata handling needs additive adjustments)
- `server/src/media/native_codec.rs` (only additive codec scaffold alignment)
- `server/src/media/transport.rs` (only if additive scaffold wiring needed)
- `server/src/ws/media_signal.rs` (only if additive payload fields required)
- `docs/zero-copy-nvenc.md`
- `client/src-tauri/bin/README.md`
- `.github/workflows/tauri-release.yml`

### Risks and Mitigations

- Capture permission/target edge cases in `zed-scap` -> keep clear error mapping and retry boundaries.
- Hardware encoder availability varies by host -> enforce deterministic fallback to software and expose reason in metrics.
- Bitstream/packetization mismatch risk -> keep strict Annex B validation before RTP send and fail fast with diagnostics.
- Contract drift risk during rewrite -> preserve command names/payload shapes and run WS/Tauri bridge sync checks.
- Build pipeline drift -> update release workflow and docs in same change set.

### Exit Criteria

- Windows native screen share runs on new `zed-scap` + `playa-ffmpeg` pipeline with no legacy active-stream modules in use.
- Native sender negotiates and publishes H264 successfully end-to-end.
- Runtime fallback from hardware to software encode is observable and stable.
- Tauri/frontend command and signaling contracts remain compatible.
- Manual QA checklist in `QA.md` is completed for this track.
