# Settings Implementation Plan

- [x] Add a server-side endpoint to update the current user (`PATCH /api/users/me`)
- [x] Validate and normalize username updates (trim, length 3-32, uniqueness checks)
- [x] Return refreshed auth payload (`token`, `username`) after username changes
- [x] Register the new users route in server routing setup
- [x] Add client auth-store helper to update token/username without changing server URL
- [x] Add sidebar user dock (avatar placeholder, username label, cog button)
- [x] Build settings modal open/close flow from the cog button
- [x] Add profile settings UI (username edit + save state/error handling)
- [x] Add avatar upload placeholder flow (local preview/filename only)
- [x] Add read-only server URL row in settings
- [x] Extend media helpers for audio device enumeration and switching
- [x] Add microphone and speaker device selectors in settings
- [x] Persist selected audio devices and avatar placeholder metadata in local storage
- [x] Add reset action for audio preferences
- [x] Reconnect websocket session after successful username update
- [x] Style user dock and settings modal for desktop/mobile breakpoints
- [x] Run server validation: fmt, clippy, tests
- [x] Run client validation: TypeScript check and production build
