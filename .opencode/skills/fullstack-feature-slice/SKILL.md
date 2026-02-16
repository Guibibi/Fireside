---
name: fullstack-feature-slice
description: Implement one feature slice across server, client, and protocol with minimal drift.
---

## What I do

- Deliver a focused vertical slice: backend API/WS + client API/store/UI.
- Preserve existing architecture and contracts unless a protocol change is explicitly required.
- Keep scope tight and avoid unrelated refactors.
- Ensure each layer compiles and validates before completion.

## When to use me

Use this for roadmap items that span multiple layers in the monorepo.

## Slice checklist

1. Define scope and affected touch points.
2. Add or update backend route/model/state logic.
3. Update protocol types if needed (server and client together).
4. Wire client API and state/store integration.
5. Add UI behavior with existing interaction patterns.
6. Run layer-appropriate validation.

## Yankcord-specific guardrails

- Keep `server/src/ws/messages.rs` and `client/src/api/ws.ts` synchronized.
- Use explicit boundary types and preserve transport `snake_case` fields.
- Keep file size manageable and extract cohesive modules if a file grows too large.
- Keep deployment-sensitive config changes synchronized across docs/examples when touched.

## Validation

- Backend: `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
- Backend: `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
- Backend: `cargo test --manifest-path server/Cargo.toml`
- Frontend: `npm --prefix client run typecheck`
- Frontend: `npm --prefix client run build`
