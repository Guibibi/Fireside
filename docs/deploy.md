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
- `SITE_ADDRESS`
  - `:80` for plain HTTP
  - `chat.example.com` (or your domain) for automatic HTTPS in Caddy
- `WEBRTC_ANNOUNCED_IP` only when browser clients connect over the public internet and need voice/media
- `NATIVE_RTP_ANNOUNCED_IP` when Tauri desktop clients on other hosts use native screen share
- `STORAGE_BACKEND` and `STORAGE_LOCAL_ROOT` for media upload storage
- `CORS_ALLOWED_ORIGINS` for browser/desktop origin allowlist (comma-separated)
- `KLIPY_API_KEY` (optional) for GIF search via the Klipy API

Notes:

- `DATABASE_URL` must be set explicitly. If your DB username or password includes reserved URI characters (for example `@`, `:`, `/`, `?`, `#`), URL-encode those credential parts in the connection string. If you customize `POSTGRES_USER`, `POSTGRES_PASSWORD`, or `POSTGRES_DB`, keep the credentials and database name in `DATABASE_URL` in sync.
- Leaving `WEBRTC_ANNOUNCED_IP` empty or localhost is fine for local/private setups, but public internet voice traffic typically requires it set to a public IP or DNS name.
- For remote Tauri native screen share, set `NATIVE_RTP_ANNOUNCED_IP` to a reachable public IP and `NATIVE_RTP_LISTEN_IP=0.0.0.0`.
- Media uploads default to `STORAGE_BACKEND=local`; set `STORAGE_LOCAL_ROOT` to a durable path in production.
- `STORAGE_BACKEND=s3` is scaffolded for future S3/MinIO support but is not fully implemented in this phase.
- `HOST` defaults to `127.0.0.1` in the Docker production path to avoid exposing backend port `3000` publicly when using host networking.
- If you intentionally want the backend reachable directly from outside the VM, set `HOST=0.0.0.0` in `server/.env.docker` and restrict access with firewall rules.
- Set `CORS_ALLOWED_ORIGINS` to your deployed web origin(s) and include desktop origins when Tauri connects directly, for example `tauri://localhost,http://tauri.localhost,https://chat.example.com`.

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
- `server/Dockerfile` uses `cargo-chef` to cache Rust dependency builds between deploys when Cargo manifests remain unchanged.
- Keep `server/.env.docker` out of version control and rotate secrets regularly.
- For browser clients, HTTPS (`SITE_ADDRESS=<domain>`) is strongly recommended.

## Desktop Auto-Update Release Setup (Tauri)

`client/src-tauri/tauri.conf.json` includes an updater scaffold and the repository ships a release workflow at `.github/workflows/tauri-release.yml`.

- `plugins.updater.pubkey`
- `plugins.updater.endpoints[0]`
- `bundle.createUpdaterArtifacts=true`

The workflow is triggered by git tags matching `v*` and injects updater values from secrets at build time.

Required GitHub Actions secrets:

- `TAURI_UPDATER_PUBLIC_KEY`: public key content generated by `tauri signer generate`.
- `TAURI_SIGNING_PRIVATE_KEY`: private key content used to sign updater artifacts.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: passphrase for the private key (if set).

The release workflow pins the updater endpoint to:

- `https://github.com/<owner>/<repo>/releases/latest/download/latest.json`

Tag-and-release flow:

```bash
git tag v0.1.1
git push origin v0.1.1
```

The workflow builds signed desktop bundles, uploads signatures, and publishes `latest.json` for the updater plugin.

Windows NVENC release builds run on a self-hosted runner so CUDA and NVIDIA SDK are available.

Expected runner labels:

- `self-hosted`
- `Windows`
- `nvenc`

Required repository variables for that runner:

- `CUDA_PATH`: absolute path to CUDA toolkit root (must contain `bin/nvcc.exe`).
- `NVIDIA_VIDEO_CODEC_SDK_PATH`: absolute path to NVIDIA Video Codec SDK root.

For signed artifacts, export the private key when building:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat /secure/path/to/private.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
```

## Non-Docker Path (Legacy)

The repository still includes systemd-based deploy scripts:

- `scripts/bootstrap-ubuntu-vm.sh`
- `scripts/deploy-ovh.sh`

Use those only if you intentionally want host-level Node/Rust builds instead of the Docker-first workflow above.
