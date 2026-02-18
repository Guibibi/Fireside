# Yankcord Development Plan

## Vision

Yankcord is a self-hosted, minimal chat app. One server instance = one community. The server operator sets a server password in config. Clients install the app, point it at the server URL/IP, enter password + username, and start chatting. No signup, no email, no multi-tenant server directory.

## Scope Rules

- Ship server and client together for each milestone (REST/WS + UI/state).
- Preserve existing protocol behavior unless a milestone explicitly changes it.
- Keep changes additive and migration-safe by default.
- Track human verification in `QA.md` (not in this plan).

---

## Active Roadmap

## Phase 4: Hardening

### 4.1 Operator/admin role boundaries

- Add explicit server-side role checks for privileged actions.
- Define role capability matrix for channel management, moderation, and future media/admin controls.
- Surface permission failures with stable error codes/messages for client handling.

### 4.2 Server management

- Add admin-only server settings.
- Add a UI page for management, overlaid on top of the chat and members list as a layout.

### 4.4 Stronger validation and payload safety

- Enforce stricter length/charset/shape validation at server boundaries.
- Cap payload sizes for text/JSON/media metadata and reject malformed payloads early.
- Keep schema/model validation and transport-layer validation aligned.

### 4.5 Moderation controls (kick/ban)

- Add operator/admin moderation actions with audit-friendly event trails.
- Enforce kick/ban checks on REST and WS auth/session paths.
- Add client UX for moderation feedback and forced-session cleanup handling.


## Phase 5: Polish and Extended Features

### 5.1 Message improvements

- **Lazy loading messages**: Scroll to bottom on channel open, fetch only the first ~20 messages, and lazy-load older messages on scroll-up.
- **Merge consecutive messages**: If a user sends multiple messages back-to-back without another user in between, group them into one visual block (like Discord).

### 5.2 Channel management

- **Edit channel options**: Allow changing channel name and description. Allow changing bitrate for voice channels.

### 5.3 Voice and media enhancements

- **Voice mute icons**: Show speaker-muted and microphone-muted icons for users in voice chat.
- **VAD sensitivity controls**: Expose voice activity detection sensitivity in audio settings with presets (low/medium/high) and fine-grained slider.
- **Network quality indicator**: Display real-time connection quality metrics in voice UI (packet loss, jitter, latency) with visual bars/colors and detailed stats tooltip.
- **Add audio to streaming**: Capture and send audio when streaming a window.

### 5.4 Notifications

- **Native desktop notifications**: Integrate with the OS notification system for message alerts, mentions, and calls. Include notification preferences (sounds, badges, quiet hours). Deep link notifications to the relevant channel or conversation. Use tauri plugin if possible

### 5.5 Deep Link

- **Deep Linking**: Implement deep linking using the tauri plugin to specific channels, messages, and users within the app. Ensure that deep links work correctly across different platforms and devices.
- Implement deep linking for invites too

### 5.6 Client and deployment improvements

- **Web instance auto-configuration**: When running the web version (non-Tauri), default the instance address to the current website origin and skip the server address input. Tauri users should still be prompted to select their instance.
- **Auto-updater**: Add auto-updater for the Tauri build using the Tauri updater plugin.
- Changelog: Add an changelog module for the auto-updater to display what's new.
- **Allow JPG for avatar upload**: Support JPG in addition to existing image formats for avatar uploads.


---

## Validation Baseline

Run these for relevant milestones:

- Backend: `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
- Backend: `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
- Backend: `cargo test --manifest-path server/Cargo.toml`
- Frontend: `npm --prefix client run typecheck`
- Frontend: `npm --prefix client run build`
