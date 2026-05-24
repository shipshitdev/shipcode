# Coverage Leftovers

Last updated: 2026-05-24

Goal: keep the repo above the release-hardening floor. Do not chase 100% coverage for its own sake.

Current gate:

- Lines, statements, functions: 95%
- Branches: 90%
- `COVERAGE_MIN=<n>` overrides every metric for stricter one-off runs.
- `COVERAGE_BRANCH_MIN=<n>` overrides only branch coverage when `COVERAGE_MIN` is unset.

Verification snapshot:

```text
node scripts/coverage-summary.mjs

Overall coverage
lines: 95.91% (20055/20911)
statements: 95.19% (22206/23327)
functions: 95.08% (5156/5423)
branches: 91.52% (17607/19239)

Coverage threshold passed at lines/statements/functions 95.00%, branches 90.00%.
```

## Accepted

- `packages/pipeline` is done under the current release contract: lines 97.09%, statements 96.65%, functions 99.20%, branches 91.63%.

## Package Gaps

These packages are below the current package-level floor, though the aggregate release gate passes:

- `apps/desktop`: statements 94.24%, functions 94.53%, branches 87.92%
- `apps/web`: functions 92.30%
- `packages/shared`: functions 93.99%
- `packages/ui`: statements 94.32%, functions 94.40%

## Next Pass

1. Raise `apps/desktop` branches to 90%, then close its small statement/function gaps.
2. Cover the low-function paths in `apps/web`, `packages/shared`, and `packages/ui`.
3. Keep new package work at or above the release contract before merging.
