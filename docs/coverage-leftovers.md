# Coverage Leftovers

Last updated: 2026-07-14

Goal: keep the repo above the release-hardening floor. Do not chase 100% coverage for its own sake.

Current gate:

- Lines, statements, functions: 95%
- Branches: 90%
- `COVERAGE_MIN=<n>` overrides the base floor for every metric.
- `COVERAGE_BRANCH_MIN=<n>` overrides branch coverage independently, including when `COVERAGE_MIN` is set.

Verification snapshot:

```text
node scripts/coverage-summary.mjs

Overall coverage
lines: 95.86% (21791/22732)
statements: 95.02% (24122/25387)
functions: 95.40% (5622/5893)
branches: 90.74% (18962/20898)

Coverage threshold passed at lines/statements/functions 95.00%, branches 90.00%.
```

## Package Gaps

These packages are below the current package-level floor, though the aggregate release gate passes:

- `apps/desktop`: statements 93.86%, functions 94.70%, branches 87.48%
- `apps/docs`: lines and statements 93.75%
- `apps/web`: functions 88.23%
- `packages/pipeline`: statements 94.55%, branches 89.23%
- `packages/ui`: statements 94.13%, functions 94.47%

## Next Pass

1. Raise `apps/desktop` branches to 90%, then close its small statement/function gaps.
2. Cover the remaining gaps in `apps/docs`, `apps/web`, `packages/pipeline`, and `packages/ui`.
3. Keep new package work at or above the release contract before merging.
