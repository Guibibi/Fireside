#!/usr/bin/env bash

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/yankcord}"
DEPLOY_USER="${DEPLOY_USER:-${SUDO_USER:-$USER}}"
SITE_ADDRESS="${SITE_ADDRESS:-:80}"
SERVER_PORT="${SERVER_PORT:-3000}"

INSTALL_NODE="${INSTALL_NODE:-true}"
INSTALL_RUST="${INSTALL_RUST:-true}"
INSTALL_CADDY="${INSTALL_CADDY:-true}"
INSTALL_DOCKER="${INSTALL_DOCKER:-false}"
WRITE_CADDYFILE="${WRITE_CADDYFILE:-true}"

SERVER_UNIT_PATH="${SERVER_UNIT_PATH:-/etc/systemd/system/yankcord-server.service}"
CADDYFILE_PATH="${CADDYFILE_PATH:-/etc/caddy/Caddyfile}"

if [[ "${EUID}" -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

run_as_root() {
  if [[ -n "${SUDO}" ]]; then
    ${SUDO} "$@"
  else
    "$@"
  fi
}

run_as_user() {
  local target_user="$1"
  shift

  if [[ "$(id -un)" == "${target_user}" ]]; then
    "$@"
    return
  fi

  if [[ -n "${SUDO}" ]]; then
    ${SUDO} -u "${target_user}" "$@"
  else
    runuser -u "${target_user}" -- "$@"
  fi
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

is_true() {
  case "${1,,}" in
    true|1|yes|y|on) return 0 ;;
    *) return 1 ;;
  esac
}

require_cmd() {
  local cmd="$1"
  if ! command_exists "${cmd}"; then
    echo "Missing required command: ${cmd}" >&2
    exit 1
  fi
}

require_cmd apt-get
require_cmd systemctl
require_cmd curl

if ! id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
  echo "Deploy user does not exist: ${DEPLOY_USER}" >&2
  exit 1
fi

if [[ -r /etc/os-release ]]; then
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    echo "This script targets Ubuntu. Detected: ${ID:-unknown}" >&2
    exit 1
  fi
fi

echo "==> Updating apt index"
run_as_root apt-get update

echo "==> Installing base packages"
run_as_root apt-get install -y \
  build-essential \
  ca-certificates \
  curl \
  git \
  gnupg \
  pkg-config \
  libssl-dev

if is_true "${INSTALL_NODE}"; then
  NEED_NODE=true
  if command_exists node; then
    NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
    if [[ "${NODE_MAJOR}" -ge 18 ]]; then
      NEED_NODE=false
      echo "==> Node.js $(node -v) already installed"
    fi
  fi

  if is_true "${NEED_NODE}"; then
    echo "==> Installing Node.js 20.x"
    curl -fsSL https://deb.nodesource.com/setup_20.x | run_as_root bash -
    run_as_root apt-get install -y nodejs
  fi
fi

if is_true "${INSTALL_RUST}"; then
  if command_exists cargo; then
    echo "==> Rust toolchain already installed"
  else
    echo "==> Installing Rust toolchain for ${DEPLOY_USER}"
    run_as_user "${DEPLOY_USER}" sh -lc "curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal"
  fi
fi

if is_true "${INSTALL_DOCKER}"; then
  if command_exists docker; then
    echo "==> Docker already installed"
  else
    echo "==> Installing Docker Engine"
    run_as_root install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | run_as_root gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    run_as_root chmod a+r /etc/apt/keyrings/docker.gpg
    run_as_root sh -c "echo \"deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable\" > /etc/apt/sources.list.d/docker.list"
    run_as_root apt-get update
    run_as_root apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi

  if id -nG "${DEPLOY_USER}" | tr ' ' '\n' | grep -qx docker; then
    :
  else
    echo "==> Adding ${DEPLOY_USER} to docker group"
    run_as_root usermod -aG docker "${DEPLOY_USER}"
    echo "    Log out/in for group membership to take effect."
  fi
fi

if is_true "${INSTALL_CADDY}"; then
  if command_exists caddy; then
    echo "==> Caddy already installed"
  else
    echo "==> Installing Caddy"
    run_as_root apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | run_as_root gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | run_as_root tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    run_as_root apt-get update
    run_as_root apt-get install -y caddy
  fi

  if is_true "${WRITE_CADDYFILE}"; then
    if [[ -f "${CADDYFILE_PATH}" ]]; then
      BACKUP_PATH="${CADDYFILE_PATH}.bak.$(date +%Y%m%d%H%M%S)"
      echo "==> Backing up existing Caddyfile to ${BACKUP_PATH}"
      run_as_root cp "${CADDYFILE_PATH}" "${BACKUP_PATH}"
    fi

    echo "==> Writing Caddyfile (${CADDYFILE_PATH})"
    run_as_root tee "${CADDYFILE_PATH}" >/dev/null <<EOF
${SITE_ADDRESS} {
  encode zstd gzip

  root * ${REPO_DIR}/client/dist
  file_server

  @api path /api/*
  reverse_proxy @api 127.0.0.1:${SERVER_PORT}

  @ws path /ws
  reverse_proxy @ws 127.0.0.1:${SERVER_PORT}
}
EOF
  fi

  echo "==> Enabling and restarting Caddy"
  run_as_root systemctl enable caddy
  run_as_root systemctl restart caddy
fi

echo "==> Writing backend systemd unit (${SERVER_UNIT_PATH})"
run_as_root tee "${SERVER_UNIT_PATH}" >/dev/null <<EOF
[Unit]
Description=Yankcord backend server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${DEPLOY_USER}
Group=${DEPLOY_USER}
WorkingDirectory=${REPO_DIR}/server
EnvironmentFile=-${REPO_DIR}/server/.env
ExecStart=${REPO_DIR}/server/target/release/yankcord-server
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

echo "==> Reloading systemd and enabling backend service"
run_as_root systemctl daemon-reload
run_as_root systemctl enable yankcord-server

echo "==> Bootstrap complete"
echo "Next: clone repo to ${REPO_DIR} (if not already), create ${REPO_DIR}/server/.env, then run:"
echo "  START_POSTGRES=true bash scripts/deploy-ovh.sh"
