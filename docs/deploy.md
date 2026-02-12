# Deployment Plan (VM)

This document outlines a practical path to host Yankcord on a VM for real users.

## Goals

- Run API/WebSocket + media services on a public VM.
- Serve the client over HTTPS.
- Keep text + voice stable across real-world networks.
- Add observability, backups, and safe rollout practices.

## Recommended Rollout

### Phase 1: Single-VM baseline

- Provision an Ubuntu VM with a static public IP.
- Create DNS records (example: `chat.example.com`).
- Install PostgreSQL 15+, Rust stable, Node 18+.
- Run app processes with systemd (or Docker Compose).
- Keep app reachable only behind reverse proxy where possible.

### Phase 2: TLS + reverse proxy

- Put Nginx/Caddy in front of backend + static client.
- Enable HTTPS (Let's Encrypt).
- Route:
  - `https://chat.example.com/` -> static client build
  - `https://chat.example.com/api/*` -> backend HTTP
  - `wss://chat.example.com/ws` -> backend WebSocket

### Phase 3: WebRTC networking hardening

- Set `WEBRTC_LISTEN_IP=0.0.0.0`.
- Set `WEBRTC_ANNOUNCED_IP` to a reachable public IP/DNS.
- Open UDP media ports in cloud + host firewall.
- Add TURN later for restrictive NAT/mobile/corporate networks.

### Phase 4: Operations

- Centralize logs (journal + shipping optional).
- Add health checks and restart policies.
- Add Postgres backups and restore drills.
- Define staging -> production release flow.

## Current Environment Variables (Implemented)

These are loaded now by `server/src/config.rs`:

- `DATABASE_URL` (required)
- `JWT_SECRET` (required)
- `JWT_EXPIRATION_HOURS` (default `24`)
- `SERVER_PASSWORD` (required)
- `HOST` (default `0.0.0.0`)
- `PORT` (default `3000`)
- `MEDIA_WORKER_COUNT` (default `2`)
- `WEBRTC_LISTEN_IP` (default `0.0.0.0`)
- `WEBRTC_ANNOUNCED_IP` (optional)
- `RUST_LOG` (runtime logging level)

## Environment Schema To Add Before Real Public Usage

These are not implemented yet, but are recommended for production reliability.

### Network and origin control

- `CORS_ALLOWED_ORIGINS` (CSV of allowed origins)
  - Example: `https://chat.example.com,https://staging-chat.example.com`
  - Why: replace permissive `Any` CORS in production.

### Media transport controls

- `WEBRTC_UDP_PORT_MIN` (example `40000`)
- `WEBRTC_UDP_PORT_MAX` (example `40100`)
- `WEBRTC_ENABLE_TCP` (`true`/`false`, default `true`)
- `WEBRTC_PREFER_UDP` (`true`/`false`, default `true`)
  - Why: fixed firewall rules + fallback for UDP-blocked networks.

### TURN integration

- `WEBRTC_ICE_SERVERS_JSON` (JSON array)
  - Example:
    ```json
    [{"urls":["stun:stun.l.google.com:19302"]},{"urls":["turn:turn.example.com:3478?transport=udp"],"username":"user","credential":"pass"}]
    ```
  - Why: improve connectivity where direct ICE fails.

## Code Changes Needed For The New Schema

### `server/src/config.rs`

- Add fields for CORS origins, media port range, TCP/UDP toggles, and optional ICE config passthrough.
- Parse and validate values with clear startup errors.

### `server/src/main.rs`

- Replace `CorsLayer::allow_origin(Any)` with allowlist from config.

### `server/src/media/mod.rs` and `server/src/media/transport.rs`

- Build `WebRtcTransportListenInfos` using configured UDP/TCP settings.
- Apply explicit media port range.

### `client/src/api/media.ts`

- Accept ICE server config from backend signaling/config endpoint and pass to transport setup where relevant.

### `server/.env.example` and `server/config.toml.example`

- Add and document new production-focused variables.

## VM Firewall/Ports Checklist

- Public ingress:
  - `80/tcp` (optional redirect)
  - `443/tcp` (HTTPS + WSS)
  - media UDP range (example `40000-40100/udp`)
  - optional media TCP range if TCP media is enabled
- Internal-only:
  - `5432/tcp` should not be publicly exposed unless intentionally managed.

## Validation Checklist Before Inviting Users

- HTTPS works for client and API.
- WebSocket auth succeeds over `wss://`.
- Two remote users can join same voice room and hear each other.
- Voice still works when one user is on mobile data/hotspot.
- Logs show no recurrent media transport errors.
- Backup and restore of Postgres verified.

## Deployment Helper Script

`scripts/deploy-ovh.sh` automates pull/build/restart on VM.

- Default run:
  - `bash scripts/deploy-ovh.sh`
- Expected defaults:
  - repo at `/opt/yankcord`
  - backend systemd service `yankcord-server`
  - reverse proxy systemd service `caddy`
- Useful overrides:
  - `REPO_DIR=/srv/yankcord`
  - `SERVER_SERVICE=yankcord-server`
  - `CADDY_SERVICE=caddy`
  - `UPDATE_REPO=false` (skip fetch/pull)
  - `BUILD_CLIENT=false` (skip npm install/build)
  - `BUILD_SERVER=false` (skip cargo build)
  - `RELOAD_CADDY=false` (skip caddy reload)
  - `START_POSTGRES=true` (run `postgres` from `server/docker-compose.yml`)
  - `POSTGRES_COMPOSE_FILE=server/docker-compose.yml` (custom compose path)

Example with Docker-managed Postgres:

```bash
START_POSTGRES=true bash scripts/deploy-ovh.sh
```

The script aborts if the repo worktree is dirty while `UPDATE_REPO=true` to avoid broken fast-forward pulls during deploy.

## Ubuntu VM Bootstrap Script

`scripts/bootstrap-ubuntu-vm.sh` installs runtime dependencies and writes systemd/Caddy templates.

- Default run:
  - `bash scripts/bootstrap-ubuntu-vm.sh`
- What it does:
  - installs base build tools
  - installs Node.js 20 (if Node 18+ is not present)
  - installs Rust toolchain for deploy user (if missing)
  - installs Caddy and writes a Yankcord `Caddyfile`
  - writes `/etc/systemd/system/yankcord-server.service`
- Useful overrides:
  - `DEPLOY_USER=ubuntu`
  - `REPO_DIR=/opt/yankcord`
  - `SITE_ADDRESS=chat.example.com` (required for automatic HTTPS)
  - `SERVER_PORT=3000`
  - `INSTALL_CADDY=false`
  - `WRITE_CADDYFILE=false`
  - `INSTALL_DOCKER=true` (optional if Docker is not already installed)

Example:

```bash
DEPLOY_USER=ubuntu REPO_DIR=/opt/yankcord SITE_ADDRESS=chat.example.com bash scripts/bootstrap-ubuntu-vm.sh
```

After bootstrap, clone/pull the repo into `REPO_DIR`, set `server/.env`, then deploy with `scripts/deploy-ovh.sh`.
