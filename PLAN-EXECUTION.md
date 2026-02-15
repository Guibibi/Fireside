# Yankcord Execution Plan (Current Phase)

`PLAN-EXECUTION.md` is a living implementation document for the active phase only.
Long-term roadmap and completed milestone tracking live in `PLAN.md`.

## Active Phase

- Phase 5.4: User avatars

## Phase Goal

- Add real avatar uploads with server-side image constraints and optimized avatar variants.
- Surface avatar rendering in message, member, and profile dock surfaces with fallback initials.

## Scope

- Backend
  - Add authenticated avatar upload endpoint (`POST /api/users/me/avatar`) with constraints (`jpeg|png|webp`, max `2 MB`).
  - Process avatar images into square `webp` derivatives (`avatar_256`, `avatar_64`) and strip source metadata by re-encoding.
  - Persist and expose avatar URL on user payloads (`/api/users`, `/api/users/me`, `/api/users/me` patch response).
  - Add media retrieval endpoint for derivatives (`GET /api/media/{media_id}/{variant}`).
- Client
  - Add shared user profile/avatar state store keyed by username.
  - Load avatar profiles from `/api/users` and hydrate current user profile from `/api/users/me`.
  - Replace placeholder avatar UX in settings with real avatar upload flow.
  - Render avatars in message timeline, member list, voice participants, and user dock with fallback initials.

## Touch Points

- `server/src/routes/user_routes.rs`
- `server/src/routes/media_routes.rs`
- `server/src/uploads/mod.rs`
- `server/src/main.rs`
- `client/src/stores/userProfiles.ts`
- `client/src/components/UserAvatar.tsx`
- `client/src/components/UserSettingsDock.tsx`
- `client/src/components/MessageArea.tsx`
- `client/src/components/MemberList.tsx`
- `client/src/components/VoicePanel.tsx`
- `client/src/styles/avatars.css`

## Validation Commands

- Backend
  - `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
  - `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
  - `cargo test --manifest-path server/Cargo.toml`
- Frontend
  - `npm --prefix client run typecheck`
  - `npm --prefix client run build`

## Last Completed Phase

- Phase 5.3: Media storage + optimization foundation

## Completion Snapshot (Phase 5.3)

- Added storage config + environment/config file wiring.
- Added storage abstraction with `local` backend and scaffolded `s3` backend.
- Added `media_assets` migration and metadata lifecycle state tracking.
- Added authenticated media upload endpoint and derivative generation pipeline.
- Added periodic cleanup job for orphaned/failed derivatives.
- Ran backend validation:
  - `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
  - `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
  - `cargo test --manifest-path server/Cargo.toml`

## Next Step After Phase 5.4

- Phase 5.5: Image support in chat
