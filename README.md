# Yankcord

A minimal, self-hostable Discord alternative with text channels, voice chat, and video streaming.

## Architecture

Mono-repo with two independent projects:

- **`server/`** — Rust backend (Axum, SQLx/Postgres, mediasoup SFU, JWT auth)
- **`client/`** — Tauri v2 desktop app (SolidJS, mediasoup-client)

Communication happens over REST (CRUD operations) and a single WebSocket connection (real-time messaging + mediasoup signaling).

## Features

- User registration & login (argon2 password hashing, JWT tokens)
- Server (guild) creation, joining, and management
- Text and voice channels
- Real-time messaging over WebSocket
- Voice/video via mediasoup SFU (WebRTC)
- Catppuccin Mocha dark theme

## Prerequisites

- **Rust** (stable toolchain)
- **Node.js** (v18+) and npm
- **PostgreSQL** (15+)
- **Tauri v2 system dependencies** — see [Tauri prerequisites](https://tauri.app/start/prerequisites/) (webkit2gtk, rsvg2 on Linux)
- **Python 3** with `invoke`, `meson`, `ninja` packages (for mediasoup native build)

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
cd server
cp .env.example .env    # edit DATABASE_URL, JWT_SECRET, etc.
cargo run
```

The server runs migrations automatically on startup and listens on `http://localhost:3000`.

### Client

```bash
cd client
npm install
npm run tauri dev       # desktop app with hot-reload
# or just the web frontend:
npm run dev             # http://localhost:1420
```

## API Overview

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/register` | Create account |
| POST | `/api/login` | Get JWT token |
| GET | `/api/servers` | List joined servers |
| POST | `/api/servers` | Create server |
| GET | `/api/servers/:id` | Get server details |
| DELETE | `/api/servers/:id` | Delete server (owner only) |
| POST | `/api/servers/:id/join` | Join a server |
| GET | `/api/servers/:id/members` | List members |
| GET | `/api/servers/:id/channels` | List channels |
| POST | `/api/servers/:id/channels` | Create channel |
| GET | `/api/channels/:id` | Get channel |
| DELETE | `/api/channels/:id` | Delete channel |
| GET | `/api/channels/:id/messages` | Get messages (paginated) |
| POST | `/api/channels/:id/messages` | Send message |

### WebSocket

Connect to `ws://localhost:3000/ws`. First message must authenticate:

```json
{ "type": "authenticate", "token": "<jwt>" }
```

Then send/receive messages:

```json
{ "type": "send_message", "channel_id": "<uuid>", "content": "hello" }
{ "type": "join_voice", "channel_id": "<uuid>" }
{ "type": "leave_voice", "channel_id": "<uuid>" }
{ "type": "media_signal", "channel_id": "<uuid>", "payload": { ... } }
```

## Configuration

The server can be configured via environment variables (`.env`) or a TOML file (`config.toml`). See `.env.example` and `config.toml.example` for all options.

Production VM planning and network checklist: `docs/deploy.md`.

## Project Structure

```
yankcord/
├── server/
│   ├── Cargo.toml
│   ├── migrations/          # SQLx migrations (auto-run)
│   └── src/
│       ├── main.rs          # Entry point, router, AppState
│       ├── auth.rs          # Argon2 hashing, JWT
│       ├── config.rs        # Env/TOML config loading
│       ├── errors.rs        # AppError -> HTTP response
│       ├── models.rs        # User, Server, Channel, Message
│       ├── routes/          # REST handlers
│       ├── ws/              # WebSocket upgrade + message loop
│       └── media/           # mediasoup worker pool + codecs
└── client/
    ├── src-tauri/           # Tauri Rust side
    └── src/
        ├── index.tsx        # Router setup
        ├── App.tsx          # Root layout
        ├── api/             # REST, WebSocket, mediasoup clients
        ├── pages/           # Login, Register, ServerView
        ├── components/      # Sidebar, ChannelList, MessageArea, etc.
        ├── stores/          # SolidJS signal-based auth state
        └── styles/          # Global CSS (Catppuccin Mocha)
```

## Database Schema

- **users** — id, username, password_hash, display_name, avatar_url
- **servers** — id, name, owner_id, icon_url
- **channels** — id, server_id, name, kind (text/voice), position
- **messages** — id, channel_id, author_id, content (indexed by channel + created_at DESC)
- **server_members** — server_id, user_id, joined_at

## License

MIT
