# System Summary

## Current Status

- Full repo React Doctor score is 100 with 0 diagnostics.
- `@shipcode/desktop`, `@shipcode/ui`, `@shipcode/docs`, and `@shipcode/web` all report 100.
- Full repo typecheck passes.

## Important Working Rule

React Doctor issues must be fixed in source. Do not add suppression config or hide diagnostics.

## Recent Architecture Notes

- Desktop CPU gauge and cost charts no longer depend on Recharts.
- Desktop renderer reset-heavy UI state has been moved toward reducers/keyed derived state.
- Shared Kanban UI warnings were resolved in `packages/ui` so the full workspace score stays at 100.
