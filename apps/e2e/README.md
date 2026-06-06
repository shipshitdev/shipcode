# @shipcode/e2e

Repo-level end-to-end coverage for ShipCode (issue #227).

This package runs two Playwright projects:

| Project      | What it drives                                                                 | Runner    |
| ------------ | ------------------------------------------------------------------------------ | --------- |
| `desktop`    | The **real Electron app** (built `apps/desktop/dist`) via `_electron.launch`   | macOS GUI |
| `web-smoke`  | The **static web + docs exports** served locally, asserted over HTTP           | any       |

"E2E coverage" here is **journey coverage** — the fraction of accepted critical
user journeys that have an automated, deterministic spec — not V8 line coverage.
It is defined in [`flow-coverage.manifest.json`](./flow-coverage.manifest.json)
and enforced by [`scripts/check-flow-coverage.mjs`](./scripts/check-flow-coverage.mjs).

## Running locally

From the repo root:

```bash
bun run e2e         # build prerequisites + run both projects
bun run e2e:smoke   # web/docs smoke only (no Electron / no GUI needed)
```

Inside this package:

```bash
bun --filter @shipcode/desktop build:code        # prerequisite for the desktop project
cd apps/e2e
bunx playwright test                             # all projects
bunx playwright test --project=desktop           # Electron journeys
bunx playwright test --project=web-smoke         # web/docs smoke
bunx playwright test src/specs/desktop/smoke.e2e.ts   # a single spec
node scripts/check-flow-coverage.mjs             # evaluate the flow-coverage gate
```

The `desktop` project requires a **macOS GUI session** (Electron has no headless
mode on macOS). `globalSetup` builds the desktop bundle automatically if it is
missing; the `web-smoke` project builds each static export on demand.

## How the desktop harness stays deterministic

`src/fixtures/electron-app.ts` launches the built app against a fully isolated,
mocked environment so specs never touch the network or a real model:

- **Isolated data** — a fresh temp `--user-data-dir`; the SQLite DB is pre-seeded
  by `src/fixtures/seed.ts` (real migrations + `@shipcode/db` query classes).
- **No live GitHub** — a fake `gh` binary (`fixtures/bin/gh`) is prepended to
  `PATH` and returns benign fixtures; authoritative state lives in the seeded DB.
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
| `src/fixtures/seed.ts`            | Seeds project / settings / issues / notifications into SQLite |
| `src/fixtures/electron-app.ts`    | Electron launch fixture + IPC/store helpers (`test`, `expect`)|
| `src/fixtures/static-server.ts`   | Builds + serves the static web/docs exports for the smoke     |

## Coverage calculation & gate

`scripts/check-flow-coverage.mjs` reads the manifest, counts flows marked
`covered: true` **whose spec file actually exists**, computes `coveredPct`,
writes `e2e-flow-coverage.json`, and exits non-zero when:

- `coveredPct` is below the gate, or
- a flow is flagged `covered` but its spec file is missing (manifest drift).

Gate precedence: `E2E_FLOW_COVERAGE_MIN` env → `manifest.gateMinPct` (90) → 80.
`bun run e2e:ci` runs the suite and then the gate.

## CI

[`.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml):

- **`desktop-e2e`** — weekly (`0 7 * * 0`) + `workflow_dispatch`, on `macos-15`.
  Builds the desktop bundle, runs `bun run e2e:ci` (both projects + gate at
  `E2E_FLOW_COVERAGE_MIN=90`), uploads the Playwright report / traces /
  `e2e-flow-coverage.json` on failure.
- **`web-smoke`** — on PRs touching E2E/desktop/web/docs/pipeline/ui surfaces,
  on `ubuntu-latest` (HTTP-only, no Electron).

## Known intentional gaps

Tracked in the manifest's `flows[].covered` field. When a journey is not yet
automated, set `covered: false` and add a `rationale` + `followUp` issue link;
the gate counts only covered+present flows, so gaps lower the percentage
honestly rather than hiding.
