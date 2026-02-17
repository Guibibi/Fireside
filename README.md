# Yankcord

Yankcord is a self-hosted Discord alternative for smaller groups of friends and people you trust.

You run one private server for one community, share a URL and password with invited people, and chat without public discovery, email signup, or platform lock-in.

## Who It Is For

- Friend groups and gaming communities
- Clubs, classrooms, and small internal teams
- Anyone who wants a private "our own server" setup

## What You Get

- Real-time text channels
- Voice, video, and screen share
- Presence and typing indicators
- Lightweight join flow (server URL + password + username)
- Self-hosted deployment on infrastructure you control

## Quick Start

### 1) Start PostgreSQL

```bash
createdb yankcord
```

Or run Postgres in Docker:

```bash
docker run -d --name yankcord-db \
  -e POSTGRES_USER=yankcord \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=yankcord \
  -p 5432:5432 postgres:15
```

### 2) Start the server

```bash
cp server/.env.example server/.env
# set DATABASE_URL, JWT_SECRET, SERVER_PASSWORD
cargo run --manifest-path server/Cargo.toml
```

By default the server runs on `http://localhost:3000`.

### 3) Start the client

```bash
npm --prefix client install
npm --prefix client run tauri dev
```

Web-only dev mode:

```bash
npm --prefix client run dev
```

## Deployment

For production setup and release notes, see `docs/deploy.md`.

## License

MIT
