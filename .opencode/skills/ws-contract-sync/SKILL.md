---
name: ws-contract-sync
description: Keep WebSocket message contracts synchronized between server and client.
---

## What I do

- Treat `server/src/ws/messages.rs` and `client/src/api/ws.ts` as a paired contract.
- Verify every `type` discriminator exists on both sides.
- Check payload field parity (names, required/optional shape, and wire naming).
- Flag breaking protocol drift and propose aligned server/client edits.

## When to use me

Use this whenever WebSocket messages, presence, voice signaling, or media signaling events change.

## Contract checks

- First-message auth rule remains valid (`type: "authenticate"`).
- Server-to-client events stay in sync (`new_message`, `message_edited`, etc.).
- Client-to-server commands stay in sync (`send_message`, `typing_start`, etc.).
- `snake_case` transport fields are preserved.

## Workflow

1. Read both files.
2. Build a discriminator list for each side.
3. Compare missing, renamed, or shape-drifted variants.
4. Apply minimal synchronized fixes to both files.
5. Run relevant type/build checks.

## Validation

- Frontend: `npm --prefix client run typecheck`
- Frontend: `npm --prefix client run build`
- Backend (if Rust changed): `cargo test --manifest-path server/Cargo.toml`
