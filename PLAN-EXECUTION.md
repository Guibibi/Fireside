# Yankcord Execution Plan (Current Phase)

`PLAN-EXECUTION.md` is a living implementation document for the active phase only.
Long-term roadmap and completed milestone tracking live in `PLAN.md`.

## Active Phase

- Phase 5.6: Custom emojis/icons

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
  - Add emoji picker UI and insert selected shortcode into composer.
  - Parse/render `:shortcode:` tokens in message timeline with fallback to plain text for unknown codes.
  - Keep edit/delete/realtime behavior compatible with emoji-rich messages.

## Ordered Checklist

- [ ] Add emoji schema + migration for shortcode and media linkage.
- [ ] Implement emoji CRUD API + server-side validation.
- [ ] Build emoji picker + shortcode insertion in composer.
- [ ] Render shortcode tokens as emoji assets in message timeline.
- [ ] Validate upload limits and duplicate shortcode behavior.
- [ ] Run backend + frontend validation commands and capture blockers.

## Touch Points

- `server/src/routes/emoji_routes.rs`
- `server/src/routes/mod.rs`
- `server/src/uploads/mod.rs`
- `server/src/ws/messages.rs`
- `client/src/components/MessageArea.tsx`
- `client/src/components/EmojiPicker.tsx`
- `client/src/api/http.ts`

## Validation Commands

- Backend
  - `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
  - `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
  - `cargo test --manifest-path server/Cargo.toml`
- Frontend
  - `npm --prefix client run typecheck`
  - `npm --prefix client run build`

## Last Completed Phase

- Phase 5.5: Image support in chat

## Completion Snapshot (Phase 5.5)

- Added message attachment persistence via `message_attachments` and additive WS/history payload fields.
- Added MIME sniffing for uploads to enforce content-based image type validation.
- Added composer image upload queue with upload/processing/failure states.
- Added chat timeline image attachment rendering with open/download actions.
- Kept existing text messaging/edit/delete flows compatible with attachment messages.

## Next Step After Phase 5.6

- Phase 5.7: Per-voice-channel codec configuration
