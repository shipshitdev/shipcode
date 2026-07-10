---
name: e2e_ci_architecture
description: CI + E2E GitHub Actions wiring on the master trunk — trust gate, affected scoping, pinned gitleaks, build ordering, Electron binary step, caching. MUST read before editing anything under .github/
type: architecture
status: active
priority: low
last_verified: 2026-07-10
topics: [e2e, ci, github-actions, workflow, trunk, branches, cron]
---

**Workflows:** `.github/workflows/ci.yml` (lint/design/typecheck/test backbone) and
`.github/workflows/e2e.yml` (Playwright suite in `e2e/`, added in #227). E2E runs
two projects: `desktop` (real Electron via `_electron.launch`, macOS) and `web-smoke`
(static web/docs over HTTP, Linux), plus a journey **flow-coverage gate**
(`e2e/scripts/check-flow-coverage.mjs`, `E2E_FLOW_COVERAGE_MIN=90`).

## Branch model — trunk-based (migrated 2026-06-16, PR #235)

**Single trunk: `master`.** No `develop`/`staging` — both deleted in the migration.
Matches genfeed.ai / vitae.ai. PRs target `master`; squash-merge after the gates pass;
post-merge push to `master` runs the full suite. Release = tag / dispatch.

`master` is the GitHub **default branch** and is branch-protected: required checks
`Trust Check`, `Lint`, `Design System`, `Typecheck`, `Test`, `Secret Scan`,
`React Doctor`; strict up-to-date; linear history; no force-push; no deletion.
`enforce_admins` is **false** so admin squash-merge still works.

## CI backbone — ci.yml (PR #235)

`on: push:[master], pull_request:[master], schedule '0 6 * * 0', workflow_dispatch,
workflow_call`. Jobs:

- **`trust` (Trust Check):** fork-PR gate. `actions/github-script@v8` checks
  `author_association` (OWNER/MEMBER/COLLABORATOR) or same-repo head, else requires the
  `run-ci` label. Non-PR events auto-trusted. Every other job
  `needs: trust, if: needs.trust.outputs.is-trusted == 'true'`.
- **`lint` (Lint):** `bun run lint` (biome, whole repo — sub-minute, no affected scoping).
- **`design` (Design System):** `bun run lint:design` (`design.md lint DESIGN.md`).
- **`typecheck` (Typecheck):** on PRs `TURBO_SCM_BASE=<pr base sha> bunx turbo run
  typecheck --affected`; full `bun run typecheck` otherwise. `fetch-depth: 0` for the SCM
  diff.
- **`test` (Test):** same affected-on-PR pattern for `turbo run test`; full `test:ci`
  otherwise. `fetch-depth: 0`, ripgrep installed.
- **`coverage` (Coverage):** decoupled — `schedule || workflow_dispatch || push-to-master`
  only, never blocks a PR. `COVERAGE_MIN=80`.

Shared setup lives in the **`.github/actions/setup-bun-env`** composite action (Bun
1.3.14 + Node 22, Bun module store + Turbo cache, optional ripgrep,
`bun install --frozen-lockfile`) — used by every CI job instead of copy-paste.

**CodeQL** (`.github/workflows/codeql.yml`): advisory SAST, `workflow_dispatch` +
weekly cron (`0 5 * * 1`), never on the PR hot path; SARIF → Security tab.

## Secret Scan — gitleaks (PIN it, never fetch `releases/latest`)

`.github/workflows/secret-scan.yml`: license-free gitleaks **filesystem** scan
(`gitleaks dir . --redact --no-banner --exit-code 1`). Required gate on every PR + push.

**Hard rule (broke master 2026-06-16, fixed PR #237):** never resolve the gitleaks
version at runtime via the unauthenticated GitHub API (`curl …/releases/latest | jq .tag_name`).
That call gets rate-limited on shared runners → returns no `tag_name` → `TAG=null` → the
download 404s → the required gate fails. **Pin** `GITLEAKS_VERSION` (env), download the
`*_checksums.txt`, and `sha256sum -c` **before** extracting. The local tarball filename MUST
equal the asset name (`gitleaks_<v>_linux_x64.tar.gz`) — `sha256sum -c` reads the name from
the checksum line, so a renamed download fails verification. Checkout uses
`persist-credentials: false` (filesystem scan needs no token; zizmor artipacked).

Same broken pattern was fanned to and fixed in `ui`, `v0`, `vitae.ai` the same day. The scan
runs on a fresh checkout, so untracked + gitignored local `.env` files are never seen by CI —
verify suspected leaks with `gitleaks dir <git-archive-export>`, not a raw working-tree scan.

## E2E triggers

- **`schedule` (`0 7 * * 0`, weekly Sun 07:00 UTC):** the weekly review. GitHub runs cron
  **only from the default branch (master)** — now satisfied natively (master is the trunk).
  Runs against master.
- **`workflow_dispatch`:** manual. `target_ref` is a **string** input, default `master`;
  point it at any branch/tag (release tag, feature branch under test).
  - `gh workflow run e2e.yml --ref master`
  - Checkout ref = `${{ inputs.target_ref || github.ref }}`: dispatch uses the chosen ref;
    schedule (no inputs) falls through to `github.ref` = master.
- **`pull_request` (paths-filtered):** cheap HTTP-only `web-smoke` on Linux. The heavy
  `desktop-e2e` job is gated to `schedule || workflow_dispatch` — never per-PR.

## Orchestrator: full.yml (CI → E2E in one dispatch)

`.github/workflows/full.yml` runs **CI first, then E2E** in a single manual dispatch,
sequenced by `needs: ci`. No job logic — it `uses:` `ci.yml` and `e2e.yml` as reusable
workflows (both carry a `workflow_call:` trigger). full.yml forwards `github.ref_name` as
e2e's `target_ref`, so e2e's `checkout ref: ${{ inputs.target_ref || github.ref }}`
resolves to the dispatched ref.

- **`ci.yml`:** bare `workflow_call:` (no inputs).
- **`e2e.yml`:** `workflow_call:` with a `target_ref` **string** input (workflow_call
  inputs can't be `type: choice`, unlike the dispatch input).

Key behaviours:

- **Event propagation:** inside a `workflow_call`-invoked file, `github.event_name` is the
  **caller's** event = `workflow_dispatch`. So ci.yml runs its full PR-and-push jobs and
  e2e.yml's `lint-typecheck` + `desktop-e2e` run; `web-smoke` (PR-only) stays skipped.
- **Ordering:** if CI fails, `needs: ci` blocks E2E (no wasted macOS minutes).
- **Permissions:** orchestrator + each called job declare `contents: read`.
- **Registration:** full.yml is now **`workflow_dispatch`-only**. Because master is the
  default branch, GitHub indexes dispatch-only workflows natively — no trick needed. The
  old paths-filtered `pull_request` self-test (a workaround for registering the workflow
  on a non-default `develop`) was **removed in PR #235**; it only existed to make the file
  dispatchable before trunk migration.

Validate edits with `actionlint .github/workflows/*.yml` (checks the `uses:` graph + input
types, not just YAML). Direct `workflow_dispatch` on ci.yml or e2e.yml individually still
works unchanged.

## Caching — "only redo the parts that changed" (best-practice)

Goal (Vincent): after a fix, don't re-run everything green — only the updated parts.
Three sound layers + one explicit reject:

**1. Turbo cache persistence (the real "incremental" win).** Every job that runs a turbo
task persists `.turbo` across runs via `actions/cache` (in CI jobs this is handled by the
`setup-bun-env` composite; e2e jobs carry their own):

```yaml
- uses: actions/cache@v4
  with:
    path: .turbo
    key: turbo-${{ runner.os }}-<job>-${{ github.sha }}
    restore-keys: |
      turbo-${{ runner.os }}-<job>-
      turbo-${{ runner.os }}-
```

`sha` key + prefix `restore-keys` is Turborepo's official CI pattern: each run saves a
fresh snapshot and restores the most recent one; **turbo decides hit/miss by content hash,
not the cache key**. So unchanged packages' `build` / `typecheck` / `test` / `lint` /
`coverage` restore instantly; only changed packages re-run. Per-job key prefix avoids save
collisions (`runner.os` separates Linux vs macOS). Cache dir is `.turbo/cache` (gitignored
via `.turbo/`). Applied to: ci.yml `typecheck`/`test`/`coverage` (via composite
`turbo-key-prefix`); e2e.yml `lint-typecheck`/`desktop-e2e`/`web-smoke`. **E2E specs
themselves are `cache: false` in turbo.json** (non-hermetic — launch real Electron / serve
files) so turbo never caches them; the cache only accelerates their `^build` deps.

**2. Dep + binary caches (speed, not correctness).** Bun module store
(`~/.bun/install/cache`, key `bun-<os>-<hash bun.lock>`) — in CI via the composite, in e2e
inline. Electron binary (`~/Library/Caches/electron`, key
`electron-<os>-<hash apps/desktop/package.json>`) on `desktop-e2e` so install.js doesn't
re-pull ~100 MB from the CDN each run (install.js is idempotent — skips download on a hit).

**3. `--last-failed` opt-in (post-fix loop for E2E, NOT the gate).** Dispatch input
`only_failed` (default **false**) on e2e.yml + full.yml. When true, `desktop-e2e` runs
`playwright test --last-failed` and **skips the flow-coverage gate** (emits a `::notice`
that the run is not authoritative). The failed-test list
(`e2e/test-results/.last-run.json`) is persisted with `actions/cache/save`
(`if: always()`, per-branch key `pw-lastrun-<ref>-<run_id>`) and restored
(`restore-keys: pw-lastrun-<ref>-`) only in `only_failed` mode. Gives "re-run only what
broke" for E2E without weakening the default full run (schedule + plain dispatch).

**4. Rejected: `--only-changed`.** Playwright's `--only-changed` detects changes via the
**static import graph**. This suite exercises **runtime-served artifacts** — desktop
launches the built Electron binary (`executablePath`), web-smoke serves static files over
HTTP — none statically imported into the specs. So `--only-changed` would silently miss
app-source changes and skip tests that should run. Unsound here; not used.

Future speedup (not implemented): Playwright sharding (`--shard=k/n` + `blob` reporter +
`merge-reports`) and/or Vercel Remote Cache (`TURBO_TOKEN`/`TURBO_TEAM`) to share the turbo
cache across machines.

Validate any change with `actionlint .github/workflows/*.yml`.

## Build ordering (the #227 bug, fixed 2026-06-07)

`@shipcode/shared`, `@shipcode/db`, etc. expose their public API via `exports → ./dist/*`
(built `.d.ts`). The desktop bundle is built with `bun --filter @shipcode/desktop
build:code` (`tsc && vite build`) which **bypasses turbo's dep graph**. With no
`packages/*/dist`, tsc fails with dozens of `TS2307: Cannot find module '@shipcode/shared'`
plus cascade `TS7006 implicit any` / Pick<> mismatch errors (the first dispatched run,
27087740056, died exactly here at "Build desktop bundle").

Fix: build workspace packages first, mirroring the repo's `coverage` script idiom:

```yaml
- run: bunx turbo run build --filter='./packages/*'   # emits packages/*/dist + .d.ts
- run: bun --filter @shipcode/desktop build:code       # tsc now resolves the deps
```

Verified locally: clearing `packages/*/dist` reproduces the failure; the two-step sequence
builds clean (exit 0). The TS errors were 100% cascade — no source bug.

Local-dev corollary (hit 2026-07-10): the same `exports → ./dist/*` resolution applies under
`vitest run` and `tsc --noEmit`. After adding an export or a new `DEFAULT_SETTINGS` field to an
internal package, rebuild that package (`bun run build`) before running dependents' tests — a
stale dist fails **silently** (missing field reads as `undefined`, so e.g. a boolean gate
short-circuits instead of throwing).

## Job graph: lint-typecheck → desktop-e2e

A fast **Linux prerequisite gate** runs before the macOS suite so a bad commit fails cheap
(≈1 min) instead of burning scarce macOS minutes:

```
lint-typecheck (ubuntu-latest)  →  desktop-e2e (macos-15, needs: lint-typecheck)
```

`lint-typecheck` runs `bun run lint` (Biome) + `bun run typecheck` (turbo `tsc --noEmit`,
`dependsOn: ^build` so it builds the package `.d.ts` first). Both gated to `schedule ||
workflow_dispatch` (mirror desktop-e2e). `web-smoke` stays independent on `pull_request`.

## Electron binary on CI (the second #227 blocker, fixed 2026-06-07)

Two distinct electron artifacts, two distinct sources — don't conflate them:

- **Types (`electron.d.ts`)** ship **inside the npm tarball** (`package/electron.d.ts`,
  ~1.1 MB). A normal `bun install` extracts them, so the **typecheck gate needs nothing
  extra**. (If they're ever missing locally the bun store is corrupt — restore by copying
  `electron.d.ts` from the tarball; do *not* expect install.js to produce them for v42.)
- **Binary (`Electron.app`)** is downloaded by electron's **postinstall** (`install.js` →
  `@electron/get` → CDN zip → `extract-zip` → writes `dist/` + `path.txt`). **Bun does NOT
  run postinstall scripts** unless the package is a `trustedDependencies` entry — and adding
  electron there churns `bun.lock`, breaking `--frozen-lockfile`. So after `bun install` the
  binary is absent and `require('electron')` throws *"Electron failed to install
  correctly"* (run 27088478619 died here at `electron-app.ts:24`).

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

The weekly E2E currently runs on Vincent's Mac Studio (manual / local — **no launchd plist
or crontab in the repo**). GitHub Actions is "always ready to trigger" (free macOS compute,
public repo) and the weekly cron now fires natively from master, but the macstudio process
is **not disabled** yet. Cut over only once the GH weekly is reliably green on master.
