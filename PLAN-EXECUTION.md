# Yankcord Execution Plan (Current Phase)

`PLAN-EXECUTION.md` is a living implementation document for the active phase only.
Long-term roadmap and completed milestone tracking live in `PLAN.md`.

## Active Phase

- Phase 5.2: Native-style context menus

## Objective

- Introduce consistent context menus for channels, users, messages, and member entries.
- Keep role/permission enforcement server-authoritative while improving client affordance.
- Preserve existing REST/WS contracts unless an explicit action needs extension.

## Scope

### In scope

- Shared context menu primitives (state, positioning, dismissal, keyboard support).
- Target-specific menu entry wiring for `channel`, `user`, `message`, and `member` surfaces.
- Accessibility and fallback behavior (right-click, keyboard context key, long-press).
- Permission-aware menu item visibility/disabled state based on existing capabilities.

### Out of scope

- New moderation features or role model changes.
- New backend permission semantics beyond existing server checks.
- Broad visual redesign outside context-menu UI.
- Per-platform native OS menu integrations in Tauri host.

## Implementation Checklist

1. Audit current action entry points in channel list, message list, and member list.
2. Create reusable context menu state/controller and anchor-positioning behavior.
3. Add `channel` target menu with existing channel actions.
4. Add `message` target menu with existing message actions.
5. Add `user`/`member` target menu stubs wired to currently supported actions.
6. Add keyboard invocation and escape/outside-click dismissal behavior.
7. Add long-press fallback for touch/narrow viewports.
8. Ensure disabled/hidden action states align with current permission and ownership rules.
9. Validate tab order/focus restoration after menu close.
10. Update `PLAN.md` once implementation and validation are complete.

## Primary Touch Points

- `client/src/components/ChannelList.tsx`
- `client/src/components/MessageArea.tsx`
- `client/src/components/MemberList.tsx`
- `client/src/styles/global.css` (or new context-menu styles module)

## Validation

- `npm --prefix client run typecheck`
- `npm --prefix client run build`

## Done Criteria

- Context menus are available on channel, message, and member/user targets.
- Existing actions remain functional and permission-safe.
- Keyboard and pointer interactions are predictable and dismiss cleanly.
- No unintended protocol changes are required.
- Validation commands pass.
- `PLAN.md` updated to reflect completion of Phase 5.2.
