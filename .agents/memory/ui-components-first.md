---
name: feedback_packages_ui_components_first
description: Renderer UI should use packages/ui components first; add reusable pieces there before app-local markup
type: feedback
status: active
last_verified: 2026-04-23
topics: [ui, components, renderer, conventions]
---

**Rule:** In the renderer, **use `packages/ui` components first**. If the needed UI pattern does not exist yet, add a reusable component or primitive to `packages/ui` before hand-rolling it inside `apps/desktop`.

**Why:** App-local one-offs in `apps/desktop` drift visually and structurally. The renderer should consume a shared UI layer, not invent parallel components ad hoc.

**How to apply:**
- Before adding renderer UI markup, check whether `@shipcode/ui` already exposes the primitive or pattern.
- If the pattern is missing, create it in `packages/ui/src/` or `packages/ui/src/primitives/`, export it from `packages/ui/src/index.ts`, then consume it from the app.
- Keep app-level files focused on composition, state, and app-specific behavior. Avoid embedding new reusable layout primitives directly in `apps/desktop`.
- When refactoring an existing renderer one-off into a shared component, move the reusable shell into `packages/ui` and leave app-specific wiring in the renderer.
