# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Yankcord is a minimal, self-hostable Discord alternative with text channels, voice chat, and video streaming. It's a monorepo with two independent projects:

- **server/** — Rust backend (Axum 0.8, PostgreSQL via SQLx, WebSocket, mediasoup for WebRTC)
- **client/** — Desktop app (Tauri v2 + SolidJS + TypeScript, Vite bundler)

## Development Commands

### Server (Rust)
```bash
cd server
cp .env.example .env          # first-time setup
cargo run                     # start dev server on http://localhost:3000
cargo build --release         # release build
cargo test                    # run tests
```

Requires PostgreSQL 15+. Migrations auto-run on startup from `migrations/`.

### Client (Tauri + SolidJS)
```bash
cd client
npm install                   # install dependencies
npm run dev                   # Vite dev server on http://localhost:1420
npm run tauri dev             # Tauri desktop app with hot-reload
npm run build                 # production build
```

Requires Rust toolchain, Node.js 18+, and Tauri v2 system dependencies (webkit2gtk, rsvg2 on Linux). mediasoup build needs Python 3 with `invoke`, `meson`, `ninja`.

## Architecture

### Backend

- **main.rs** — Axum router setup, AppState (PgPool + MediaService), CORS config
- **auth.rs** — JWT creation/validation + Argon2 password hashing (no auth middleware; each route extracts Bearer token manually)
- **config.rs** — Loads from env vars with optional TOML override (`CONFIG_PATH`)
- **errors.rs** — `AppError` enum implementing `IntoResponse` for automatic JSON error responses
- **models.rs** — Shared data models with `sqlx::FromRow` derives
- **routes/** — REST endpoints under `/api` (auth_routes, server_routes, channel_routes)
- **ws/** — Single `/ws` endpoint; first message must be `authenticate`; tag-based JSON message routing (`#[serde(tag = "type")]`)
- **media/** — mediasoup SFU with worker pool; per-channel routers behind `Arc<Mutex<>>`. Transport/Producer/Consumer are stubs (WIP)

### Frontend

- **SolidJS** with fine-grained reactivity (Signals, not React-style hooks)
- **stores/auth.ts** — Auth state backed by localStorage
- **api/http.ts** — Fetch wrapper with automatic JWT Bearer injection
- **api/ws.ts** — WebSocket singleton with observer pattern for message handlers
- **api/media.ts** — mediasoup-client integration (stub)
- **pages/** — Login, Register, ServerView (main 4-column layout: Sidebar | ChannelList | MessageArea | MemberList)
- **styles/global.css** — Catppuccin Mocha dark theme

### Database Schema

PostgreSQL with tables: `users`, `servers`, `channels`, `messages`, `server_members`. Compile-time checked SQL via SQLx macros. Messages indexed on `(channel_id, created_at DESC)`.

### WebSocket Protocol

Connect to `ws://localhost:3000/ws`. Authenticate first, then send/receive JSON messages with `"type"` field for routing. Supports: messaging, voice join/leave, media signaling.

## Key Conventions

- Raw SQL with `sqlx::query!` / `sqlx::query_as!` macros (compile-time checked) — no ORM
- UUIDs (v4) for all entity IDs
- CORS is allow-all (self-hosted assumption)
- Tauri CSP restricts external resources; WebSocket allowed to localhost:3000
- Voice/video media module is architecturally ready but partially stubbed
