# Fireside

Fireside is a self-hosted Discord alternative for smaller groups of friends and people you trust.

You run one private server for one community, share a URL and password with invited people, and chat without public discovery, email signup, or platform lock-in.
There currently no roles or permissions, so make sure that only people you trust join your instance.
> [!WARNING]
> To accelerate the move away from Discord, AI assistance was used in parts of the codebase.
> Going forward, this project will be maintained with a lower reliance on AI.

## Screenshot

![Fireside homepage screenshot](screenshots/homepage-screenshot.png)

## Who It Is For

- Friend groups and gaming communities
- Clubs, classrooms, and small internal teams
- Anyone who wants a private "our own server" setup

## What You Get

- Real-time text channels
- Voice and video chat
- Presence and typing indicators
- Lightweight join flow (server URL + password + username)
- Self-hosted deployment on infrastructure you control

## Quick Start

### 1) Prepare environment

```bash
cp server/.env.docker.example server/.env.docker
```

Edit `server/.env.docker` and set at minimum:

- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `JWT_SECRET`
- `SITE_ADDRESS`

### 2) Start the full stack with Docker Compose

```bash
docker compose --env-file server/.env.docker -f docker-compose.prod.yml up -d --build
```

This starts `postgres`, `server`, and `web` together.

### 3) Open Fireside

- If `SITE_ADDRESS=:80`, open `http://<your-host-ip>`
- If `SITE_ADDRESS` is a domain, open `https://<your-domain>`

Check status/logs:

```bash
docker compose --env-file server/.env.docker -f docker-compose.prod.yml ps
docker compose --env-file server/.env.docker -f docker-compose.prod.yml logs --tail=100 server
docker compose --env-file server/.env.docker -f docker-compose.prod.yml logs --tail=100 web
```

Stop the stack:

```bash
docker compose --env-file server/.env.docker -f docker-compose.prod.yml down
```

## Deployment

For production setup and release notes, see `docs/deploy.md`.

## License

MIT
