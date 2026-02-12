FROM rust:1.86-bookworm AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  build-essential \
  clang \
  cmake \
  libssl-dev \
  pkg-config \
  python3 \
  && rm -rf /var/lib/apt/lists/*

COPY server/Cargo.toml server/Cargo.lock ./server/
COPY server/src ./server/src
COPY server/migrations ./server/migrations

RUN cargo build --release --manifest-path server/Cargo.toml

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  libssl3 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/server/target/release/yankcord-server /usr/local/bin/yankcord-server

EXPOSE 3000

CMD ["/usr/local/bin/yankcord-server"]
