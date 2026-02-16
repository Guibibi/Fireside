---
name: frontend-design-ux
description: Build frontend features that match Yankcord visual language and deliver high-quality UX.
---

## What I do

- Keep new UI aligned with the existing Yankcord visual language and component patterns.
- Prioritize UX quality: clarity, fast feedback, predictable interactions, and reduced user friction.
- Protect responsive behavior across desktop and mobile without breaking current flows.
- Ensure frontend changes remain type-safe and production-build ready.

## When to use me

Use this for UI implementation, page redesigns, interaction updates, onboarding flows, form UX, and any frontend polish work in `client/src/`.

## Design guardrails

- Reuse established spacing, typography, color tokens, and component primitives before adding new styles.
- Preserve the product's tone and hierarchy; avoid introducing an unrelated visual theme.
- Prefer intentional visual structure (clear grouping, rhythm, contrast) over decorative-only styling.
- Keep states complete and coherent: `default`, `hover`, `active`, `focus-visible`, `disabled`, and `loading`.
- Use motion only when it communicates state or hierarchy; keep durations subtle and non-distracting.

## UX guardrails

- Make primary actions obvious and place them where users expect them.
- Provide immediate, human-readable feedback for async actions and failures.
- Reduce cognitive load: concise copy, sensible defaults, and progressive disclosure for complexity.
- Design forms for completion speed: explicit labels, inline validation, and actionable error messages.
- Never block the whole page for local operations when scoped loading states are sufficient.

## Accessibility and interaction quality

- Ensure full keyboard navigation and visible focus states.
- Use semantic HTML and ARIA only when native semantics are not enough.
- Maintain readable contrast and avoid conveying meaning by color alone.
- Ensure touch targets and spacing are mobile-friendly.
- Respect reduced-motion preferences for non-essential animations.

## Implementation checklist

1. Review nearby components/pages and match existing patterns.
2. Build layout and interactions with responsive behavior from the start.
3. Add complete state handling (loading, empty, error, success).
4. Validate accessibility basics (keyboard, focus, semantics, contrast).
5. Refine copy and micro-interactions to remove friction.
6. Run frontend validation commands.

## Validation

- `npm --prefix client run typecheck`
- `npm --prefix client run build`
