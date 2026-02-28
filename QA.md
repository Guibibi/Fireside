# QA — Manual Verification Backlog

## Screen Sharing v2 (Native MVP)

**Branch**: `chore/streaming-exploration`
**Requires**: Windows desktop with Tauri build (`npm run tauri:build` or `tauri:dev`)

### Prerequisites

1. Server running with a voice channel active
2. Two clients: one on Windows Tauri desktop, one on any browser
3. Both clients joined to the same voice channel

### 10.1 — End-to-End Screen Share

1. On the Windows desktop client, click the screen share button in the voice dock
2. Select a monitor or window in the modal and click "Start Sharing"
3. **Verify** (server logs): `new_producer` event with `source: "screen"` is broadcast
4. **Verify** (browser client): VideoStage switches to spotlight layout showing the shared screen
5. **Verify** (browser client): Screen tile label shows the sharer's username

### 10.2 — Stop/Restart Cycle

1. Start a screen share (as above)
2. Click the screen share button again to stop sharing
3. **Verify**: VideoStage on remote clients reverts to camera grid
4. **Verify**: Desktop client dock button returns to inactive state
5. Start a new screen share (same session, no app restart)
6. **Verify**: New share appears on remote clients without error

### 10.3 — Source-Lost Recovery

1. Start screen sharing a specific **window** (not a monitor)
2. Close the captured window while the share is active
3. **Verify**: Desktop client transitions to `failed` or `stopped` state
4. **Verify**: Error message appears near the screen share button
5. **Verify**: Remote clients' VideoStage reverts to camera grid (no frozen frame)
6. **Verify**: A new screen share can be started without issues after the failure

### 10.4 — Disconnect Recovery

1. Start a screen share from the desktop client
2. Leave the voice channel (click disconnect) while screen share is active
3. **Verify**: Capture pipeline stops (no orphaned capture threads)
4. **Verify**: Server cleans up the PlainTransport and producer
5. **Verify**: Remote clients see the screen tile removed
6. **Verify**: Rejoining the voice channel and starting a new share works cleanly

### 10.5 — Full Validation Matrix (Automated)

Run before shipping:

```bash
# Server
cargo fmt --all --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path server/Cargo.toml

# Client
npm --prefix client run typecheck
npm --prefix client run build

# Tauri host (Linux cross-check)
cargo check --manifest-path client/src-tauri/Cargo.toml

# Tauri host (Windows full build — requires Windows)
cargo build --manifest-path client/src-tauri/Cargo.toml
cargo test --manifest-path client/src-tauri/Cargo.toml
```
