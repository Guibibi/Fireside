FROM rust:bookworm AS chef

WORKDIR /app

RUN rustup component add rustfmt

RUN apt-get update && apt-get install -y --no-install-recommends \
  build-essential \
  clang \
  cmake \
  libssl-dev \
  pkg-config \
  python3 \
  python3-pip \
  && rm -rf /var/lib/apt/lists/* \
  && pip3 install --break-system-packages invoke meson ninja

RUN cargo install cargo-chef --locked

FROM chef AS planner

WORKDIR /app/server

COPY server/Cargo.toml server/Cargo.lock ./
COPY server/src ./src
COPY server/migrations ./migrations

RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder

WORKDIR /app/server

COPY --from=planner /app/server/recipe.json ./recipe.json

RUN cargo chef cook --release --recipe-path recipe.json

COPY server/Cargo.toml server/Cargo.lock ./
COPY server/src ./src
COPY server/migrations ./migrations

RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  libssl3 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/server/target/release/yankcord-server /usr/local/bin/yankcord-server

EXPOSE 3000

CMD ["/usr/local/bin/yankcord-server"]
