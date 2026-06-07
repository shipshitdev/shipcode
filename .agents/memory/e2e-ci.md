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

## Orchestrator: full.yml (CI → E2E in one dispatch)

`.github/workflows/full.yml` runs **CI first, then E2E** in a single manual
dispatch, sequenced by `needs: ci`. It adds **no job logic** — it `uses:` the
existing `ci.yml` and `e2e.yml` as **reusable workflows**. Each of those gained
one additive `workflow_call:` trigger in its `on:` block (job bodies untouched):

- `ci.yml`: bare `workflow_call:` (no inputs).
- `e2e.yml`: `workflow_call:` with a `target_ref` **string** input (workflow_call
  inputs can't be `type: choice`, unlike the dispatch input). full.yml forwards
  `github.ref_name`, so e2e's `checkout ref: ${{ inputs.target_ref || github.ref }}`
  resolves to the dispatched branch.

Key behaviours:

- **Event propagation:** inside a `workflow_call`-invoked file, `github.event_name`
  is the **caller's** event = `workflow_dispatch`. So `ci.yml`'s `quality` +
  `coverage` run (full CI) and `e2e.yml`'s `lint-typecheck` + `desktop-e2e` run.
  `fast-qa` (PR-only) and `web-smoke` (PR-only) stay skipped — correct.
- **Branch = dispatch ref.** Both children run against the branch full.yml is
  dispatched on (`gh workflow run full.yml --ref develop`, or the UI dropdown).
  Works on any branch that has all three files (develop today; staging/master
  once promoted — same model as e2e.yml).
- **Ordering:** if CI fails, `needs: ci` blocks E2E (no wasted macOS minutes).
- **Permissions:** orchestrator + each called job declare `contents: read`.

Validate edits with `actionlint .github/workflows/*.yml` (checks the `uses:`
graph + input types, not just YAML). Direct `workflow_dispatch` on ci.yml or
e2e.yml individually still works unchanged.

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

## Job graph: lint-typecheck → desktop-e2e

A fast **Linux prerequisite gate** runs before the macOS suite so a bad commit fails
cheap (≈1 min) instead of burning scarce macOS minutes:

```
lint-typecheck (ubuntu-latest)  →  desktop-e2e (macos-15, needs: lint-typecheck)
```

`lint-typecheck` runs `bun run lint` (Biome) + `bun run typecheck` (turbo `tsc --noEmit`,
`dependsOn: ^build` so it builds the package `.d.ts` first). Both gates are `schedule ||
workflow_dispatch` (mirror desktop-e2e). `web-smoke` stays independent on `pull_request`.

## Electron binary on CI (the second #227 blocker, fixed 2026-06-07)

Two distinct electron artifacts, two distinct sources — don't conflate them:

- **Types (`electron.d.ts`)** ship **inside the npm tarball** (`package/electron.d.ts`,
  ~1.1 MB). A normal `bun install` extracts them, so the **typecheck gate needs nothing
  extra**. (If they're ever missing locally the bun store is corrupt — restore by copying
  `electron.d.ts` from the tarball; do *not* expect install.js to produce them for v42.)
- **Binary (`Electron.app`)** is downloaded by electron's **postinstall** (`install.js`
  → `@electron/get` → CDN zip → `extract-zip` → writes `dist/` + `path.txt`). **Bun does
  NOT run postinstall scripts** unless the package is a `trustedDependencies` entry — and
  adding electron there churns `bun.lock`, breaking `--frozen-lockfile`. So after
  `bun install` the binary is absent and `require('electron')` throws *"Electron failed to
  install correctly"* (run 27088478619 died here at `electron-app.ts:24`).

Fix: an explicit step in `desktop-e2e` after `bun install` that runs install.js
version-agnostically and verifies the path resolves (throws loudly if not):

```yaml
- name: Ensure Electron binary is installed
  working-directory: apps/desktop
  run: |
    ELECTRON_DIR="$(node -p "require('path').dirname(require.resolve('electron/package.json'))")"
    node "$ELECTRON_DIR/install.js"
    node -e "console.log(require('electron'))"   # verify: throws if binary missing
```

`path.txt` must have **no trailing newline** (`getElectronPath` does
`join(__dirname,'dist', readFileSync(path.txt))`); install.js writes it correctly. The
lint-typecheck gate does **not** need this step (types come from the tarball).

## macstudio (still authoritative for now)

The weekly E2E currently runs on Vincent's Mac Studio (manual / local — **no launchd
plist or crontab in the repo**). GitHub Actions is being made "always ready to trigger"
(free macOS compute, public repo) but the macstudio process is **not disabled** yet.
Cut over only when the GH weekly is green on master post-promotion.
