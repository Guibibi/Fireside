# UI Refactor: Remaining Work

## Status

### Completed
- [x] `client/src/styles/variables.css` — Full rewrite with warm neutral scale, single accent, new fonts, reduced radii, flat shadows, legacy aliases, picker aliases
- [x] `client/index.html` — Swapped to Geist + IBM Plex Mono, updated all hex values (#1a1918 bg, #b5b0ac text, #c9956b spinner), theme-color meta, noscript block
- [x] `client/src/styles/base.css` — Removed body::before gradient, updated all tokens to gray-N, solid accent button (no gradient/glow/lift), input focus uses accent-border, radius-md on buttons/inputs
- [x] `client/src/styles/layout.css` — Replaced softFadeIn with quick 0.2s fadeIn, chat-view gap/padding reduced to space-sm, main-content uses gray-2 bg + gray-5 border
- [x] `client/src/styles/channel-list.css` — Flat gray-4 bg, active channel uses accent-dim + 2px accent left border, voice-connected uses success-dim + success border, badge is solid warning, removed softPop/gentlePulse animations, speaking dot is solid success (no glow)
- [x] `client/src/styles/voice-dock.css` — Remapped all accent refs, disconnect uses solid danger, active camera/screen uses solid success (no glow), simplified all hover states

### Remaining

Each section below contains the **full replacement content** for the file.

---

## 1. `client/src/styles/user-dock.css`

Changes needed:
- Online dot: solid `--success`, remove glow (`box-shadow: 0 0 6px var(--mint-glow)`)
- Settings gear: remove `transform: rotate(30deg)` on hover
- Avatar placeholder: remove glow shadow, use `--accent` border
- User dock bg: `--gray-4` (via `--nebula-light` alias, already maps)
- Fix `--rose` references → `--danger` (already aliased in variables.css, but inline `rgba(244,164,164,...)` should become `rgba(196,112,112,...)`)
- Invite code color: `--accent` instead of `--lavender` (already aliased)

Specific edits:
```css
/* .user-dock-avatar.is-placeholder — remove box-shadow line */
.user-dock-avatar.is-placeholder {
  border: 2px solid var(--accent);
  /* REMOVE: box-shadow: 0 0 12px var(--lavender-glow); */
}

/* .user-dock-subtitle::before — remove box-shadow */
.user-dock-subtitle::before {
  /* ... keep other props ... */
  background: var(--success);
  /* REMOVE: box-shadow: 0 0 6px var(--mint-glow); */
}

/* .user-dock-settings:hover — remove rotate */
.user-dock-settings:hover:not(:disabled) {
  background: var(--gray-6);
  color: var(--gray-11);
  /* REMOVE: transform: rotate(30deg); */
  transform: none;
  box-shadow: none;
}

/* .invite-badge-revoked — --rose already aliased to --danger in variables.css, OK */
/* .invite-revoke-btn — --rose already aliased, OK */
```

---

## 2. `client/src/styles/messages.css`

Changes needed:
- Header: remove `linear-gradient` background from `.message-area-header`
- `.message-area-prefix` color: `--gray-8` (was `--lavender`, now aliased but should be explicit)
- Message hover: `--gray-4` bg instead of `rgba(255,255,255,0.04)`
- Mentioned messages: `--accent-dim` bg + `--accent-border` border (no gradient)
- Sticky date pill: solid `--gray-3` bg, remove `backdrop-filter`
- Links: `--accent` color (already via alias)
- Reaction chips `.is-active`: `--accent-border` border, `--accent-dim` bg
- Image popup: solid dark bg `rgba(0,0,0,0.7)`, remove `backdrop-filter`
- Mention picker bg: `rgba(18,17,16,0.96)` instead of `rgba(16,14,24,0.96)`
- `.mention-picker-item:hover`: `--accent-dim` bg

Specific edits:
```css
.message-area-header {
  /* ... */
  /* REMOVE: background: linear-gradient(180deg, rgba(180, 167, 214, 0.03) 0%, transparent 100%); */
}

.message-area-prefix {
  color: var(--gray-8);
  /* was --lavender */
}

.messages-sticky-date {
  /* ... */
  background: var(--gray-3);
  /* REMOVE: backdrop-filter: blur(8px); */
}

.message-item:hover {
  background: var(--gray-4);
  border-color: var(--gray-5);
}

.message-item-mentioned {
  border-color: var(--accent-border);
  background: var(--accent-dim);
}

.message-item-mentioned:hover {
  border-color: var(--accent);
  background: rgba(201, 149, 107, 0.2);
}

.message-reaction-chip.is-active {
  border-color: var(--accent-border);
  background: var(--accent-dim);
  color: var(--gray-11);
}

.message-image-popup {
  background: rgba(0, 0, 0, 0.7);
  /* REMOVE: -webkit-backdrop-filter: blur(8px); */
  /* REMOVE: backdrop-filter: blur(8px); */
}

.mention-picker {
  background: rgba(18, 17, 16, 0.96);
}

.mention-picker-item:hover,
.mention-picker-item.is-selected {
  background: var(--accent-dim);
  color: var(--gray-11);
}

.message-embed-title:hover {
  color: var(--accent);
}

.message-link {
  color: var(--accent);
}

/* Update typing indicator SVG fill color from #7a7394 to #5f5b59 (gray-7) */
```

Also update hardcoded `rgba(164, 131, 252, ...)` (old purple) references:
- `rgba(164, 131, 252, 0.5)` → `var(--accent-border)`
- `rgba(164, 131, 252, 0.14)` → `var(--accent-dim)`

And update `rgba(19, 17, 28, ...)` → `rgba(18, 17, 16, ...)` for consistency with warm undertone.

---

## 3. `client/src/styles/members.css`

Changes needed:
- Flat `--gray-4` bg instead of gradient
- Status dots: solid colors, no glow shadows
- Voice indicator: `--accent-dim` bg, `--accent` text

```css
.member-list {
  background: var(--gray-4);
  /* REMOVE: linear-gradient */
}

.member-status-dot-online {
  background: var(--success);
  /* REMOVE: box-shadow: 0 0 6px var(--mint-glow); */
}

.member-status-dot-idle {
  background: var(--warning);
  /* REMOVE: box-shadow: 0 0 6px var(--peach-glow); */
}

.member-voice-indicator {
  color: var(--accent);
  background: var(--accent-dim);
}
```

---

## 4. `client/src/styles/modals.css`

Changes needed:
- Backdrop: solid `rgba(0,0,0,0.7)`, remove `backdrop-filter` and `@supports` block
- Modal: `--gray-3` bg, `--gray-5` border
- Keep `modalPop` animation but use `--ease-soft` (already does)
- Section headings: `--gray-8` instead of `--lavender`
- Fix `--muted` variable → `--gray-8`
- Settings section bg: `--gray-4`
- Checkbox accent: `--accent`
- Voice share preview bg: `--gray-1`

```css
.settings-modal-backdrop {
  background: rgba(0, 0, 0, 0.7);
  /* REMOVE all backdrop-filter lines */
}

/* REMOVE the @supports block entirely */

.settings-modal {
  background: var(--gray-3);
  border: 1px solid var(--gray-5);
}

.settings-section {
  background: var(--gray-4);
}

.settings-section h5 {
  color: var(--gray-8);
  /* was --lavender */
}

.settings-volume-value {
  color: var(--gray-8);
  /* was --muted (undefined) */
}

.settings-checkbox input[type="checkbox"] {
  accent-color: var(--accent);
}

.voice-share-preview-video {
  background: var(--gray-1);
}
```

---

## 5. `client/src/styles/auth.css`

Changes needed:
- Remove `auth-page::before` ambient gradient entirely
- Auth page bg: `--gray-1`
- Form card: `--gray-3` bg, `--gray-5` border

```css
/* DELETE entire .auth-page::before rule */

.auth-page {
  background: var(--gray-1);
}

.auth-form {
  background: var(--gray-3);
  border: 1px solid var(--gray-5);
}
```

---

## 6. `client/src/styles/context-menu.css`

Changes needed:
- Hover colors: `--accent-dim` instead of `--lavender-soft`
- Danger items: `--danger-dim` hover (already uses `--coral-soft` which aliases)
- Focus-visible: `--accent`
- Volume slider thumb: `--accent`
- Remove `--lavender-light` refs (undefined) → just `--accent`

```css
.context-menu {
  background: var(--gray-3);
}

.context-menu-item:hover:not(:disabled) {
  background: var(--accent-dim);
}

.context-menu-item:focus-visible {
  outline: 2px solid var(--accent);
}

.context-menu-volume-slider::-webkit-slider-thumb {
  background: var(--accent);
}

.context-menu-volume-slider::-webkit-slider-thumb:hover {
  background: var(--accent);
  /* was --lavender-light (undefined) */
}

.context-menu-volume-slider::-moz-range-thumb {
  background: var(--accent);
}

.context-menu-volume-slider::-moz-range-thumb:hover {
  background: var(--accent);
}
```

---

## 7. `client/src/styles/settings-page.css`

Changes needed:
- Replace `settingsSlideIn` animation with simple opacity fade (or keep as is but remove translateX)
- Nav: flat `--gray-4` bg instead of gradient
- Active nav: 2px `--accent` left border, `--accent` text, `--accent-dim` bg
- Content bg: `--gray-2`

```css
@keyframes settingsSlideIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.settings-nav {
  background: var(--gray-4);
  /* REMOVE: linear-gradient */
}

.settings-nav-item-active {
  background: var(--accent-dim);
  color: var(--accent);
  border-left: 2px solid var(--accent);
  /* was 3px --lavender */
}

.settings-nav-item-active:hover:not(:disabled) {
  background: var(--accent-dim);
  color: var(--accent);
}

.settings-content {
  background: var(--gray-2);
}
```

---

## 8. `client/src/styles/video.css`

Changes needed:
- Local tile border: `--accent` instead of lavender, no glow
- Screen-share tile: `--warning` instead of peach, no glow
- Video label: solid bg, remove `backdrop-filter` and `@supports`

```css
.video-stage-tile.is-local {
  border-color: var(--accent);
  /* REMOVE: box-shadow: 0 0 16px var(--lavender-glow); */
}

.video-stage-tile.is-screen-share {
  border-color: var(--warning);
  /* REMOVE: box-shadow: 0 0 16px var(--peach-glow); */
}

.video-stage-label {
  background: rgba(18, 17, 16, 0.88);
  /* REMOVE: -webkit-backdrop-filter, backdrop-filter */
}

/* REMOVE @supports block */
```

---

## 9. `client/src/styles/stream-watch.css`

Changes needed:
- `.stream-watch-focused`: remove radial gradient overlay, use solid bg
- Update `rgba(19, 17, 28, ...)` → `rgba(18, 17, 16, ...)`
- `rgba(244, 164, 164, ...)` → `rgba(196, 112, 112, ...)` for danger color

```css
.stream-watch-focused {
  background: rgba(18, 17, 16, 0.98);
  /* was radial-gradient + linear-gradient */
}

.stream-watch-live-badge {
  border: 1px solid rgba(196, 112, 112, 0.45);
  background: rgba(196, 112, 112, 0.16);
  color: var(--danger);
}

.stream-watch-icon-btn-danger:hover {
  background: rgba(196, 112, 112, 0.22);
  color: var(--danger);
}

.stream-watch-notice {
  background: rgba(18, 17, 16, 0.9);
}
```

---

## 10. `client/src/styles/voice-panel.css`

Changes needed:
- `.voice-panel` bg: `--gray-4`
- All token refs already map via aliases, no major changes needed

```css
.voice-panel {
  background: var(--gray-4);
}
```

---

## 11. `client/src/styles/emoji-picker.css`

These use undefined CSS vars that are now defined in variables.css via the picker aliases (`--surface-1`, `--surface-2`, `--surface-3`, `--border-color`, `--text-primary`, `--text-secondary`, `--primary`). No changes needed since the aliases are now defined. Optionally rewrite to use `--gray-N` tokens directly for clarity, and update hardcoded `border-radius: 8px` → `var(--radius-lg)` etc.

Optional cleanup:
```css
/* Replace hardcoded values with design tokens */
border-radius: 8px    → var(--radius-lg)
border-radius: 4px    → var(--radius-sm)
padding: 12px         → var(--space-md) or 12px (fine)
gap: 8px              → var(--space-sm) or 8px (fine)
font-size: 14px       → 0.875rem or 14px (fine)
```

---

## 12. `client/src/styles/reaction-picker.css`

Same as emoji-picker — vars are now defined via aliases. Optionally replace hardcoded border-radius values with design tokens.

---

## 13. `client/src/styles/gif-picker.css`

Same as above — vars are now defined via aliases. The `--danger` ref on line 74 already works. Optionally replace hardcoded values with design tokens.

---

## 14. `client/src/styles/avatars.css`

Change:
```css
.user-avatar {
  background: rgba(201, 149, 107, 0.18);
  /* was rgba(107, 116, 235, 0.18) — old blue-purple */
}
```

---

## 15. `client/src/styles/utilities.css`

Changes needed:
- `.error`: update `rgba(244, 164, 164, 0.3)` → `rgba(196, 112, 112, 0.3)`
- `.info`: update `rgba(167, 197, 235, 0.3)` → `rgba(122, 158, 196, 0.3)`
- Toast: `--gray-3` bg, `--gray-5` border
- Toast error: update `rgba(244, 164, 164, 0.4)` → `rgba(196, 112, 112, 0.4)`
- Responsive: update chat-view gap to `--space-sm` at breakpoints
- Responsive `--radius-lg` for panels at 820px breakpoint (already maps to 8px now)

```css
.error {
  color: var(--danger);
  background: var(--danger-dim);
  border: 1px solid rgba(196, 112, 112, 0.3);
}

.info {
  color: var(--info);
  background: var(--info-dim);
  border: 1px solid rgba(122, 158, 196, 0.3);
}

.toast {
  background: var(--gray-3);
  border: 1px solid var(--gray-5);
}

.toast-error {
  border-color: rgba(196, 112, 112, 0.4);
  color: var(--danger);
}
```

Responsive section: update `gap: var(--space-md)` → `gap: var(--space-sm)` in the 1024px and 820px breakpoints to match the new tighter layout.

---

## 16. `client/src/styles/global.css`

Update file header comment only:

```css
/* ==========================================================================
   YANKCORD - Warm & Grounded Design System

   This file imports all component stylesheets.
   ========================================================================== */
```

---

## Build Validation

After all changes:
```bash
npm --prefix client run typecheck
npm --prefix client run build
```

Both must pass with zero errors.

## Visual QA Checklist

After build passes, manually verify:
- [ ] Auth pages (login/register/setup) render with warm dark theme
- [ ] Channel list sidebar: active/hover/unread states use accent/warning correctly
- [ ] Messages: hover shows gray-4 bg, mentions show accent-dim, reactions work
- [ ] Modals open/close with correct colors, no backdrop blur
- [ ] Settings page navigation shows accent left-border on active
- [ ] Voice UI: dock buttons, video tiles, stream overlay all use new colors
- [ ] Emoji/reaction/GIF pickers render with correct colors (no missing vars)
- [ ] No visible purple/lavender/pastel colors remaining anywhere
- [ ] Fonts are Geist (body) and IBM Plex Mono (mono elements)
- [ ] Border radius feels tighter (4-10px range, no more 24px pills on containers)
- [ ] No glow shadows visible on any element
- [ ] Responsive breakpoints still work at 1024px, 820px, 620px
