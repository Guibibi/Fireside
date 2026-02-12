# AGENTS.md

Guidance for autonomous coding agents working in `yankcord`.

## Scope And Priorities

- This repo is a monorepo with two projects:
  - `server/`: Rust backend (Axum + SQLx + WebSocket + mediasoup)
  - `client/`: Tauri v2 desktop app (SolidJS + TypeScript + Vite)
- Prefer minimal, focused changes; preserve existing architecture and naming.
- Keep API and WebSocket wire formats stable unless explicitly changing protocol.

## External Agent Rules

- Checked for Cursor rules and Copilot instructions:
  - `.cursorrules`: not present
  - `.cursor/rules/`: not present
  - `.github/copilot-instructions.md`: not present
- If any of the above files are later added, treat them as higher-priority supplements.

## Environment And Setup

- Required runtime:
  - Rust stable toolchain
  - Node.js 18+
  - PostgreSQL 15+
  - Tauri v2 Linux deps (`webkit2gtk`, `rsvg2`) for desktop runs
- First-time server setup:
  - `cp server/.env.example server/.env`
- Server auto-runs DB migrations from `server/migrations/` on startup.

## Build, Lint, And Test Commands

Run commands from repo root unless noted.

### Server (`server/`)

- Dev run: `cargo run --manifest-path server/Cargo.toml`
- Release build: `cargo build --release --manifest-path server/Cargo.toml`
- Format check: `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
- Format write: `cargo fmt --all --manifest-path server/Cargo.toml`
- Lint (Clippy): `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
- Full tests: `cargo test --manifest-path server/Cargo.toml`

Single-test patterns (Rust):

- By test name substring:
  - `cargo test --manifest-path server/Cargo.toml connect`
- Exact test path:
  - `cargo test --manifest-path server/Cargo.toml routes::channel_routes::tests::create_channel -- --exact`
- Integration test target (if present under `server/tests/`):
  - `cargo test --manifest-path server/Cargo.toml --test auth_flow`
- Show logs/stdout while running one test:
  - `cargo test --manifest-path server/Cargo.toml test_name -- --exact --nocapture`

### Client (`client/`)

- Install deps: `npm --prefix client install`
- Dev web UI: `npm --prefix client run dev`
- Production build: `npm --prefix client run build`
- Preview build: `npm --prefix client run serve`
- Tauri dev app: `npm --prefix client run tauri dev`
- Tauri production app: `npm --prefix client run tauri build`

Type/lint status for client:

- No dedicated lint script is configured in `client/package.json`.
- No test script/framework is configured in `client/package.json`.
- Type-check without emit: `npx tsc -p client/tsconfig.json --noEmit`

Single-test patterns (client):

- There is currently no client test runner configured, so single-test commands do not apply yet.
- If tests are introduced, add a script and document file-level and test-name filtering here.

## Code Style: Cross-Cutting

- Match existing file style; do not reformat unrelated sections.
- Keep imports organized and avoid unused imports.
- Prefer explicit types at API boundaries.
- Avoid `any` in TypeScript; use `unknown` and narrow.
- Avoid broad refactors unless requested; preserve behavior.
- Use descriptive names over abbreviations.

## Rust Style (`server/`)

- Formatting:
  - Use `rustfmt` defaults (4-space indentation, trailing commas in multiline).
- Imports:
  - Group `std` imports, third-party crates, then `crate::...` imports.
  - Keep imports minimal and deterministic.
- Naming:
  - `snake_case` for functions/variables/modules.
  - `PascalCase` for structs/enums/traits.
  - Enum variants are `PascalCase`; serde wire names use `#[serde(rename = "...")]`.
- Types and data:
  - Use `Uuid` for entity IDs.
  - Use `chrono::DateTime<Utc>` for timestamps.
  - Derive only needed traits (`Clone`, `Debug`, `Serialize`, etc.).
- Error handling:
  - Route handlers return `Result<..., AppError>`.
  - Use `?` for fallible operations and `From` conversions where available.
  - Return specific `AppError` variants for user-facing failures.
  - Log internals; avoid leaking sensitive internal details.
- HTTP/DB patterns:
  - Extract auth from `Authorization: Bearer ...` as current code does.
  - Validate and trim user input before DB writes.
  - Keep SQL in `sqlx::query` / `sqlx::query_as` calls with bound params.
  - Prefer transactions where multi-step consistency matters.
- Async/concurrency:
  - Use `Arc<RwLock<...>>` patterns consistently with existing `AppState`.
  - Keep lock scopes tight.

## TypeScript/Solid Style (`client/`)

- Formatting:
  - 2-space indentation, semicolons, trailing commas in multiline literals/calls.
- Imports:
  - Keep relative imports consistent (`../...` style in current code).
  - Separate type imports when useful (`import type { ... }`).
- Naming:
  - `camelCase` for vars/functions.
  - `PascalCase` for components/interfaces/types.
  - Preserve backend JSON field names (`snake_case`) in transport payloads.
- Types:
  - Keep `strict` TypeScript compatibility (`client/tsconfig.json`).
  - Type API responses and WS messages with explicit interfaces/unions.
- Solid patterns:
  - Use signals/resources/effects idiomatically.
  - Clean up side effects via `onCleanup`.
  - Keep component state local unless shared via stores.
- Error handling:
  - Surface readable UI errors from network failures.
  - Use defensive parsing and graceful fallbacks for WS/HTTP responses.

## Protocol And State Conventions

- WebSocket protocol uses tagged JSON messages with a `type` field.
- First WS client message must be authentication.
- REST and WS should stay consistent for core entities (`Channel`, `Message`, voice presence).
- Do not silently change message type strings; coordinate both server and client if modified.

## Testing Expectations For Agents

- For server code changes, run at least:
  - `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
  - `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
  - `cargo test --manifest-path server/Cargo.toml`
- For client code changes, run at least:
  - `npx tsc -p client/tsconfig.json --noEmit`
  - `npm --prefix client run build`
- If constrained by environment (DB, system deps), report exactly what was not run and why.

## Change Management

- Do not commit secrets (`.env`, credentials, tokens).
- Keep commits scoped and descriptive.
- Document any new scripts, env vars, or protocol changes in this file and project docs.
