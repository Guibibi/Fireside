# Yankcord Execution Plan (Current Phase)

`PLAN-EXECUTION.md` is a living implementation document for the active phase only.
Long-term roadmap and completed milestone tracking live in `PLAN.md`.

## Active Phase

- Phase 5.1: Message improvements

## Phase Goal

- Improve message navigation and readability without changing protocol contracts.
- Load recent messages first, then lazily fetch older history while scrolling up.
- Group consecutive messages from the same author into a single visual block.

## Product Decisions Locked

- Initial channel load targets newest ~20 messages.
- Timeline stays anchored to latest content on channel open.
- Grouping applies only to consecutive messages in the same channel by the same author.
- Grouping breaks on author change and date separator boundaries.

## Architecture Direction

### Backend/API

- Reuse existing message list endpoint pagination (`before`, `limit`) as the history primitive.
- Ensure deterministic ordering for paginated history slices.
- Keep channel chat payload schemas unchanged.

### Frontend

- Add/extend message pagination state in chat store for:
  - `has_more`
  - `oldest_loaded_message_id` (or equivalent cursor)
  - loading guard to prevent duplicate concurrent fetches
- Trigger lazy-load when the user nears top of the message scroller.
- Preserve scroll position when prepending older messages.
- Render grouped message blocks with:
  - shared author header for each block
  - per-message timestamp/details retained inside the block body

## Validation and Constraints

- Preserve existing send/edit/delete behavior.
- Preserve existing typing/read/realtime update behavior.
- Keep transport field names in `snake_case`.
- Avoid introducing regressions in DM and channel context switching.

## Iteration Plan (Detailed)

1. Audit existing message fetch flow and pagination semantics.
2. Add/adjust store state for lazy-load cursor + loading guards.
3. Implement top-scroll history fetch and prepend merge logic.
4. Implement consecutive-message grouping in timeline renderer.
5. Validate scroll anchoring behavior for load/append/prepend cases.
6. Run frontend validation commands.

## Ordered Checklist

### 5.1.A Message lazy loading

- [ ] Confirm current API pagination contract for channel history
- [ ] Fetch newest ~20 on channel open
- [ ] Load older history on upward scroll threshold
- [ ] Prevent duplicate inflight history requests per channel
- [ ] Preserve viewport position when older messages are prepended

### 5.1.B Consecutive message grouping

- [ ] Group adjacent messages by same author in timeline rendering
- [ ] Break groups on author change
- [ ] Break groups across day/date separator changes
- [ ] Keep per-message controls/metadata usable inside grouped blocks

### 5.1.C Validation

- [ ] `npm --prefix client run typecheck`
- [ ] `npm --prefix client run build`

## Touch Points (Expected)

- `client/src/stores/chat.ts`
- `client/src/components/MessageArea.tsx`
- `client/src/components/MessageTimeline.tsx`
- `client/src/styles/messages.css`

## Validation Commands

- Frontend
  - `npm --prefix client run typecheck`
  - `npm --prefix client run build`

## Exit Criteria

- Opening a channel shows latest messages and starts near bottom.
- Scrolling upward lazy-loads older messages until history is exhausted.
- Consecutive messages from one user render as grouped blocks.
- Existing channel realtime behavior remains stable.
