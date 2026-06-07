---
name: e2e_ci_architecture
description: How the E2E GitHub Actions workflow is wired across develop/staging/master — triggers, weekly cron, build ordering, and the macstudio relationship
type: architecture
status: active
last_verified: 2026-06-07
topics: [e2e, ci, github-actions, workflow, branches, cron]
---

**Workflow:** `.github/workflows/e2e.yml` (suite in `apps/e2e/`, added in #227). Runs
two Playwright projects: `desktop` (real Electron via `_electron.launch`, macOS) and
`web-smoke` (static web/docs over HTTP, Linux). Plus a journey **flow-coverage gate**
(`apps/e2e/scripts/check-flow-coverage.mjs`, `E2E_FLOW_COVERAGE_MIN=90`).

## Branch model

`develop` (integration) → `staging` → `master` (GitHub **default** branch + release).
As of 2026-06-07 the E2E suite lives **only on develop**; master/staging are ~72
commits behind and have no `apps/e2e`. Promotion of the app code happens later — the
workflow is intentionally set up so all three branches light up with no further edits
once promoted.

## Triggers

- **`schedule` (`0 7 * * 0`, weekly Sun 07:00 UTC):** the weekly review. **GitHub runs
  cron ONLY from the workflow file on the default branch (master).** So the weekly will
  not fire until `e2e.yml` is promoted to master; on develop/staging the cron stanza is
  dormant (GitHub ignores it). This is by design — weekly is meant to run against master.
- **`workflow_dispatch`:** manual run, available on any branch that has the file. A
  `target_ref` choice input (`develop`/`staging`/`master`, default `develop`) selects
  which branch's code to check out and test. Dispatch works on develop **today** even
  though the file is not on master (only *cron* needs the default branch).
  - `gh workflow run e2e.yml --ref develop` — trigger from CLI.
  - Checkout ref = `${{ inputs.target_ref || github.ref }}`: dispatch uses the chosen
    branch; schedule (no inputs) falls through to `github.ref` = master.
- **`pull_request` (paths-filtered):** cheap HTTP-only `web-smoke` on Linux. The heavy
  `desktop-e2e` job is gated to `schedule || workflow_dispatch` — never per-PR.

## Build ordering (the #227 bug, fixed 2026-06-07)

`@shipcode/shared`, `@shipcode/db`, etc. expose their public API via `exports → ./dist/*`
(built `.d.ts`). The desktop bundle is built with `bun --filter @shipcode/desktop
build:code` (`tsc && vite build`) which **bypasses turbo's dep graph**. With no
`packages/*/dist`, tsc fails with dozens of `TS2307: Cannot find module
'@shipcode/shared'` plus cascade `TS7006 implicit any` / Pick<> mismatch errors (the
first dispatched run, 27087740056, died exactly here at "Build desktop bundle").

Fix: build workspace packages first, mirroring the repo's `coverage` script idiom:

```yaml
- run: bunx turbo run build --filter='./packages/*'   # emits packages/*/dist + .d.ts
- run: bun --filter @shipcode/desktop build:code       # tsc now resolves the deps
```

Verified locally: clearing `packages/*/dist` reproduces the failure; the two-step
sequence builds clean (exit 0). The TS errors were 100% cascade — no source bug.

## macstudio (still authoritative for now)

The weekly E2E currently runs on Vincent's Mac Studio (manual / local — **no launchd
plist or crontab in the repo**). GitHub Actions is being made "always ready to trigger"
(free macOS compute, public repo) but the macstudio process is **not disabled** yet.
Cut over only when the GH weekly is green on master post-promotion.
