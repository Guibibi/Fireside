# Yankcord Execution Plan (Current Phase)

`PLAN-EXECUTION.md` is a living implementation document for the active phase only.
Long-term roadmap and completed milestone tracking live in `PLAN.md`.

## Active Phase

- Phase 5.6: Custom emojis/icons
- Phase 5.7: Message reactions
- Phase 5.8: GIF search support

## Phase Goal

- Add custom emoji management and `:shortcode:` usage in messages without breaking existing message transport behavior.
- Add lightweight emoji reactions with real-time updates on messages.
- Add GIF picker integration for rich inline content.

## Iteration Plan (Detailed)

1. Finalize feature wiring for Phase 5.6/5.7/5.8 by connecting existing server and client building blocks end-to-end.
2. Add missing client UX surfaces:
   - Emoji management in settings (admin/operator only)
   - `:shortcode:` parsing and rendering in message bodies
   - Reaction chips + reaction picker + optimistic toggling
   - GIF insertion flow from picker into composer/message payload
3. Align server/client contracts:
   - Include reactions in message history payloads
   - Keep WS reaction events and client reducers synchronized
   - Ensure Tenor config and route behavior match client expectations
4. Validate and stabilize:
   - Fix TS/Rust warnings or dead code introduced by the phase
   - Run full phase validation commands and update completion status
5. Commit per feature after review:
   - Commit A: Phase 5.6 custom emojis
   - Commit B: Phase 5.7 reactions
   - Commit C: Phase 5.8 GIF search

## Scope

### Phase 5.6: Custom Emojis

**Backend**
- Add emoji asset CRUD endpoints with shortcode uniqueness checks.
- Enforce emoji upload constraints (`png|webp|gif`, max `512 KB`, bounded dimensions `128x128`).
- Persist emoji metadata and ownership for instance-scoped emoji sets.
- Store emojis in media_assets with derivative_kind='emoji'.

**Client**
- Add emoji management UI in settings for admins/operators.
- Add emoji picker in message composer.
- Parse and render `:shortcode:` in message content.
- Display custom emojis in messages.

### Phase 5.7: Message Reactions

**Backend**
- Add reactions table linking users, messages, and emoji (custom or unicode).
- Enforce per-user uniqueness per message/reaction key.
- Add REST endpoints for add/remove reactions.
- Add WebSocket broadcast events for reaction updates.

**Client**
- Render reaction chips with counts below messages.
- Add reaction picker (quick emoji + custom emojis).
- Show active-user state on reactions.
- Handle real-time reaction updates via WebSocket.

### Phase 5.8: GIF Search

**Backend**
- Add Tenor API integration for GIF search.
- Add `/gifs/search` endpoint that proxies to Tenor with safe filters.
- Cache popular searches briefly to reduce API calls.

**Client**
- Add GIF picker button in message composer.
- Search UI with infinite scroll results.
- Insert selected GIF as attachment in message.

## Ordered Checklist

### Phase 5.6: Custom Emojis

- [x] Database: Create emojis table migration
- [x] Server: Add Emoji model to models.rs
- [x] Server: Create emoji_routes.rs with CRUD endpoints
- [x] Server: Integrate emoji routes into main router
- [x] Server: Add emoji upload processing (resize to 128x128)
- [x] Client: Add emoji API module
- [x] Client: Add emoji store for caching
- [x] Client: Add emoji management UI in settings
- [x] Client: Add emoji picker component
- [x] Client: Add :shortcode: parser for message content
- [x] Client: Update MessageRichContent to render custom emojis

### Phase 5.7: Message Reactions

- [x] Database: Create reactions table migration
- [x] Server: Add Reaction model to models.rs
- [x] Server: Add reaction routes (POST/DELETE)
- [x] Server: Add WebSocket message types for reactions
- [x] Server: Broadcast reaction events to channel members
- [x] Client: Add reaction API methods
- [x] Client: Add Reaction component for message display
- [x] Client: Add reaction picker UI
- [x] Client: Handle reaction WebSocket events

### Phase 5.8: GIF Search

- [x] Server: Add Tenor API configuration
- [x] Server: Create gif_routes.rs with search endpoint
- [x] Client: Add GIF API methods
- [x] Client: Create GIF picker component
- [x] Client: Integrate GIF button in MessageComposer

### Validation

- [x] Run cargo fmt check
- [x] Run cargo clippy
- [x] Run cargo test
- [x] Run npm typecheck
- [x] Run npm build

## Touch Points

- `server/migrations/` - New migration files
- `server/src/models.rs` - Emoji and Reaction models
- `server/src/routes/emoji_routes.rs` - New file
- `server/src/routes/reaction_routes.rs` - New file
- `server/src/routes/gif_routes.rs` - New file
- `server/src/ws/messages.rs` - WebSocket message types
- `server/src/main.rs` - Route registration
- `server/src/config.rs` - Tenor API config
- `client/src/api/emojis.ts` - New file
- `client/src/api/reactions.ts` - New file
- `client/src/api/gifs.ts` - New file
- `client/src/stores/emojis.ts` - New file
- `client/src/components/EmojiPicker.tsx` - New file
- `client/src/components/ReactionPicker.tsx` - New file
- `client/src/components/GifPicker.tsx` - New file
- `client/src/components/MessageRichContent.tsx` - Update for emoji rendering
- `client/src/components/MessageTimeline.tsx` - Add reactions display
- `client/src/components/MessageComposer.tsx` - Add emoji/GIF buttons
- `client/src/components/settings-sections/` - Add emoji management

## Validation Commands

- Backend
  - `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
  - `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
  - `cargo test --manifest-path server/Cargo.toml`

- Frontend
  - `npm --prefix client run typecheck`
  - `npm --prefix client run build`

## Last Completed Phase

- Phase 5.8: GIF search support

## Next Step After These Phases

- Phase 4.1: Operator/admin role boundaries
