# Yankcord Execution Plan (Current Phase)

`PLAN-EXECUTION.md` is a living implementation document for the active phase only.
Long-term roadmap and completed milestone tracking live in `PLAN.md`.

## Active Phase

- Phase 5.3: Media storage + optimization foundation

## Objective

- Add a self-hosted media pipeline with local storage first and optional S3-compatible backend later.
- Store media metadata in Postgres and process uploads into optimized derivatives.
- Track lifecycle states and add cleanup jobs for orphaned/failed derivatives.

## Scope

### In scope

- Server-side storage abstraction (`local` backend default, `s3`/MinIO optional via config).
- Media metadata model in Postgres (`owner_id`, `mime_type`, `bytes`, `checksum`, `storage_key`, timestamps, processing status).
- Upload processing into optimized derivatives with lifecycle tracking.
- Cleanup job for orphaned/failed derivatives.

### Out of scope

- Client-side image picker/display implementation (Phase 5.4+).
- Custom emoji/GIF support (Phase 5.5+).
- Frontend upload progress UI (later phase).

## Implementation Checklist

1. Add storage config to server config module.
2. Create storage abstraction traits and `local` backend.
3. Add media metadata table migration.
4. Implement upload endpoint with storage backend.
5. Add derivative processing (thumbnails, etc.).
6. Add cleanup background job.
7. Validate with backend tests.
8. Update `PLAN.md` once implementation and validation are complete.

## Primary Touch Points

- `server/src/config.rs`
- `server/src/storage/` (new module)
- `server/migrations/`

## Validation

- Backend: `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
- Backend: `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
- Backend: `cargo test --manifest-path server/Cargo.toml`

## Done Criteria

- Storage backend abstraction is in place with local default.
- Media uploads are persisted with metadata in Postgres.
- Derivatives are generated and tracked.
- Cleanup job removes orphaned files.
- Validation commands pass.
- `PLAN.md` updated to reflect completion of Phase 5.3.
