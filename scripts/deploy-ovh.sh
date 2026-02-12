#!/usr/bin/env bash

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/yankcord}"
SERVER_SERVICE="${SERVER_SERVICE:-yankcord-server}"
CADDY_SERVICE="${CADDY_SERVICE:-caddy}"
RELOAD_CADDY="${RELOAD_CADDY:-true}"
UPDATE_REPO="${UPDATE_REPO:-true}"
BUILD_CLIENT="${BUILD_CLIENT:-true}"
BUILD_SERVER="${BUILD_SERVER:-true}"
START_POSTGRES="${START_POSTGRES:-false}"
POSTGRES_COMPOSE_FILE="${POSTGRES_COMPOSE_FILE:-server/docker-compose.yml}"

if [[ "${EUID}" -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

require_cmd() {
  local cmd="$1"
  if ! command_exists "${cmd}"; then
    echo "Missing required command: ${cmd}" >&2
    exit 1
  fi
}

is_true() {
  case "${1,,}" in
    true|1|yes|y|on) return 0 ;;
    *) return 1 ;;
  esac
}

docker_compose_cmd() {
  if command_exists docker && docker compose version >/dev/null 2>&1; then
    printf 'docker compose'
    return 0
  fi

  if command_exists docker-compose; then
    printf 'docker-compose'
    return 0
  fi

  return 1
}

require_cmd git
require_cmd systemctl

if is_true "${BUILD_CLIENT}"; then
  require_cmd npm
fi

if is_true "${BUILD_SERVER}"; then
  require_cmd cargo
fi

if is_true "${START_POSTGRES}"; then
  require_cmd docker
  if ! docker_compose_cmd >/dev/null; then
    echo "Missing required command: docker compose (plugin) or docker-compose" >&2
    exit 1
  fi
fi

if [[ ! -d "${REPO_DIR}" ]]; then
  echo "Repository directory not found: ${REPO_DIR}" >&2
  echo "Set REPO_DIR if your repo is elsewhere." >&2
  exit 1
fi

if [[ ! -f "${REPO_DIR}/server/Cargo.toml" ]]; then
  echo "server/Cargo.toml not found under ${REPO_DIR}" >&2
  exit 1
fi

if is_true "${BUILD_CLIENT}" && [[ ! -f "${REPO_DIR}/client/package.json" ]]; then
  echo "client/package.json not found under ${REPO_DIR}" >&2
  exit 1
fi

echo "==> Deploying Yankcord from ${REPO_DIR}"

cd "${REPO_DIR}"

if is_true "${UPDATE_REPO}"; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Repository has local changes. Refusing to deploy with a dirty worktree." >&2
    echo "Commit/stash local changes or set UPDATE_REPO=false if intentional." >&2
    exit 1
  fi

  CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  echo "==> Updating branch ${CURRENT_BRANCH}"
  git fetch --all --prune
  git pull --ff-only
else
  echo "==> Skipping repo update (UPDATE_REPO=${UPDATE_REPO})"
fi

if is_true "${START_POSTGRES}"; then
  COMPOSE_BIN="$(docker_compose_cmd)"
  if [[ ! -f "${REPO_DIR}/${POSTGRES_COMPOSE_FILE}" ]]; then
    echo "Compose file not found: ${REPO_DIR}/${POSTGRES_COMPOSE_FILE}" >&2
    exit 1
  fi

  echo "==> Starting PostgreSQL via ${POSTGRES_COMPOSE_FILE}"
  ${COMPOSE_BIN} -f "${REPO_DIR}/${POSTGRES_COMPOSE_FILE}" up -d postgres
fi

if is_true "${BUILD_CLIENT}"; then
  echo "==> Installing client dependencies"
  if [[ -f "${REPO_DIR}/client/package-lock.json" ]]; then
    npm --prefix client ci
  else
    npm --prefix client install
  fi

  echo "==> Building client"
  npm --prefix client run build
else
  echo "==> Skipping client build (BUILD_CLIENT=${BUILD_CLIENT})"
fi

if is_true "${BUILD_SERVER}"; then
  echo "==> Building server"
  cargo build --release --manifest-path server/Cargo.toml
else
  echo "==> Skipping server build (BUILD_SERVER=${BUILD_SERVER})"
fi

echo "==> Restarting backend service (${SERVER_SERVICE})"
${SUDO} systemctl restart "${SERVER_SERVICE}"

if is_true "${RELOAD_CADDY}"; then
  echo "==> Reloading ${CADDY_SERVICE}"
  ${SUDO} systemctl reload "${CADDY_SERVICE}"
else
  echo "==> Skipping ${CADDY_SERVICE} reload (RELOAD_CADDY=${RELOAD_CADDY})"
fi

echo "==> Service status"
${SUDO} systemctl --no-pager --full --lines=20 status "${SERVER_SERVICE}"
if is_true "${RELOAD_CADDY}"; then
  ${SUDO} systemctl --no-pager --full --lines=20 status "${CADDY_SERVICE}"
fi

echo "==> Deploy complete"
