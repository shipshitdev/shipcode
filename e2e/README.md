# e2e

Repo-level end-to-end coverage for ShipCode (package: `@shipcode/e2e`, issue #227).

This package runs three Playwright projects:

| Project      | What it drives                                                                 | Runner    |
| ------------ | ------------------------------------------------------------------------------ | --------- |
| `desktop`    | The **real Electron app** (built `apps/desktop/dist`) via `_electron.launch`   | macOS GUI |
| `web-smoke`  | The **static web + docs exports** served locally, asserted over HTTP           | any       |
| `cli`        | The **built ShipCode CLI** executed in an isolated temp `HOME`                 | any       |

"E2E coverage" here has explicit gates, not V8 line coverage:

- **App coverage** — every product app under `apps/` has a deterministic E2E
  smoke/journey, defined in [`app-coverage.manifest.json`](./app-coverage.manifest.json)
  and enforced by [`scripts/check-app-coverage.mjs`](./scripts/check-app-coverage.mjs).
- **Journey coverage** — accepted critical user journeys with deterministic specs,
  defined in [`flow-coverage.manifest.json`](./flow-coverage.manifest.json) and
  enforced by [`scripts/check-flow-coverage.mjs`](./scripts/check-flow-coverage.mjs).
- **Page inventory** — derived from the desktop app view/tab/settings unions,
  issue-detail tab union, web home, and docs content routes, enforced by
  [`scripts/check-page-inventory.mjs`](./scripts/check-page-inventory.mjs) so a
  new page cannot be added without updating the manifest.
- **Page coverage** — desktop views/tabs/settings/issue-detail tabs plus every
  exported web/docs route, defined in [`page-coverage.manifest.json`](./page-coverage.manifest.json)
  and enforced by [`scripts/check-page-coverage.mjs`](./scripts/check-page-coverage.mjs).
- **Behavior coverage** — page-level user contracts (navigation, primary
  actions, filtering/state transitions, persistence, route content), defined in
  [`behavior-coverage.manifest.json`](./behavior-coverage.manifest.json) and
  enforced by [`scripts/check-behavior-coverage.mjs`](./scripts/check-behavior-coverage.mjs).

## Running locally

From the repo root:

```bash
bun run e2e         # build prerequisites + run all projects
bun run e2e:smoke   # web/docs + CLI smoke only (no Electron / no GUI needed)
```

Inside this package:

```bash
bun --filter @shipcode/desktop build:code        # prerequisite for the desktop project
cd e2e
bunx playwright test                             # all projects
bunx playwright test --project=desktop           # Electron journeys
bunx playwright test --project=web-smoke         # web/docs smoke
bunx playwright test --project=cli               # CLI smoke
bunx playwright test src/specs/desktop/smoke.e2e.ts   # a single spec
node scripts/check-app-coverage.mjs              # evaluate the app-coverage gate
node scripts/check-flow-coverage.mjs             # evaluate the flow-coverage gate
node scripts/check-page-inventory.mjs            # compare page manifest to app/docs source
node scripts/check-page-coverage.mjs             # evaluate the page-coverage gate
node scripts/check-behavior-coverage.mjs         # evaluate the behavior-coverage gate
```

The `desktop` project requires a **macOS GUI session** (Electron has no headless
mode on macOS). `globalSetup` builds the desktop and CLI bundles automatically
if their selected projects need them and they are missing; the `web-smoke`
project builds each static export on demand.

## How the desktop harness stays deterministic

`src/fixtures/electron-app.ts` launches the built app against a fully isolated,
mocked environment so specs never touch the network or a real model:

- **Isolated data** — a fresh temp `--user-data-dir`; the SQLite DB is pre-seeded
  by `src/fixtures/seed.ts` (real migrations + `@shipcode/db` query classes).
- **No live GitHub / no real CLIs** — fake `gh`, `claude`, and `codex` binaries
  (`fixtures/bin/`) are prepended to `PATH` so health checks resolve them as
  installed + authenticated without real logins (`claude auth status` exits 0,
  `OPENAI_API_KEY` is set for Codex); authoritative GitHub state lives in the
  seeded DB.
- **`SHIPCODE_E2E_MODE=1`** — a guard in the desktop main process that disables
  the reconciliation loop, watchdog timer, update poll, automation scheduler,
  telemetry, and the splash window, and (via the preload) exposes the renderer
  Zustand store on `window.__APP_STORE__` for assertions.
- **No real LLM calls** — `OPENROUTER_API_KEY=test-key`, providers are never
  invoked because pipeline phases are driven by **synthetic push events**
  (`harness.fire('pipeline:phase', …)`) rather than real execution.

The harness exposes `page`, `app`, `seed`, and helpers `fire` (push a
main→renderer IPC event), `getState` / `setState` (read/patch the store), and
`callStore` (invoke a store action). Specs reach a start state via
seed/`callStore`/`setState`, then perform the real user journey through the UI.

## Fixtures

| Location                          | Purpose                                                        |
| --------------------------------- | ------------------------------------------------------------- |
| `fixtures/bin/gh`                 | Deterministic fake GitHub CLI on `PATH`                        |
| `fixtures/bin/claude`             | Fake Claude CLI on `PATH` (`--version`, `auth status` → exit 0)|
| `fixtures/bin/codex`              | Fake Codex CLI on `PATH` (`--version` → exit 0)                |
| `src/fixtures/seed.ts`            | Seeds project / settings / issues / notifications into SQLite |
| `src/fixtures/electron-app.ts`    | Electron launch fixture + IPC/store helpers (`test`, `expect`)|
| `src/fixtures/static-server.ts`   | Builds + serves the static web/docs exports for the smoke     |

## Coverage calculation & gates

`scripts/check-app-coverage.mjs` compares `app-coverage.manifest.json` to
`apps/*/package.json`, writes
`e2e-app-coverage.json`, and exits non-zero when:

- a product app exists without a manifest entry,
- a manifest entry points at a stale or renamed app package,
- an app is flagged `covered` but one of its spec files is missing, or
- app coverage falls below the 100% gate.

Gate precedence: `E2E_APP_COVERAGE_MIN` env → `manifest.gateMinPct` (100) → 100.

`scripts/check-flow-coverage.mjs` reads the manifest, counts flows marked
`covered: true` **whose spec file actually exists**, computes `coveredPct`,
writes `e2e-flow-coverage.json`, and exits non-zero when:

- `coveredPct` is below the gate, or
- a flow is flagged `covered` but its spec file is missing (manifest drift).

Gate precedence: `E2E_FLOW_COVERAGE_MIN` env → `manifest.gateMinPct` (90) → 80.

`scripts/check-page-inventory.mjs` derives the expected surfaces from source and
compares them to `page-coverage.manifest.json`, writing
`e2e-page-inventory.json`. It fails when a view/tab/settings section/issue tab,
web route, or docs route is missing from the manifest, when a stale manifest
surface remains, or when a docs/web route path drifts.

`scripts/check-page-coverage.mjs` applies the same drift check to
`page-coverage.manifest.json`, writes `e2e-page-coverage.json`, and defaults to
a 100% gate. Gate precedence:
`E2E_PAGE_COVERAGE_MIN` env → `manifest.gateMinPct` (100) → 100.

`scripts/check-behavior-coverage.mjs` validates that every required page surface
has at least one covered behavior contract, writes
`e2e-behavior-coverage.json`, and defaults to a 100% gate. Gate precedence:
`E2E_BEHAVIOR_COVERAGE_MIN` env → `manifest.gateMinPct` (100) → 100.

`bun run e2e:ci` runs the suite and then all coverage/inventory gates.

## CI

[`.github/workflows/e2e.yml`](../.github/workflows/e2e.yml):

- **`desktop-e2e`** — nightly (`0 7 * * *`) + `workflow_dispatch`, on `macos-15`.
  Builds the workspace packages first (`turbo run build --filter='./packages/*'`,
  so `@shipcode/shared` et al. emit the `.d.ts` the desktop `tsc` build resolves),
  then the desktop bundle, then runs `bun run e2e:ci` (all projects + gates at
  `E2E_APP_COVERAGE_MIN=100`, `E2E_FLOW_COVERAGE_MIN=90`,
  `E2E_PAGE_COVERAGE_MIN=100`, and
  `E2E_BEHAVIOR_COVERAGE_MIN=100`), uploading the Playwright report / traces /
  coverage JSON artifacts on failure.
  `workflow_dispatch` takes a `target_ref` input (`develop`/`staging`/`master`)
  to choose the branch under test. Note: the nightly **cron only fires from the
  default branch (master)**.
- **`web-smoke`** — on PRs touching apps/E2E/pipeline/ui surfaces, on
  `ubuntu-latest`; runs web/docs + CLI smoke (HTTP/Node only, no Electron).

## Known intentional gaps

Tracked in the manifest `covered` fields. When a journey or page surface is not
yet automated, set `covered: false` and add a `rationale` + `followUp` issue
link; the gates count only covered+present entries, so gaps lower the percentage
honestly rather than hiding.
