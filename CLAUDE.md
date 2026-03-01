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

Axum HTTP + WebSocket server with mediasoup-based SFU for WebRTC voice/video.

- **Routes** (`server/src/routes/`): auth, channels, messages, users, DMs, media uploads, reactions, embeds, invites, emojis, GIFs
- **WebSocket** (`server/src/ws/`): real-time messaging, presence, voice state, media signaling. Tagged JSON protocol with `type` discriminator.
- **Media** (`server/src/media/`): mediasoup workers/routers/transports/producers/consumers.
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

- Tauri host for desktop shell and plugin integrations
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

## Design Context

### Users
Small, trusted communities — friend groups, gaming circles, clubs, classrooms. They're choosing Fireside specifically because they want a private, self-hosted space away from corporate platforms. They're often mid-activity (gaming, watching, working together), so the interface should feel ambient and unobtrusive, not demanding attention.

### Brand Personality
**Cozy, private, honest.** Fireside is the warm room you retreat to with people you trust. No ads, no surveillance, no dark patterns. It should feel handcrafted and direct — like software made by someone who uses it, not a product team chasing metrics.

### Emotional Goals
**Safe & intimate.** Users should feel like they're in a private space with trusted friends — relaxed, unhurried, and in control. The interface should reduce anxiety, not create it. Comfort over excitement. Familiarity over novelty.

### Aesthetic Direction
- **Reference**: Discord's UX familiarity, but warmer, more human, less corporate
- **Anti-references**: Avoid Discord's cool blue-gray coldness, notification-anxiety patterns, and gamified badges. Avoid generic SaaS minimalism (all-white, blue primary, SF Pro).
- **Theme**: Dark mode only, warm charcoal palette with brown undertones (not blue-gray). Single terracotta accent (`#c9956b`). Sparse decoration, subtle shadows, reduced border radius.
- **Typography**: Geist for UI, IBM Plex Mono for code/metadata. Clear hierarchy without heaviness.

### Design Tokens (key references)
- Accent: `var(--accent)` (#c9956b terracotta) — use sparingly for primary actions and active states
- Backgrounds: `var(--gray-2)` inputs, `var(--gray-3)` sidebar, `var(--gray-4)` hover/raised surfaces
- Text: `var(--gray-12)` primary, `var(--gray-10)` secondary, `var(--gray-8)` muted
- Semantic: `var(--success)` sage, `var(--warning)` gold, `var(--danger)` rose, `var(--info)` sky
- Spacing: `--space-sm` (8px) through `--space-3xl` (40px)
- Radius: `--radius-sm` (4px) through `--radius-xl` (10px) — intentionally small

### Design Principles
1. **Warmth over flash** — Prefer warm neutrals and earth tones over cool blues or trendy gradients. If it looks like a startup dashboard, it's wrong.
2. **Ambient, not demanding** — UI elements should recede until needed. No pulsing notifications, no attention-grabbing chrome. The conversation is the product.
3. **Honest interactions** — Every hover, focus, and click state should be clear and predictable. No decorative animations that obscure intent. Transitions are functional, not theatrical.
4. **Small-scale craft** — This is software for small communities. Decisions should optimize for intimacy (readable names, human avatars, cozy spacing) not scale (infinite scroll optimizations, engagement metrics).
5. **Follow the existing system** — CSS variables, spacing tokens, and component patterns are already established. Extend them; don't override them. New UI should look like it was always there.

<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (90-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk vitest run          # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%)
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->