# Yankcord Execution Plan (Current Phase)

`PLAN-EXECUTION.md` is a living implementation document for the active phase only.
Long-term roadmap and completed milestone tracking live in `PLAN.md`.

## Active Phase

- Phase 5.9: Streaming watch UX rework

## Phase Goal

- Add custom emoji management and `:shortcode:` usage in messages without breaking existing message transport behavior.
- These emojis should be available server wide.

## Scope

- Backend
  - Add emoji asset CRUD endpoints with shortcode uniqueness checks.
  - Enforce emoji upload constraints (`png|webp|gif`, max `512 KB`, bounded dimensions).
  - Persist emoji metadata and ownership for instance-scoped emoji sets.
  - Resize emoji when uploaded to an appropriate size for display.
- Client
  - Show `LIVE` affordances for active screen streamers in the voice participant list.
  - Add hover/focus discovery popover with streamer context and a primary `Watch Stream` action.
  - Add viewer state model: `Not watching`, `Watching (focused)`, `Watching (mini-player)`.
  - Add focused watch mode with `Fullscreen` and `X` controls.
  - Add mini-player mode with `Stop Watching Stream` and stream-ended cleanup feedback.
  - Preserve watch state behavior across text channel switches and panel visibility changes.
- Protocol/Server
  - Keep existing media signaling and WS transport contracts unchanged for this phase.

## Ordered Checklist

- [x] Add voice participant `LIVE` badge for active screen streamers.
- [x] Add hover/focus streamer popover with `Watch Stream` CTA.
- [x] Add focused watch surface that replaces chat content while active.
- [x] Add focused controls: `Fullscreen` and close (`X`) with keyboard reachability.
- [x] Add mini-player dock with `Stop Watching Stream` control.
- [x] Auto-exit watch modes on stream end/disconnect and show `Stream ended` feedback.
- [x] Run frontend validation commands and capture blockers.

## Touch Points

- `client/src/components/ChannelList.tsx`
- `client/src/components/MessageArea.tsx`
- `client/src/components/StreamWatchOverlay.tsx`
- `client/src/components/VideoStage.tsx`
- `client/src/pages/Chat.tsx`
- `client/src/stores/voice.ts`
- `client/src/styles/channel-list.css`
- `client/src/styles/messages.css`
- `client/src/styles/stream-watch.css`
- `client/src/styles/global.css`

## Validation Commands

- Frontend
  - `npm --prefix client run typecheck`
  - `npm --prefix client run build`

## Last Completed Phase

- Phase 5.8: GIF search support

## Completion Snapshot (In Progress)

- Introduced explicit stream watch state machine in client voice store (`none`/`focused`/`mini`).
- Added voice-member `LIVE` detection and watch-entry affordances in channel participant UI.
- Added focused stream player with keyboard reachable `Fullscreen` and close controls.
- Added docked mini-player with explicit `Stop Watching Stream` behavior.
- Added automatic watcher teardown when stream producer ends, with `Stream ended` status feedback.

## Next Step After Phase 5.9

- Phase 4.1: Operator/admin role boundaries
