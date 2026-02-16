---
name: yankcord-validation-matrix
description: Select and run the correct Yankcord validation commands from changed paths.
---

## What I do

- Detect which project areas are affected (`server/`, `client/`, `client/src-tauri/`).
- Run only the required validation commands for those areas.
- Report failures with exact command, error surface, and likely next fix target.
- Avoid unnecessary full-suite runs when a targeted run is sufficient.

## When to use me

Use this after code changes, before committing, or when asked to verify a patch.

## Validation matrix

- Backend changes (`server/`):
  - `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
  - `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
  - `cargo test --manifest-path server/Cargo.toml`
- Frontend changes (`client/src/` or shared client TS):
  - `npm --prefix client run typecheck`
  - `npm --prefix client run build`
- Tauri host changes (`client/src-tauri/`):
  - `cargo test --manifest-path client/src-tauri/Cargo.toml`

## Single-test fast paths

- Backend exact test:
  - `cargo test --manifest-path server/Cargo.toml module::tests::test_name -- --exact`
- Backend integration target:
  - `cargo test --manifest-path server/Cargo.toml --test test_file_name`
- Tauri exact test:
  - `cargo test --manifest-path client/src-tauri/Cargo.toml module::tests::test_name -- --exact`

## Output format

- Scope detected
- Commands run
- Pass/fail per command
- Blockers and precise next step
