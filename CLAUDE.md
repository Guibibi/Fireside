# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fireside (repo: yankcord) is a self-hosted Discord alternative for small communities. Monorepo with:
- **`server/`** — Rust backend: Axum + SQLx/PostgreSQL + WebSocket + mediasoup SFU
- **`client/`** — SolidJS + TypeScript + Vite frontend
- **`client/src-tauri/`** — Tauri v2 desktop shell with native screen capture (DXGI/NVENC on Windows)

## Build, Lint, and Test Commands

All commands run from repo root.

### Backend (`server/`)

| Task | Command |
|------|---------|
| Dev run | `cargo run --manifest-path server/Cargo.toml` |
| Release build | `cargo build --release --manifest-path server/Cargo.toml` |
| Format | `cargo fmt --all --manifest-path server/Cargo.toml` |
| Format check | `cargo fmt --all --manifest-path server/Cargo.toml -- --check` |
| Lint | `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings` |
| All tests | `cargo test --manifest-path server/Cargo.toml` |
| Single test | `cargo test --manifest-path server/Cargo.toml module::tests::test_name -- --exact` |
| Test by filter | `cargo test --manifest-path server/Cargo.toml connect` |

### Frontend (`client/`)

| Task | Command |
|------|---------|
| Install deps | `npm --prefix client install` |
| Dev server | `npm --prefix client run dev` |
| Type-check | `npm --prefix client run typecheck` |
| Production build | `npm --prefix client run build` |
| Tauri dev | `npm --prefix client run tauri:dev` |
| Tauri build | `npm --prefix client run tauri:build` |

No JS/TS unit test runner or ESLint exists. Minimum frontend validation is **typecheck + build**.

### Tauri Host (`client/src-tauri/`)

```
cargo build --manifest-path client/src-tauri/Cargo.toml
cargo test --manifest-path client/src-tauri/Cargo.toml
```

### Validation Checklist

- Backend changes: fmt check → clippy → tests
- Frontend changes: typecheck → build
- Tauri Rust changes: host crate tests

### Makefile Shortcuts

`make server-dev`, `make server-fmt`, `make server-lint`, `make server-test`, `make build`, `make typecheck`, `make tauri-dev`, `make db-up`, `make db-down`

## Architecture

### Server

Axum HTTP + WebSocket server with mediasoup-based SFU for WebRTC voice/video/screen sharing.

- **Routes** (`server/src/routes/`): auth, channels, messages, users, DMs, media uploads, reactions, embeds, invites, emojis, GIFs
- **WebSocket** (`server/src/ws/`): real-time messaging, presence, voice state, media signaling. Tagged JSON protocol with `type` discriminator.
- **Media** (`server/src/media/`): mediasoup workers/routers/transports/producers/consumers. Native RTP ingestion for desktop screen share.
- **Database**: PostgreSQL 15+ with SQLx. Migrations in `server/migrations/` auto-run at startup.
- **Auth**: JWT + Argon2 password hashing with rate-limited auth endpoints.
- **Config**: `server/src/config.rs` (AppConfig struct); env vars from `.env`.

### Client

SolidJS SPA with WebRTC media handling.

- **Pages/Components** (`client/src/components/`): Login, Chat, Settings, Admin, voice/video UI, message composer, emoji/GIF pickers
- **API layer** (`client/src/api/`):
  - `ws.ts`: WebSocket client with reconnect and 15s heartbeat
  - `http.ts`: REST client
  - `media/`: WebRTC/mediasoup integration — producers, consumers, transports, signaling, RNNoise noise suppression, VAD
- **Stores** (`client/src/stores/`): Solid signals for auth, chat, voice, settings, DMs, user profiles (localStorage persistence)

### Tauri Desktop

- Native DXGI screen capture with H.264 encoding (OpenH264, optional NVENC via `native-nvenc` feature)
- RTP packetizer for sending native captures to mediasoup
- Plugins: notification, updater, opener

### WebSocket Protocol Contract

- Tagged JSON with `type` discriminator field
- First client message must be `type: "authenticate"`
- Server and client definitions must stay synchronized: `server/src/ws/messages.rs` ↔ `client/src/api/ws.ts`
- REST and WS representations must stay aligned for channels, messages, and voice presence

## Code Style

### Rust (`server/`, `client/src-tauri/`)

- `rustfmt` defaults, 4-space indent, trailing commas in multiline blocks
- Imports grouped: `std` → third-party → `crate::`/local
- Typed errors (`AppError`), propagate with `?`, log internals but return sanitized messages
- SQLx: bound parameters only, no string interpolation
- Shared state: `Arc<RwLock<...>>` with tight lock scopes
- Explicit serde rename attributes when wire names differ from Rust conventions

### TypeScript/SolidJS (`client/src/`)

- 2 spaces, semicolons, trailing commas in multiline
- Strict mode per `tsconfig.json`; avoid `any`, prefer `unknown` + narrowing
- `camelCase` for values/functions, `PascalCase` for components/types
- `import type` for type-only imports
- Keep backend `snake_case` fields in transport interfaces
- Clean up Solid effects/subscriptions properly

### Cross-Cutting

- Match existing patterns before introducing new abstractions
- Keep files under 500 lines; extract cohesive modules from large files
- Extract shared logic into reusable helpers instead of duplicating
- Keep changes small and composable; avoid opportunistic rewrites
- Preserve wire contracts (JSON field names, WS message types, enum strings)

## Git Conventions

- Conventional commit messages
- Do not create tags unless explicitly requested; when tagging, inspect existing tags first and use `vMAJOR.MINOR.PATCH` format
- Treat `PLAN.md` as roadmap, `PLAN-EXECUTION.md` as current-phase detail
- Put manual verification backlog in `QA.md`

## Environment Setup

- Rust stable, Node.js 18+, PostgreSQL 15+
- Linux Tauri deps: `webkit2gtk`, `rsvg2`
- mediasoup native build: Python 3, `invoke`, `meson`, `ninja`
- Server bootstrap: `cp server/.env.example server/.env`, set `DATABASE_URL`, `JWT_SECRET`, `SERVER_PASSWORD`
- Docker: `docker-compose.prod.yml` runs Postgres + Axum server + Caddy frontend
