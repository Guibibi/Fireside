#!/usr/bin/env bash

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/yankcord}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-server/.env.docker}"
UPDATE_REPO="${UPDATE_REPO:-true}"
PULL_IMAGES="${PULL_IMAGES:-true}"
BUILD_IMAGES="${BUILD_IMAGES:-true}"
EXPECTED_BRANCH="${EXPECTED_BRANCH:-main}"
ALLOW_NON_MAIN_DEPLOY="${ALLOW_NON_MAIN_DEPLOY:-false}"

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

read_env_value() {
  local key="$1"
  local file_path="$2"

  awk -F= -v env_key="${key}" '
    /^[[:space:]]*#/ { next }
    NF < 1 { next }
    $1 == env_key {
      value = substr($0, index($0, "=") + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      print value
    }
  ' "${file_path}" | tail -n 1
}

require_secret_value() {
  local key="$1"
  local file_path="$2"
  local value
  local normalized_value

  value="$(read_env_value "${key}" "${file_path}")"
  normalized_value="${value}"

  if [[ "${normalized_value}" == \"*\" && "${normalized_value}" == *\" ]]; then
    normalized_value="${normalized_value:1:-1}"
  fi

  if [[ "${normalized_value}" == \'*\' && "${normalized_value}" == *\' ]]; then
    normalized_value="${normalized_value:1:-1}"
  fi

  if [[ -z "${normalized_value}" ]]; then
    echo "${key} is missing in ${file_path}" >&2
    exit 1
  fi

  case "${normalized_value,,}" in
    change-me|replace-with-*|password|secret)
      echo "${key} still uses a placeholder in ${file_path}" >&2
      exit 1
      ;;
  esac
}

warn_if_unset_or_localhost() {
  local key="$1"
  local file_path="$2"
  local value

  value="$(read_env_value "${key}" "${file_path}")"

  if [[ -z "${value}" || "${value}" == "127.0.0.1" || "${value}" == "localhost" ]]; then
    echo "Warning: ${key} is empty or local in ${file_path}." >&2
    echo "         Public voice calls require ${key} set to public IP or DNS." >&2
  fi
}

require_cmd docker

if ! ${SUDO} docker compose version >/dev/null 2>&1; then
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
  require_cmd git

  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Repository has local changes. Refusing to deploy with a dirty worktree." >&2
    exit 1
  fi

  CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  if [[ "${CURRENT_BRANCH}" != "${EXPECTED_BRANCH}" ]] && ! is_true "${ALLOW_NON_MAIN_DEPLOY}"; then
    echo "Refusing to update branch '${CURRENT_BRANCH}'. Expected '${EXPECTED_BRANCH}'." >&2
    echo "Set EXPECTED_BRANCH to change the expected branch or ALLOW_NON_MAIN_DEPLOY=true to bypass this check." >&2
    exit 1
  fi

  echo "==> Updating branch ${CURRENT_BRANCH}"
  git fetch --all --prune
  git pull --ff-only
fi

echo "==> Validating deployment env"
require_secret_value "POSTGRES_PASSWORD" "${ENV_FILE}"
require_secret_value "JWT_SECRET" "${ENV_FILE}"
warn_if_unset_or_localhost "WEBRTC_ANNOUNCED_IP" "${ENV_FILE}"

echo "==> Validating compose configuration"
${SUDO} docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" config >/dev/null

if is_true "${PULL_IMAGES}"; then
  echo "==> Pulling base images"
  ${SUDO} docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" pull
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
