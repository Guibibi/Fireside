# AGENTS.md

Guidance for autonomous coding agents working in `yankcord`.

## Scope and Intent

- Repo type: monorepo with a Rust backend and a Tauri desktop client.
- `server/`: Axum + SQLx/Postgres + WebSocket + mediasoup SFU.
- `client/`: SolidJS + TypeScript + Vite UI, plus `client/src-tauri` Rust host app.
- Goal for agents: make minimal, targeted changes that preserve existing architecture.
- Keep REST + WebSocket contracts stable unless protocol changes are explicitly requested.

## External Agent Rules (Cursor/Copilot)

- Checked for higher-priority agent instruction files:
  - `.cursorrules`: not present
  - `.cursor/rules/`: not present
  - `.github/copilot-instructions.md`: not present
- If any of these are added later, treat them as supplemental instructions with higher priority than this file.

## Environment and Setup

- Required tooling:
  - Rust stable toolchain
  - Node.js 18+ and npm
  - PostgreSQL 15+
  - Linux desktop deps for Tauri v2 (`webkit2gtk`, `rsvg2`)
  - Python 3 with `invoke`, `meson`, and `ninja` for mediasoup native build
- Initial server setup:
  - `cp server/.env.example server/.env`
  - fill `DATABASE_URL`, `JWT_SECRET`, and `SERVER_PASSWORD`
- Server applies SQL migrations in `server/migrations/` automatically on startup.

## Build, Lint, and Test Commands

Run from repo root unless stated otherwise.

### Backend (`server/`)

- Dev run: `cargo run --manifest-path server/Cargo.toml`
- Release build: `cargo build --release --manifest-path server/Cargo.toml`
- Format check: `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
- Format write: `cargo fmt --all --manifest-path server/Cargo.toml`
- Lint: `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
- Full test suite: `cargo test --manifest-path server/Cargo.toml`

Single-test patterns (backend Rust):

- Name filter (substring): `cargo test --manifest-path server/Cargo.toml connect`
- Exact unit test path: `cargo test --manifest-path server/Cargo.toml module::tests::test_name -- --exact`
- Integration test target (when files exist in `server/tests/`): `cargo test --manifest-path server/Cargo.toml --test auth_flow`
- Specific test with logs: `cargo test --manifest-path server/Cargo.toml module::tests::test_name -- --exact --nocapture`

### Frontend (`client/`)

- Install deps: `npm --prefix client install`
- Dev web UI: `npm --prefix client run dev`
- Build web UI: `npm --prefix client run build`
- Preview build: `npm --prefix client run serve`
- Type-check: `npm --prefix client run typecheck`
- Tauri dev: `npm --prefix client run tauri dev`
- Tauri build: `npm --prefix client run tauri build`

Test/lint status (frontend TS):

- There is no dedicated JS/TS test runner script in `client/package.json`.
- There is no dedicated ESLint script in `client/package.json`.
- Treat `npm --prefix client run typecheck` + `npm --prefix client run build` as the minimum validation.

### Tauri Rust Host (`client/src-tauri/`)

- Build only host crate: `cargo build --manifest-path client/src-tauri/Cargo.toml`
- Test host crate: `cargo test --manifest-path client/src-tauri/Cargo.toml`
- Single test by name: `cargo test --manifest-path client/src-tauri/Cargo.toml test_name`
- Exact test path: `cargo test --manifest-path client/src-tauri/Cargo.toml module::tests::test_name -- --exact`

## Validation Expectations for Agents

- If backend code changes, run at minimum:
  - `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
  - `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
  - `cargo test --manifest-path server/Cargo.toml`
- If frontend TypeScript/Solid code changes, run at minimum:
  - `npm --prefix client run typecheck`
  - `npm --prefix client run build`
- If only `client/src-tauri` Rust changes, also run:
  - `cargo test --manifest-path client/src-tauri/Cargo.toml`
- If environment constraints block validation (DB unavailable, missing Linux libs), report exactly what could not run and why.

## Manual QA Tracking Policy

- Do not add new manual QA steps/checklists directly into planning docs (for example `PLAN-EXECUTION.md` or `PLAN.md`).
- When manual human verification is needed, append it to `QA.md` instead.
- Treat `QA.md` as the canonical backlog for human-run verification tasks.
- Keep entries concise and actionable (feature area, scenario, expected result).
- If a manual QA item is completed by a human, mark it done in `QA.md` rather than modifying plan milestones to include manual test details.

## Planning Document Workflow Policy

- Treat `PLAN.md` as the canonical roadmap (what is planned and what is completed).
- Treat `PLAN-EXECUTION.md` as a living implementation document for the current active phase only.
- At the start of a new phase/feature:
  - rewrite/update `PLAN-EXECUTION.md` with concrete implementation details, scope, ordered checklist, touch points, and validation commands for that phase.
  - avoid keeping historical completed tracks in `PLAN-EXECUTION.md`.
- During implementation:
  - keep `PLAN-EXECUTION.md` current as execution details change.
- When the active phase is complete:
  - update `PLAN.md` to mark/describe completion.
  - refresh `PLAN-EXECUTION.md` so it represents the next current phase (or an explicit "awaiting next phase" placeholder).

## Code Style: Cross-Cutting

- Match local style and existing patterns before introducing new abstractions.
- Keep changes focused; avoid broad refactors unless asked.
- Keep imports minimal and remove unused imports.
- Prefer explicit, boundary-facing types over inferred structural types.
- Avoid placeholder naming (`tmp`, `data2`, `foo`); use domain terms.
- Do not silently alter protocol field names or serialized wire values.

## Rust Style (`server/`)

- Formatting: standard `rustfmt` output, 4-space indentation, trailing commas in multiline blocks.
- Imports: typical grouping is `std`, third-party crates, then `crate::...`.
- Naming: `snake_case` functions/modules/variables, `PascalCase` structs/enums/traits.
- Serde contracts: preserve stringly wire names via `#[serde(rename = "...")]`.
- IDs/timestamps: use `Uuid` IDs and chrono timestamps compatible with existing models.
- Handlers: return `Result<..., AppError>` and propagate with `?`.
- Errors: map failures to specific `AppError` variants; log internal detail, return safe messages.
- SQLx: keep SQL in `sqlx::query` / `query_as` with bound parameters (no string interpolation).
- Validation: enforce user input constraints before DB writes.
- Concurrency: use shared state with `Arc<RwLock<...>>`; keep lock scope tight.

## Rust Style (`client/src-tauri/`)

- Follow rustfmt defaults and keep Tauri command signatures explicit.
- Keep platform-specific logic inside `cfg`-guarded modules (for example Windows capture code).
- Return user-safe error messages from Tauri commands; keep internal details in logs.
- Keep command surface stable unless coordinated with TS callers in `client/src/api/nativeCapture.ts`.

## TypeScript/Solid Style (`client/src/`)

- Formatting: 2 spaces, semicolons, trailing commas in multiline literals/calls.
- TS config is strict; keep compatibility with `client/tsconfig.json` (`strict`, no unused locals/params).
- Avoid `any`; use `unknown` + narrowing when parsing dynamic payloads.
- Naming: `camelCase` vars/functions, `PascalCase` components/types/interfaces.
- Imports: preserve existing relative import style and use `import type` for type-only imports where useful.
- State patterns: use Solid signals/resources/effects idiomatically and clean side effects on teardown.
- Transport models: keep backend JSON field names (`snake_case`) in API/WS payload interfaces.
- Network handling: throw or surface readable errors; use defensive parsing for WS/HTTP responses.

## Protocol and Data Contract Rules

- WebSocket messages are tagged JSON objects with a `type` discriminator.
- First client WS message must authenticate (`type: "authenticate"`).
- Keep `server/src/ws/messages.rs` and `client/src/api/ws.ts` in sync for all message variants.
- Keep REST and WS representations aligned for channels, messages, and voice presence.
- If protocol changes are required, update both sides in one change and call out migration impact.

## Change Management and Safety

- Never commit secrets (`.env`, tokens, credentials, API keys).
- Keep commits scoped and descriptive to a single concern.
- Preserve unrelated user changes in dirty working trees.
- Update docs and examples when introducing new commands, env vars, or config knobs.

## Deployment-Sensitive Changes

- Deployment and networking checklist lives in `docs/deploy.md`.
- If adding production config values (CORS/media/TURN/ICE), update all of:
  - `server/src/config.rs`
  - `server/.env.example`
  - `server/config.toml.example`
  - `docs/deploy.md`
