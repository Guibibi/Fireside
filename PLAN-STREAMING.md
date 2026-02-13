# Streaming UX + Quality Plan

## Session Handoff (Current Status)

- Current position: inside Phase 9 (Windows-capture crate implementation track).
- Completed in this session:
  - Tauri pre-share modal with source + quality controls.
  - Persisted screen-share preferences (resolution/fps/bitrate/source kind).
  - Producer encoding hints for bitrate/fps and content hint tuning.
  - Tauri native source listing command + frontend bridge.
  - Web fallback path preserved (browser-native sharing flow).
  - Tauri native capture service scaffolding (`start_native_capture` / `stop_native_capture` / `native_capture_status`).
  - Windows-gated capture adapter module and typed frontend bridge methods.
  - Screen-share flow now attempts native-capture arm/disarm on Tauri, with automatic fallback to browser capture.
  - Validation passed: `npm --prefix client run typecheck`, `npm --prefix client run build`, `cargo check --manifest-path client/src-tauri/Cargo.toml`.
- Important limitation right now:
  - Final capture still goes through `getDisplayMedia` (OS/WebRTC permission/picker still involved).
- Next implementation target:
  - Phase 9.5: bridge native frame events into a real Rust-side encoder/RTP sender path (current start/stop commands are lifecycle scaffolding only).

## Goal

- Add a desktop-native source picker in Tauri for screen sharing.
- Add user controls for resolution (`720p`, `1080p`, `1440p`, `4k`), fps, and bitrate.
- Keep web behavior on browser-native `getDisplayMedia` picker with no custom quality controls.
- Preserve existing mediasoup signaling and protocol stability.

## Platform Strategy

- `Tauri`:
  - Use native source enumeration/selection (screens, windows/apps).
  - Show custom pre-share modal with source + quality settings.
  - Capture selected source and produce with chosen encoding constraints.
- `Web`:
  - Keep current one-click `getDisplayMedia` flow.
  - No custom source list or bitrate/resolution/fps UI.

## Phase 1: Native Capture Foundation (Tauri)

- Add required Tauri-side dependency/plugin for native capture-source enumeration.
- Implement Rust commands to:
  - list available share targets (display/window/app metadata)
  - start capture for selected target
  - stop/release capture resources
- Register commands in `client/src-tauri/src/lib.rs` and expose typed TS bridge APIs.
- Ensure Windows support first, then Linux/macOS with the same abstraction.

## Phase 2: Client Platform Split + Source Model

- Add runtime platform detection helper (`isTauriRuntime`).
- Create a unified source model in client code:
  - `screen`, `window`, `application` source kinds
  - stable id, title, optional thumbnail/icon metadata
- Route screen-share start flow:
  - Tauri path -> native source picker + selected-source capture
  - Web path -> existing browser picker path

## Phase 3: Tauri Share Modal UX

- Add a dedicated modal component in client UI with:
  - source list (display/window/app)
  - resolution selector (`720p`, `1080p`, `1440p`, `4k`)
  - fps selector (initial: `30`, `60`)
  - bitrate selector (`Auto`, plus manual presets)
- Persist chosen quality settings in local settings store.
- Launch modal from screen-share button when in Tauri.
- Keep existing compact voice dock behavior when actively sharing.

## Phase 4: Quality/Encoding Pipeline

- Extend screen-share start API to accept selected quality profile.
- Apply capture constraints on Tauri path (and where possible on tracks):
  - width/height targets by resolution
  - frame-rate target by fps selection
- Apply producer RTP encoding hints:
  - `encodings[0].maxBitrate`
  - `encodings[0].maxFramerate`
  - optional codec start bitrate hint for faster ramp
- Set `track.contentHint` based on profile (`motion` for game-focused presets).

## Phase 5: Bitrate Policy

- Add `Auto` bitrate mapping by resolution/fps:
  - `720p`: 4500 kbps @30, 6000 kbps @60
  - `1080p`: 8000 kbps @30, 12000 kbps @60
  - `1440p`: 12000 kbps @30, 18000 kbps @60
  - `4k`: 20000 kbps @30, 30000 kbps @60
- Add manual presets (initial):
  - `Balanced`, `High`, `Ultra`
- Keep mapping centralized in one helper for easy tuning.

## Phase 6: Error Handling + Fallbacks

- If native source enumeration fails, show user-facing error and keep web flow unaffected.
- If selected source disappears, stop sharing cleanly and show actionable error text.
- Keep share start/stop idempotent to avoid stale producer/track states.
- If quality constraints are unsupported by runtime, gracefully fall back to defaults.

## Phase 7: Validation

Client:

- `npm --prefix client run typecheck`
- `npm --prefix client run build`

Tauri:

- `cargo check --manifest-path client/src-tauri/Cargo.toml`

Server impact:

- No protocol/schema changes expected.
- Optional sanity run if touched indirectly: `cargo test --manifest-path server/Cargo.toml`.

## Phase 8: True Native Source Binding (No Browser Picker)

Goal: remove dependency on `getDisplayMedia` for Tauri desktop path and capture exactly the source selected in the native picker.

### Target Architecture

- `Tauri frontend`:
  - user picks exact native source id from modal
  - sends `{ source_id, resolution, fps, bitrate }` to Rust command
- `Rust capture service`:
  - starts desktop capture for exact source id
  - outputs raw frames in a stable pixel format (`BGRA`/`NV12`)
  - provides stop/pause lifecycle and source-lost events
- `Rust WebRTC sender` (desktop path only):
  - consumes raw frames from capture service
  - encodes and sends RTP with desired bitrate/fps settings
  - negotiates with server-compatible RTP parameters
- `Server`:
  - unchanged signaling surface where possible
  - may require optional native-client signaling branch if mediasoup-client is bypassed

### Integration Strategy

- Keep two Tauri paths during migration:
  1) `webview-capture` (current, `getDisplayMedia`) as fallback
  2) `native-capture` (new) behind feature flag/env toggle
- Start with Windows implementation first, then Linux/macOS.
- Add runtime health checks and fallback to current path on capture/encoder failure.

### Protocol/Signaling Decision

- Option A (recommended for faster ship):
  - keep mediasoup signaling semantics
  - add a thin Rust signaling client that performs `media_produce` / transport connect steps
- Option B:
  - introduce new server endpoints dedicated to native desktop publishers
  - larger change, but cleaner long-term separation

### Rust Library Candidates

- Capture:
  - `xcap` (cross-platform capture APIs; good for enumeration/capture primitives, but not a full WebRTC sender)
  - `windows` crate + Windows Graphics Capture APIs (Windows-specific, robust for window/display capture)
  - `pipewire` / portal-based crates on Linux for Wayland-friendly capture
  - macOS `ScreenCaptureKit` via `objc2`/Apple bindings
- WebRTC/RTP:
  - `webrtc` (webrtc-rs): full Rust WebRTC stack (DTLS/SRTP/ICE/RTP)
  - lower-level RTP libs are possible but increase integration complexity
- Encoding acceleration:
  - `ffmpeg-next` (broad codec/hardware support, heavier dependency)
  - platform APIs (NVENC/AMF/VAAPI/VideoToolbox) for performance-focused path

### Recommended Stack (Pragmatic)

- Windows-first MVP:
  - capture: Windows Graphics Capture (WinRT) via `windows` crate
  - sender: `webrtc` crate for RTP publishing
  - encoding: H264 first for compatibility/performance, then VP9/AV1 where stable
- Linux/macOS follow-up:
  - Linux capture: PipeWire portal path (Wayland-compatible), with X11 fallback
  - macOS capture: ScreenCaptureKit + VideoToolbox path

### Milestones

- M1: native capture service with exact source binding + frame test harness.
- M2: Rust WebRTC sender publishes test stream to server in dev channel.
- M3: Wire quality controls (resolution/fps/bitrate) into native sender.
- M4: Add auto-reconnect/source-lost recovery + fallback to current path.
- M5: Roll out behind feature flag, collect telemetry/logs, then default-on.

## Phase 9: Windows-Capture Crate Implementation Plan

Goal: implement the Windows-first native pipeline using `windows-capture` as the capture backend.

### Scope

- Use `windows-capture` for display/window/app frame capture on Windows.
- Keep existing `getDisplayMedia` path as fallback behind a runtime toggle.
- Do not change server wire protocol in first pass.

### Workstreams

#### 9.1 Rust Capture Adapter (`client/src-tauri/src/capture/windows_capture.rs`)

- Add a thin adapter around `windows-capture` APIs to:
  - enumerate capture targets with stable IDs
  - start capture for one selected target
  - stop/restart capture safely
- Normalize frame output to one internal format (`BGRA` first).
- Emit structured events for:
  - `started`
  - `frame`
  - `source_lost`
  - `stopped`
  - `error`

#### 9.2 Capture Service + Lifecycle (`client/src-tauri/src/capture/service.rs`)

- Introduce a single-owner capture service (one active screen share per app session).
- Add command handlers:
  - `list_native_capture_sources`
  - `start_native_capture`
  - `stop_native_capture`
  - `native_capture_status`
- Enforce idempotency and race safety for rapid start/stop clicks.

#### 9.3 Tauri Command Surface (`client/src-tauri/src/lib.rs`)

- Register new commands and keep the API typed/stable.
- Return user-facing errors with actionable messages.
- Gate Windows-only commands with `cfg(target_os = "windows")`; return clear unsupported errors on other platforms.

#### 9.4 Frontend Integration (`client/src/api/nativeCapture.ts`, `client/src/components/ChannelList.tsx`)

- Extend source model to carry exact Windows capture target metadata.
- Start flow:
  1) user chooses source + quality in modal
  2) frontend calls `start_native_capture`
  3) if successful, transition producer path to native frames pipeline
- Keep fallback path to webview capture if native start fails.

#### 9.5 Encoding + RTP Bridge

- MVP encoding profile:
  - codec: H264
  - fps: 30/60
  - bitrate: use existing auto/manual mapping
- Bridge captured frames into WebRTC sender pipeline (Rust-side).
- Keep observability logs for frame rate, encode latency, and bitrate ramp.

### Risks and Mitigations

- API churn in `windows-capture`:
  - pin crate version and wrap usage in a small adapter layer.
- Permission/capture failure edge cases:
  - clear UI error + automatic fallback to current browser-based share.
- High CPU/GPU load with 1440p/4k60:
  - cap defaults per tier and add dynamic downgrade policy.

### Acceptance Criteria

- Windows users can select a native source and start share without relying on browser source picker.
- Resolution/fps/bitrate settings are applied to native sender path.
- Source-loss and stop/restart flows are stable.
- Existing web and non-Windows desktop flows remain functional.

### Validation (Windows-Focused)

- `cargo check --manifest-path client/src-tauri/Cargo.toml`
- `npm --prefix client run typecheck`
- `npm --prefix client run build`
- Manual run on Windows:
  - source list loads
  - 1080p60 starts within expected delay
  - stop/start loop works repeatedly

## File Touch Map

- `client/src/components/ChannelList.tsx` (screen-share trigger + modal integration)
- `client/src/components/` (new screen-share modal component)
- `client/src/api/media.ts` (screen-share start options + encoding application)
- `client/src/stores/settings.ts` (persisted streaming preferences)
- `client/src/styles/global.css` (modal and control styling)
- `client/src-tauri/Cargo.toml` (native capture dependency/plugin)
- `client/src-tauri/src/lib.rs` (command registration)
- `client/src-tauri/src/*` (new capture command/module implementation)

## Checklist

- [x] Add native source enumeration/capture support in Tauri backend.
- [x] Add typed client bridge for native capture APIs.
- [ ] Add runtime platform split (Tauri vs Web).
- [ ] Build Tauri source picker modal with quality controls.
- [ ] Persist resolution/fps/bitrate preferences.
- [ ] Apply selected encoding constraints to screen-share producer.
- [ ] Keep web flow on browser picker with no custom quality UI.
- [ ] Add robust fallback and error handling.
- [ ] Run client typecheck/build and Tauri cargo check.
