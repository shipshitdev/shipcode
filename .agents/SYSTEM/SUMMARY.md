# System Summary

## Current Status

- Full repo React Doctor score is 100 with 0 diagnostics.
- `@shipcode/desktop`, `@shipcode/ui`, `@shipcode/docs`, and `@shipcode/web` all report 100.
- Full repo typecheck passes.
- The 100% coverage goal is paused and tracked in GitHub issue #145, which is in the `shipcode` project with Status `In Progress`.
- Current coverage gate defaults to 85%. Latest documented snapshot: overall lines 99.37%, statements 98.91%, functions 98.85%, branches 95.12%.

## Important Working Rule

React Doctor issues must be fixed in source. Do not add suppression config or hide diagnostics.

## Recent Architecture Notes

- Desktop CPU gauge and cost charts no longer depend on Recharts.
- Desktop renderer reset-heavy UI state has been moved toward reducers/keyed derived state.
- Shared Kanban UI warnings were resolved in `packages/ui` so the full workspace score stays at 100.
- Coverage leftovers are documented in `docs/coverage-leftovers.md`; clean packages are `apps/docs`, `apps/web`, `packages/agents`, `packages/db`, and `packages/ui`.
