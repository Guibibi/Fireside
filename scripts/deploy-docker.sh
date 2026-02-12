#!/usr/bin/env bash

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/yankcord}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-server/.env.docker}"
UPDATE_REPO="${UPDATE_REPO:-true}"
BUILD_IMAGES="${BUILD_IMAGES:-true}"

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

require_cmd git
require_cmd docker

if ! docker compose version >/dev/null 2>&1; then
  echo "Missing docker compose plugin" >&2
  exit 1
fi

if [[ ! -d "${REPO_DIR}" ]]; then
  echo "Repository directory not found: ${REPO_DIR}" >&2
  exit 1
fi

if [[ ! -f "${REPO_DIR}/${COMPOSE_FILE}" ]]; then
  echo "Compose file not found: ${REPO_DIR}/${COMPOSE_FILE}" >&2
  exit 1
fi

if [[ ! -f "${REPO_DIR}/${ENV_FILE}" ]]; then
  echo "Env file not found: ${REPO_DIR}/${ENV_FILE}" >&2
  echo "Copy server/.env.docker.example to ${ENV_FILE} and fill secrets first." >&2
  exit 1
fi

echo "==> Docker deploy from ${REPO_DIR}"

cd "${REPO_DIR}"

if is_true "${UPDATE_REPO}"; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Repository has local changes. Refusing to deploy with a dirty worktree." >&2
    exit 1
  fi

  CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  echo "==> Updating branch ${CURRENT_BRANCH}"
  git fetch --all --prune
  git pull --ff-only
fi

if is_true "${BUILD_IMAGES}"; then
  echo "==> Building images"
  ${SUDO} docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" build
fi

echo "==> Starting containers"
${SUDO} docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d

echo "==> Container status"
${SUDO} docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps

echo "==> Recent backend logs"
${SUDO} docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" logs --tail=60 server

echo "==> Deploy complete"
