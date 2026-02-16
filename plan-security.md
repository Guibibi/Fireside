# Security and Performance Remediation Plan (Database and API)

## Phase 0 - Critical (Do First)

- [x] Protect media reads by requiring authentication in `GET /api/media/{media_id}/{variant}`.
- [x] Enforce authorization for media access (owner/channel/member policy), not just URL possession.
- [x] Add role checks for channel mutation endpoints (`create_channel`, `delete_channel`).
- [x] Replace global permissive CORS with config-driven allowlists for origins/methods/headers.
- [ ] Add tests proving unauthorized media access and unauthorized channel mutations are denied.

## Phase 1 - High Security Hardening

- [x] Add rate limiting for `/api/login`, `/api/register`, and `/api/setup`.
- [x] Use combined limiter keys (IP + username where applicable) to reduce credential stuffing risk.
- [x] Keep auth error responses generic and uniform to avoid account enumeration.
- [x] Add structured security logs for auth failures and rate-limit triggers.
- [ ] Add endpoint/body-size guardrails where missing.
- [ ] Add tests for rate-limit behavior (allow, block, and reset window).

## Phase 2 - Performance Bottlenecks

- [ ] Stop re-reading and re-decoding attachment images on message send.
- [ ] Store dimensions/metadata once at upload time and reuse for attachments.
- [ ] Add/adjust message pagination index: `(channel_id, created_at DESC, id DESC)`.
- [ ] Add/adjust reaction aggregation index: `(message_id, emoji_id, unicode_emoji)`.
- [ ] Review and optimize slow query plans with `EXPLAIN ANALYZE` before/after.
- [ ] Add regression tests for message fetch/send and reaction aggregation performance-sensitive paths.

## Phase 3 - WebSocket Resilience and Observability

- [ ] Replace unbounded websocket outbound queues with bounded queues.
- [ ] Define slow-consumer behavior (drop oldest, drop new, or disconnect) and implement consistently.
- [ ] Add metrics: auth failures, rate-limit hits, media denial counts, ws queue pressure, slow DB queries.
- [ ] Add tracing spans for hot paths (message fetch/send, reactions, media retrieval).
- [ ] Add load-test scenarios for websocket fan-out and slow-consumer handling.

## Validation Checklist (Run Per Phase)

- [ ] `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
- [x] `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
- [x] `cargo test --manifest-path server/Cargo.toml`
- [ ] Add or update focused integration tests for each changed security/performance behavior.

## Recommended Execution Order

- [x] 1) Media auth/authz + channel role enforcement.
- [x] 2) CORS tightening.
- [x] 3) Auth endpoint rate limiting.
- [ ] 4) Attachment metadata optimization.
- [ ] 5) Websocket queue backpressure + DB index tuning.

## Definition of Done

- [ ] High-risk unauthorized access paths are closed.
- [ ] Auth endpoints are protected against brute-force abuse.
- [ ] Message and reaction queries have validated index support.
- [ ] Websocket behavior is bounded under backpressure.
- [ ] CI/local validation passes and new tests cover critical regressions.
