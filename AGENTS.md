# AGENTS.md

Guidance for autonomous coding agents working in `yankcord`.

## Scope

- Monorepo with a Rust backend and a Tauri desktop client.
- `server/`: Axum + SQLx/Postgres + WebSocket + mediasoup SFU.
- `client/`: SolidJS + TypeScript + Vite UI.
- `client/src-tauri/`: Rust host crate for native desktop integration.
- Keep changes focused and architecture-aligned; avoid broad refactors unless requested.

## External Rules (Cursor/Copilot)

Checked paths in this repository:

- `.cursorrules`: not present
- `.cursor/rules/`: not present
- `.github/copilot-instructions.md`: not present

If any are added later, treat them as higher-priority supplemental instructions.

## Environment Prereqs

- Rust stable toolchain
- Node.js 18+ and npm
- PostgreSQL 15+
- Linux desktop deps for Tauri v2 (`webkit2gtk`, `rsvg2`)
- Python 3 + `invoke` + `meson` + `ninja` (mediasoup native build chain)

Server bootstrap:

- `cp server/.env.example server/.env`
- Set `DATABASE_URL`, `JWT_SECRET`, and `SERVER_PASSWORD`
- Migrations in `server/migrations/` run automatically at server startup

## Build, Lint, and Test Commands

Run commands from repo root unless noted.

### Backend (`server/`)

- Dev run: `cargo run --manifest-path server/Cargo.toml`
- Release build: `cargo build --release --manifest-path server/Cargo.toml`
- Format write: `cargo fmt --all --manifest-path server/Cargo.toml`
- Format check: `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
- Lint: `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
- Full tests: `cargo test --manifest-path server/Cargo.toml`

Single-test patterns (Rust backend):

- Name filter: `cargo test --manifest-path server/Cargo.toml connect`
- Exact unit test: `cargo test --manifest-path server/Cargo.toml module::tests::test_name -- --exact`
- Integration target: `cargo test --manifest-path server/Cargo.toml --test auth_flow`
- Exact test with logs: `cargo test --manifest-path server/Cargo.toml module::tests::test_name -- --exact --nocapture`

### Frontend (`client/`)

- Install deps: `npm --prefix client install`
- Dev server: `npm --prefix client run dev`
- Type-check: `npm --prefix client run typecheck`
- Production build: `npm --prefix client run build`
- Build preview: `npm --prefix client run serve`
- Tauri CLI passthrough: `npm --prefix client run tauri -- <args>`
- Tauri dev: `npm --prefix client run tauri:dev`
- Tauri build: `npm --prefix client run tauri:build`

Frontend test/lint reality:

- No dedicated JS/TS unit test script exists in `client/package.json`.
- No ESLint script exists in `client/package.json`.
- Minimum frontend validation: `npm --prefix client run typecheck` and `npm --prefix client run build`.

### Tauri Host (`client/src-tauri/`)

- Build crate: `cargo build --manifest-path client/src-tauri/Cargo.toml`
- Full tests: `cargo test --manifest-path client/src-tauri/Cargo.toml`
- Single test by filter: `cargo test --manifest-path client/src-tauri/Cargo.toml test_name`
- Exact test path: `cargo test --manifest-path client/src-tauri/Cargo.toml module::tests::test_name -- --exact`

Single-test quick reference:

- Backend exact test: `cargo test --manifest-path server/Cargo.toml module::tests::test_name -- --exact`
- Backend integration test file: `cargo test --manifest-path server/Cargo.toml --test test_file_name`
- Tauri host exact test: `cargo test --manifest-path client/src-tauri/Cargo.toml module::tests::test_name -- --exact`
- Tauri host by substring: `cargo test --manifest-path client/src-tauri/Cargo.toml capture`
- Frontend: no unit test script; use `npm --prefix client run typecheck` for focused TS validation.

## Validation Expectations

- Backend changes: run fmt check, clippy, and backend tests.
- Frontend TS/Solid changes: run typecheck and build.
- `client/src-tauri` Rust changes: run host crate tests.
- If validation is blocked by environment limits, report exactly what failed and why.

## Code Style (Cross-Cutting)

- Match existing local patterns before introducing new abstractions.
- Keep imports minimal; remove unused imports and dead helpers.
- Prefer explicit types at module boundaries (API payloads, command params, DB rows).
- Use domain names, not placeholders like `tmp`, `foo`, or `data2`.
- Preserve wire contracts (JSON field names, WS message `type` values, enum strings).
- Keep changes small and composable; avoid opportunistic rewrites.
- Prefer extracting cohesive modules over growing already-large files.

## Rust Style (`server/` and `client/src-tauri/`)

- Formatting: `rustfmt` defaults, 4-space indentation, trailing commas in multiline blocks.
- Imports: grouped as `std`, third-party crates, then `crate::...` / local modules.
- Naming: `snake_case` for functions/modules/variables, `PascalCase` for types/traits/enums.
- Error handling: use typed errors (`AppError` or crate-local error enums), propagate with `?`.
- User safety: log internal details, return sanitized messages to clients.
- SQLx: use bound parameters with `query`/`query_as`; no SQL string interpolation.
- Validation: enforce input constraints before DB writes or side effects.
- Concurrency: shared state via `Arc<RwLock<...>>`; keep lock scopes tight.
- Serde contracts: keep explicit rename attributes when wire names are not Rust idiomatic.

## TypeScript/Solid Style (`client/src/`)

- Formatting: 2 spaces, semicolons, trailing commas in multiline literals/calls.
- TS strictness: maintain compatibility with `client/tsconfig.json` strict settings.
- Types: avoid `any`; prefer `unknown` + narrowing and explicit payload interfaces.
- Naming: `camelCase` for values/functions, `PascalCase` for components/types.
- Imports: preserve current relative style; use `import type` for type-only imports.
- State: use Solid signals/resources/effects idiomatically and clean up side effects.
- API/WS models: keep backend snake_case fields in transport interfaces.
- Runtime parsing: defensively parse WebSocket/HTTP data and surface readable errors.

## Protocol Contract Rules

- WebSocket protocol uses tagged JSON with a `type` discriminator.
- First client WS message must authenticate (`type: "authenticate"`).
- Keep `server/src/ws/messages.rs` and `client/src/api/ws.ts` synchronized.
- Keep REST and WS representations aligned for channels, messages, and voice presence.
- If protocol changes are unavoidable, update server and client in one change and note migration impact.

## Planning, QA, and Deployment Notes

- Treat `PLAN.md` as roadmap and `PLAN-EXECUTION.md` as current-phase implementation detail.
- Put manual verification backlog in `QA.md` (not in planning docs).
- Never commit secrets (`.env`, tokens, credentials).
- For deployment-sensitive config changes (CORS/media/TURN/ICE), update:
  - `server/src/config.rs`
  - `server/.env.example`
  - `server/config.toml.example`
  - `docs/deploy.md`
