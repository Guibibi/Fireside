# Yankcord

Yankcord is a minimal, self-hostable Discord alternative focused on a single community per server instance.

Users connect with a server URL, shared server password, and username. No signup flow, email, or multi-server directory.

## Architecture

This monorepo contains two apps:

- **`server/`** - Rust backend (Axum, SQLx/Postgres, mediasoup SFU, JWT auth)
- **`client/`** - Tauri v2 desktop client (SolidJS + TypeScript + mediasoup-client)

Communication uses REST for CRUD and a single WebSocket connection for realtime messaging, presence, voice/video signaling, and mediasoup transport events.

## Features

- Single-community auth via `POST /api/connect` (server password + username)
- Real-time text chat with channel subscriptions
- Channel create/delete with live updates
- Message edit/delete with live updates
- Typing indicators and connected-user presence
- Channel-scoped voice/video/screen share via mediasoup SFU
- Native desktop screen-share sender path (Tauri host) with browser fallback
- User settings update endpoint and client-side settings UI

## Screen Share Codecs

- Current stack includes `VP8`, `H264`, `VP9`, and `AV1` router capabilities
- Browser screen share prefers `AV1 -> VP9 -> H264` on Windows when available
- In SFU mode there is no server-side transcoding; viewers must support negotiated sender codec
- `H265/HEVC` remains intentionally unsupported
- Hardware acceleration (including NVENC on native sender path) depends on runtime/webview/GPU/driver availability

## Prerequisites

- **Rust** stable toolchain
- **Node.js** 18+ and npm
- **PostgreSQL** 15+
- **Tauri v2 Linux deps** (`webkit2gtk`, `rsvg2`) - see [Tauri prerequisites](https://tauri.app/start/prerequisites/)
- **Python 3** with `invoke`, `meson`, and `ninja` (for mediasoup native build)

## Getting Started

### Database

```bash
createdb yankcord
# or with Docker:
docker run -d --name yankcord-db \
  -e POSTGRES_USER=yankcord \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=yankcord \
  -p 5432:5432 postgres:15
```

### Server

```bash
cp server/.env.example server/.env
# edit server/.env: DATABASE_URL, JWT_SECRET, SERVER_PASSWORD
cargo run --manifest-path server/Cargo.toml
```

The server auto-runs SQL migrations on startup and listens on `http://localhost:3000` by default.

### Client

```bash
npm --prefix client install
npm --prefix client run tauri dev
# web-only dev mode:
npm --prefix client run dev
```

## API Overview

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/connect` | Authenticate with server password + username |
| GET | `/api/channels` | List channels |
| POST | `/api/channels` | Create channel |
| GET | `/api/channels/:channel_id` | Get channel |
| DELETE | `/api/channels/:channel_id` | Delete channel |
| GET | `/api/channels/:channel_id/messages` | Get channel messages |
| POST | `/api/channels/:channel_id/messages` | Send message |
| PATCH | `/api/messages/:message_id` | Edit message (author only) |
| DELETE | `/api/messages/:message_id` | Delete message (author only) |
| GET | `/api/users` | List users |
| PATCH | `/api/users/me` | Update current username and refresh token |

### WebSocket

Connect to `ws://localhost:3000/ws`. The first client message must authenticate:

```json
{ "type": "authenticate", "token": "<jwt>" }
```

Common client message types include:

```json
{ "type": "subscribe_channel", "channel_id": "<uuid>" }
{ "type": "send_message", "channel_id": "<uuid>", "content": "hello" }
{ "type": "typing_start", "channel_id": "<uuid>" }
{ "type": "typing_stop", "channel_id": "<uuid>" }
{ "type": "join_voice", "channel_id": "<uuid>" }
{ "type": "leave_voice", "channel_id": "<uuid>" }
{ "type": "media_signal", "channel_id": "<uuid>", "payload": { "...": "..." } }
```

Server events include `new_message`, `message_edited`, `message_deleted`, `channel_created`, `channel_deleted`, `presence_snapshot`, `voice_presence_snapshot`, and `media_signal`.

## Configuration

Server config can be supplied via environment (`server/.env`) or `server/config.toml`.

At minimum for local dev, set:

- `DATABASE_URL`
- `JWT_SECRET`
- `SERVER_PASSWORD`

Deployment/network checklist: `docs/deploy.md`.

## Project Structure

```text
yankcord/
├── server/
│   ├── Cargo.toml
│   ├── migrations/          # SQLx migrations (auto-run)
│   └── src/
│       ├── main.rs          # Axum app wiring + state + startup
│       ├── auth.rs          # JWT helpers
│       ├── config.rs        # Env/TOML config loading
│       ├── errors.rs        # AppError to HTTP responses
│       ├── models.rs        # Channel, Message, User models
│       ├── routes/          # REST route handlers
│       ├── ws/              # WebSocket message loop + broadcast
│       └── media/           # mediasoup workers/transports/signaling
└── client/
    ├── src-tauri/           # Tauri host app (Rust, native capture)
    └── src/
        ├── index.tsx        # App entry + routing
        ├── api/             # HTTP/WS/media clients
        ├── pages/           # Connect and chat views
        ├── components/      # Channel/message/member/voice UI
        ├── stores/          # Auth + voice state
        └── styles/          # Global styles
```

## Database Schema

- **users** - `id`, `username`, `display_name`, `avatar_url`, `created_at`
- **channels** - `id`, `name`, `kind` (`text`/`voice`), `position`, `created_at`
- **messages** - `id`, `channel_id`, `author_id`, `content`, `created_at`, `edited_at`

## Validation Commands

- Backend: `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
- Backend: `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
- Backend: `cargo test --manifest-path server/Cargo.toml`
- Frontend: `npm --prefix client run typecheck`
- Frontend: `npm --prefix client run build`

## License

MIT
