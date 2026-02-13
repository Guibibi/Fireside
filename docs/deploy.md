# Deployment (Docker-first)

This guide is the recommended production path for running Yankcord on a single VM.

The stack uses Docker Compose and includes:

- `postgres` (`postgres:15-alpine`)
- `server` (Axum/WebSocket/media backend)
- `web` (Caddy serving `client/dist` and proxying `/api` + `/ws`)

## Quickstart

### 1) Prerequisites

- Linux VM with a public IP (Ubuntu recommended)
- Docker Engine + Docker Compose plugin
- Open firewall ports:
  - `80/tcp` and `443/tcp` for web traffic
  - UDP media ports required by your voice policy

Optional helper to install Docker on Ubuntu:

```bash
INSTALL_DOCKER=true INSTALL_NODE=false INSTALL_RUST=false INSTALL_CADDY=false WRITE_CADDYFILE=false bash scripts/bootstrap-ubuntu-vm.sh
```

This helper installs Docker plus baseline VM tooling and also writes legacy systemd deploy artifacts.

### 2) Prepare environment

```bash
cp server/.env.docker.example server/.env.docker
```

Edit `server/.env.docker` and set at minimum:

- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `JWT_SECRET`
- `SERVER_PASSWORD`
- `SITE_ADDRESS`
  - `:80` for plain HTTP
  - `chat.example.com` (or your domain) for automatic HTTPS in Caddy
- `WEBRTC_ANNOUNCED_IP` only when browser clients connect over the public internet and need voice/media
- `NATIVE_RTP_ANNOUNCED_IP` when Tauri desktop clients on other hosts use native screen share

Notes:

- `DATABASE_URL` must be set explicitly. If your DB username or password includes reserved URI characters (for example `@`, `:`, `/`, `?`, `#`), URL-encode those credential parts in the connection string. If you customize `POSTGRES_USER`, `POSTGRES_PASSWORD`, or `POSTGRES_DB`, keep the credentials and database name in `DATABASE_URL` in sync.
- Leaving `WEBRTC_ANNOUNCED_IP` empty or localhost is fine for local/private setups, but public internet voice traffic typically requires it set to a public IP or DNS name.
- For remote Tauri native screen share, set `NATIVE_RTP_ANNOUNCED_IP` to a reachable public IP and `NATIVE_RTP_LISTEN_IP=0.0.0.0`.
- `HOST` defaults to `127.0.0.1` in the Docker production path to avoid exposing backend port `3000` publicly when using host networking.
- If you intentionally want the backend reachable directly from outside the VM, set `HOST=0.0.0.0` in `server/.env.docker` and restrict access with firewall rules.

### 3) Deploy

From the repo root:

```bash
REPO_DIR=/opt/yankcord bash scripts/deploy-docker.sh
```

The script:

- optionally updates the repo (`UPDATE_REPO=true` default)
- validates required secrets in `server/.env.docker`
- validates compose config
- pulls/builds images
- starts containers and prints status/logs

Useful overrides:

- `UPDATE_REPO=false` - skip `git fetch/pull`
- `EXPECTED_BRANCH=release` - change the branch allowed for repo updates (default: `main`)
- `ALLOW_NON_MAIN_DEPLOY=true` - bypass branch guard when `UPDATE_REPO=true`
- `PULL_IMAGES=false` - skip pulling base images
- `BUILD_IMAGES=false` - skip local rebuild
- `ENV_FILE=server/.env.docker` - custom env file path
- `COMPOSE_FILE=docker-compose.prod.yml` - custom compose path

## Day-2 Operations

If your user is not in the `docker` group, prefix the `docker compose` commands below with `sudo`.

### Check status

```bash
docker compose --env-file server/.env.docker -f docker-compose.prod.yml ps
docker compose --env-file server/.env.docker -f docker-compose.prod.yml logs --tail=100 server
docker compose --env-file server/.env.docker -f docker-compose.prod.yml logs --tail=100 web
```

### Roll out updates

```bash
REPO_DIR=/opt/yankcord bash scripts/deploy-docker.sh
```

### Stop stack

```bash
docker compose --env-file server/.env.docker -f docker-compose.prod.yml down
```

### Backup Postgres

```bash
docker compose --env-file server/.env.docker -f docker-compose.prod.yml exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup.sql
```

Run restore drills in a non-production environment before relying on backups.

## Production Notes

- `docker-compose.prod.yml` binds PostgreSQL on `127.0.0.1:5432` to avoid exposing it publicly.
- `server` and `web` use `network_mode: host` so media and reverse-proxy networking remain predictable on a single VM; backend HTTP bind remains loopback by default unless you override `HOST`.
- Keep `server/.env.docker` out of version control and rotate secrets regularly.
- For browser clients, HTTPS (`SITE_ADDRESS=<domain>`) is strongly recommended.

## Non-Docker Path (Legacy)

The repository still includes systemd-based deploy scripts:

- `scripts/bootstrap-ubuntu-vm.sh`
- `scripts/deploy-ovh.sh`

Use those only if you intentionally want host-level Node/Rust builds instead of the Docker-first workflow above.
