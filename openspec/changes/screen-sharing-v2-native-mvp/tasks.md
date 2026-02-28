## 1. Server Contracts — Screen Source + PlainTransport

- [x] 1.1 Add `Screen` variant to `ProducerSource` enum in `server/src/media/transport.rs` and update any match arms
- [x] 1.2 Add `"screen"` to allowed source values in `server/src/ws/media_signal.rs` validation logic
- [x] 1.3 Enforce one-screen-producer-per-connection rule in server media produce handler (reject duplicate screen producers)
- [x] 1.4 Enforce screen source is video-only (reject `kind: "audio"` with `source: "screen"`)
- [x] 1.5 Implement `create_plain_transport` signaling action — create PlainTransport on channel router, store in connection media state, return `{ id, ip, port, rtcp_port }`
- [x] 1.6 Implement `connect_plain_transport` signaling action — connect PlainTransport to client's RTP sending address
- [x] 1.7 Support `MediaProduce` on PlainTransport (produce with screen source on a PlainTransport instead of WebRTC transport)
- [x] 1.8 Ensure `new_producer` broadcast includes `source: "screen"` in payload
- [x] 1.9 Clean up PlainTransport on producer close, disconnect, and voice channel leave
- [x] 1.10 Verify server compiles: `cargo fmt`, `cargo clippy`, `cargo test` pass

## 2. Client Types + Signaling Extensions

- [x] 2.1 Add `"screen"` to `MediaSource` union type in `client/src/api/media/types.ts`
- [x] 2.2 Update `RemoteVideoTile` interface to accept `source: "screen" | "camera"` in `client/src/api/media/types.ts`
- [x] 2.3 Add signaling request types for `create_plain_transport` and `connect_plain_transport` in `client/src/api/media/signaling.ts`
- [x] 2.4 Add signaling response types for PlainTransport creation (id, ip, port, rtcp_port)
- [x] 2.5 Implement `createPlainTransport()` and `connectPlainTransport()` signaling functions
- [x] 2.6 Verify client compiles: `npm run typecheck` and `npm run build` pass

## 3. Tauri Command Bridge — capture_v2 Namespace

- [x] 3.1 Create `client/src-tauri/src/capture_v2/mod.rs` module with command stubs and typed request/response models
- [x] 3.2 Define `CaptureSource` enum (Monitor/Window variants with metadata), `CaptureState` enum (Starting, Running, Degraded, Stopping, Stopped, Failed), and `CaptureError` type
- [x] 3.3 Implement `enumerate_sources` Tauri command — returns `{ monitors: [...], windows: [...] }` using `windows-capture` enumeration
- [x] 3.4 Implement `start_capture` command stub — accepts source identifier + server PlainTransport address, returns initial state
- [x] 3.5 Implement `stop_capture` command stub — stops active session, returns final state
- [x] 3.6 Implement `get_capture_state` command — returns current lifecycle state and error details
- [x] 3.7 Register capture_v2 commands in `client/src-tauri/src/lib.rs`
- [x] 3.8 Add TS bridge functions in `client/src/api/media/nativeBridge.ts` for invoking capture_v2 Tauri commands with typed responses
- [x] 3.9 Verify Tauri host compiles: `cargo build` and `cargo test` pass for `client/src-tauri`

## 4. Capture Pipeline — Frame Acquisition

- [x] 4.1 Add Cargo dependencies: `windows-capture`, `ring-channel` to `client/src-tauri/Cargo.toml` (Windows-only)
- [x] 4.2 Create `capture_v2/capture_loop.rs` — implement `windows-capture` `GraphicsCaptureApiHandler` trait, deliver BGRA frames to a `ring_channel` sender
- [x] 4.3 Implement capture start/stop lifecycle — spawn capture thread, handle source-lost callback, join on stop
- [x] 4.4 Wire `start_capture` command to spawn the capture loop with the selected source

## 5. Capture Pipeline — Encode Stage

- [x] 5.1 Add Cargo dependencies: `openh264`, `dcv-color-primitives` to `client/src-tauri/Cargo.toml`
- [x] 5.2 Create `capture_v2/encoder.rs` — initialize OpenH264 encoder with target bitrate (default 4 Mbps), baseline profile, no B-frames
- [x] 5.3 Implement encode thread — recv from ring_channel, BGRA→I420 via dcv-color-primitives, encode to H264 NALUs, send to output channel
- [x] 5.4 Pre-allocate I420 plane buffers (reuse across frames, no per-frame allocation)
- [x] 5.5 Implement keyframe-on-demand support (signal from outside the encode thread to force IDR on next frame)

## 6. Capture Pipeline — RTP Send Stage

- [x] 6.1 Create `capture_v2/rtp_packetizer.rs` — parse H264 NAL units, implement Single NAL and FU-A packetization per RFC 6184, MTU 1200 bytes
- [x] 6.2 Implement RTP header construction — sequence number, timestamp (90kHz clock), SSRC, marker bit on last packet of access unit
- [x] 6.3 Create `capture_v2/sender.rs` — UDP socket sender thread, recv encoded frames from bounded channel, packetize and send to server PlainTransport address
- [x] 6.4 Wire full pipeline: capture_loop → ring_channel → encoder → crossbeam bounded channel → sender

## 7. Pipeline Orchestration + Telemetry

- [x] 7.1 Create `capture_v2/session.rs` — orchestrate full pipeline lifecycle (spawn threads, manage state transitions, handle cleanup)
- [x] 7.2 Implement state machine transitions: Starting → Running, Running → Stopping → Stopped, any → Failed
- [x] 7.3 Emit Tauri events on state transitions (`capture-state-changed` event with new state + error details)
- [x] 7.4 Create `capture_v2/metrics.rs` — atomic counters for capture_fps, encode_fps, queue_depth, dropped_frames, send_errors
- [x] 7.5 Implement `get_capture_metrics` Tauri command returning current metrics snapshot
- [x] 7.6 Emit `capture-telemetry` Tauri event every 2 seconds during active capture
- [x] 7.7 Reset metrics on new session start, stop emitting on session end

## 8. Screen Share UI — Source Picker + Voice Dock

- [x] 8.1 Add screen share toggle button to voice dock (disabled when not in voice channel, toggled appearance when sharing)
- [x] 8.2 Create `ScreenShareModal.tsx` — modal with Monitors/Windows tabs, source list, "Start Sharing" button
- [x] 8.3 Wire modal open from voice dock button click (when not sharing); wire stop-sharing from button click (when sharing)
- [x] 8.4 Implement source enumeration call on modal open via native bridge
- [x] 8.5 Implement start-sharing flow: create PlainTransport → get address → invoke Tauri start_capture → produce on PlainTransport
- [x] 8.6 Implement stop-sharing flow: invoke Tauri stop_capture → close producer → close PlainTransport
- [x] 8.7 Display error toasts for capture pipeline failures (subscribe to capture-state-changed events)
- [x] 8.8 Handle "no sources available" and "not on Windows" states in modal

## 9. Screen Share UI — Remote Viewer

- [x] 9.1 Update consumer creation in `consumers.ts` to handle `source: "screen"` producers — create video consumer, attach to MediaStream
- [x] 9.2 Add screen tile tracking in media state (separate from camera tiles)
- [x] 9.3 Create overlay/spotlight layout in `VideoStage.tsx` — screen tile takes large area, camera tiles shrink to sidebar
- [x] 9.4 Implement layout switching: normal camera grid when no screen shares, spotlight when screen share active
- [x] 9.5 Handle screen producer closed — remove screen tile, return to camera grid layout
- [x] 9.6 Handle multiple simultaneous screen shares — spotlight most recent, add selector to switch
- [x] 9.7 Exclude local user's own screen share from their video stage

## 10. Integration + Validation

- [ ] 10.1 End-to-end test: start screen share → verify producer created on server → verify remote consumer receives stream
- [ ] 10.2 Test stop/restart cycle: start → stop → start again without process restart
- [ ] 10.3 Test source-lost recovery: close captured window during active share → verify clean error + state reset
- [ ] 10.4 Test disconnect recovery: leave voice channel during active share → verify clean cleanup
- [x] 10.5 Run full validation matrix: server fmt/clippy/test, client typecheck/build, Tauri build/test
