---
name: tauri-bridge-sync
description: Keep Tauri Rust command surfaces synchronized with TypeScript callers and media flows.
---

## What I do

- Verify command signatures and payload shapes match between Rust and TS.
- Keep native capture/media bridge behavior consistent across platform paths.
- Catch drift between `client/src-tauri` commands and `client/src/api` consumers.
- Apply coordinated updates when command names, params, or return shapes change.

## When to use me

Use this for any desktop-native integration work (capture, codecs, native media controls, command wiring).

## Sync targets

- Rust host crate: `client/src-tauri/`
- TS bridge caller: `client/src/api/nativeCapture.ts`
- Related media integration in `client/src/api/media/`

## Workflow

1. Locate changed Rust commands and their request/response types.
2. Verify TS invocations match names and parameter shape.
3. Verify TS parsing/narrowing matches Rust return payloads.
4. Update both sides in one change.
5. Validate both Rust and frontend builds.

## Validation

- Tauri host: `cargo test --manifest-path client/src-tauri/Cargo.toml`
- Frontend: `npm --prefix client run typecheck`
- Frontend: `npm --prefix client run build`
