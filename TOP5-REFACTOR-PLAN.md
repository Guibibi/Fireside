# Top 5 Largest Files Refactor Plan

## Scope

This plan targets the current top 5 largest code files by line count:

1. `client/src/api/media.ts` (2304)
2. `client/src/components/ChannelList.tsx` (1627)
3. `server/src/ws/handler.rs` (1452)
4. `client/src/styles/global.css` (1210)
5. `server/src/media/transport.rs` (857)

Primary objective: reduce file size, improve maintainability, and preserve existing behavior and wire contracts.

## Refactor Principles

- Keep behavior and API/WS contracts stable.
- Extract cohesive modules only; avoid broad rewrites.
- Prioritize readability, smaller units, and testability.
- Preserve naming/serialization conventions (`snake_case`, serde `rename`, message `type` discriminators).

## Per-File Plan

### 1) `client/src/api/media.ts`

Likely concerns to split:

- media device enumeration and permissions
- local stream creation and track lifecycle
- sender/receiver setup helpers
- screen/camera switching and fallback logic
- error normalization and retry helpers

Target structure:

- `client/src/api/media/constraints.ts`
- `client/src/api/media/devices.ts`
- `client/src/api/media/streams.ts`
- `client/src/api/media/tracks.ts`
- `client/src/api/media/errors.ts`
- keep `client/src/api/media.ts` as a thin orchestrator and compatibility export surface

### 2) `client/src/components/ChannelList.tsx`

Likely concerns to split:

- data shaping/selectors
- event handlers (create/edit/delete/join/move)
- rendering of channel/group rows
- modals/menus and keyboard interactions
- drag/drop logic (if present)

Target structure:

- `client/src/components/channel-list/ChannelList.tsx` (container)
- `client/src/components/channel-list/ChannelGroup.tsx`
- `client/src/components/channel-list/ChannelRow.tsx`
- `client/src/components/channel-list/hooks.ts`
- `client/src/components/channel-list/selectors.ts`
- migrate existing imports with a temporary re-export from original path if needed

### 3) `server/src/ws/handler.rs`

Likely concerns to split:

- authenticate handshake path
- inbound message dispatch by `type`
- room/channel membership operations
- voice presence updates/broadcast
- error mapping and close semantics

Target structure:

- `server/src/ws/handler/mod.rs` (entrypoint)
- `server/src/ws/handler/auth.rs`
- `server/src/ws/handler/dispatch.rs`
- `server/src/ws/handler/channel_ops.rs`
- `server/src/ws/handler/voice_ops.rs`
- `server/src/ws/handler/errors.rs`

Notes:

- Keep `server/src/ws/messages.rs` and client WS message handling aligned.
- Do not change message wire names without explicit protocol migration.

### 4) `client/src/styles/global.css`

Likely concerns to split:

- reset/base styles
- typography and tokens
- layout primitives/utilities
- component-level shared styles
- animation keyframes

Target structure:

- `client/src/styles/base.css`
- `client/src/styles/tokens.css`
- `client/src/styles/layout.css`
- `client/src/styles/components.css`
- `client/src/styles/animations.css`
- `client/src/styles/global.css` imports partials in deterministic order

### 5) `server/src/media/transport.rs`

Likely concerns to split:

- transport creation/configuration
- DTLS/ICE state handling
- producer/consumer wiring helpers
- metrics/telemetry
- error conversion and validation

Target structure:

- `server/src/media/transport/mod.rs` (public API)
- `server/src/media/transport/create.rs`
- `server/src/media/transport/state.rs`
- `server/src/media/transport/pipe.rs` (if pipe transport logic exists)
- `server/src/media/transport/metrics.rs`
- `server/src/media/transport/errors.rs`

## Execution Sequence

1. Refactor one file at a time (largest to smaller).
2. After each file refactor:
   - compile/type-check,
   - run focused tests,
   - keep changes small and reviewable.
3. After all five:
   - run full validation suites,
   - resolve regressions,
   - update docs if any paths/public imports changed.

## Validation Commands

Frontend changes:

- `npm --prefix client run typecheck`
- `npm --prefix client run build`

Backend changes:

- `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
- `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
- `cargo test --manifest-path server/Cargo.toml`

## Definition of Done

- All 5 files reduced in size via cohesive extraction.
- No protocol contract regressions in REST/WS behavior.
- Frontend typecheck/build and backend fmt/clippy/tests pass.
- Imports/module boundaries are clear and consistent with repo conventions.
