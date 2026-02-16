---
name: media-upload-guardrails
description: Apply consistent validation, processing, and safety rules to media upload features.
---

## What I do

- Enforce consistent upload rules (MIME, size, dimensions, and ownership checks).
- Ensure metadata persistence and lifecycle states are coherent.
- Keep client and server behavior aligned for user-safe errors and retries.
- Protect existing media/storage contracts while extending capabilities.

## When to use me

Use this for avatar, image attachment, emoji, or other upload pipeline changes.

## Guardrails

- Validate content by actual MIME where possible; do not trust extension alone.
- Enforce explicit max upload limits from config and feature constraints.
- Keep derivative/processing status transitions clear (`processing`, `ready`, `failed`).
- Ensure storage backend behavior remains compatible (`local` default, `s3` scaffold).
- Return sanitized errors to clients while keeping internal details in logs.

## Typical touch points

- `server/src/config.rs`
- `server/src/storage/`
- upload/media routes and metadata models
- client upload UX and transport payload handling

## If config is added or changed

Update all required surfaces together:

- `server/src/config.rs`
- `server/.env.example`
- `server/config.toml.example`
- `docs/deploy.md`

## Validation

- Backend: `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
- Backend: `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
- Backend: `cargo test --manifest-path server/Cargo.toml`
- Frontend (if touched): `npm --prefix client run typecheck` and `npm --prefix client run build`
