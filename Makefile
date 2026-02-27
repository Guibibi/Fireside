.PHONY: help dev build typecheck
.PHONY: tauri-dev tauri-build tauri-build-release
.PHONY: server-dev server-build server-fmt server-lint server-test
.PHONY: server-start server-stop
.PHONY: db-up db-down db-logs

# Default target
help:
	@echo "Yankcord Build Targets"
	@echo ""
	@echo "Client (Tauri):"
	@echo "  tauri-dev            - Run Tauri in development mode"
	@echo "  tauri-build          - Build Tauri app (debug)"
	@echo "  tauri-build-release  - Build Tauri app (release)"
	@echo ""
	@echo "Client (Web):"
	@echo "  dev                  - Run web dev server"
	@echo "  build                - Build web client"
	@echo "  typecheck            - Type-check TypeScript"
	@echo ""
	@echo "Server:"
	@echo "  server-dev           - Run server in development mode"
	@echo "  server-build         - Build server (release)"
	@echo "  server-fmt           - Format server code"
	@echo "  server-lint          - Lint server code"
	@echo "  server-test          - Run server tests"
	@echo ""
	@echo "Production (Docker):"
	@echo "  server-start         - Start prod containers (no repo update)"
	@echo "  server-stop          - Stop prod containers"
	@echo ""
	@echo "Database:"
	@echo "  db-up                - Start PostgreSQL container"
	@echo "  db-down              - Stop PostgreSQL container"
	@echo "  db-logs              - Follow PostgreSQL logs"

# Client web targets
dev:
	npm --prefix client run dev

build:
	npm --prefix client run build

typecheck:
	npm --prefix client run typecheck

# Tauri targets
tauri-dev:
	cd client && npm run tauri dev

tauri-build:
	cd client && npm run tauri build

tauri-build-release:
	cd client && npm run tauri build

# Server targets
server-dev:
	cargo run --manifest-path server/Cargo.toml

server-build:
	cargo build --release --manifest-path server/Cargo.toml

server-fmt:
	cargo fmt --all --manifest-path server/Cargo.toml

server-lint:
	cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings

server-test:
	cargo test --manifest-path server/Cargo.toml

# Production Docker targets
COMPOSE_FILE ?= docker-compose.prod.yml
ENV_FILE ?= server/.env.docker
REPO_DIR ?= /opt/yankcord

server-start:
	UPDATE_REPO=false REPO_DIR=$(REPO_DIR) bash scripts/deploy-docker.sh

server-stop:
	docker compose --env-file $(ENV_FILE) -f $(COMPOSE_FILE) down

# Database targets (delegate to server/Makefile)
db-up:
	$(MAKE) -C server db-up

db-down:
	$(MAKE) -C server db-down

db-logs:
	$(MAKE) -C server db-logs
