# Repo Map — ShipCode Monorepo Audit (Session 00)

Date: 2026-07-02
Scope: full repository at `shipshitdev/shipcode`, `master` trunk, v0.1.3.
Method: every claim below was verified by reading the referenced files (6 parallel mapping agents + direct inspection). No code was changed. Unknowns are flagged inline where evidence was missing.

---

## 1. System overview

**ShipCode** is an AI dev-pipeline orchestrator: "GitHub issue in, reviewed PR out." A labeled GitHub issue is planned, adversarially reviewed, executed, verified, and shipped as a PR by AI agent CLIs (Claude, Codex, Cursor, Gemini) or the OpenRouter HTTP API, each phase running in an isolated git worktree. It ships as two products from one codebase: an Electron desktop app and a published npm CLI, plus a static marketing/docs site.

| Dimension | Fact | Evidence |
|---|---|---|
| Monorepo tooling | Turborepo 2.9.16 + Bun 1.3.14 workspaces (`apps/*`, `packages/*`, `e2e`) | `package.json` (`packageManager`, `workspaces`), `turbo.json` |
| Language | TypeScript 6.0.3 everywhere, strict; Biome 2.4.16 for lint/format | root/app/package `package.json`s, `biome.json` |
| Size | ~238K lines of TS/TSX source (incl. tests), 358 test files, 848 source files across workspaces | `find`/`wc` over `apps packages e2e` excl. build output |
| Version | All workspaces lockstep at 0.1.3 (e2e at 0.0.0) | every `package.json` |
| Branching | Trunk-based on `master`, squash merge, 7 required checks (Trust Check, Lint, Design System, Typecheck, Test, Secret Scan, React Doctor) | live `gh api .../branches/master/protection`; `.agents/memory/e2e-ci.md` |
| Maturity | Pre-release, public repo, active development warning in README | `README.md:5-7` |

Core runtime stack: Electron 42.3.3 / React 19.2.7 / Tailwind CSS 4.3.0 (desktop), Node ≥22.5 (CLI, required for `node:sqlite`), Next.js 16.2.7 (web/docs), SQLite via Node's built-in `node:sqlite` (no ORM), Playwright 1.60.0 (E2E), Vitest 4.1.8 (unit).

---

## 2. Repo/package map

### Apps

| Workspace | Name | What it is | Key stack (exact versions) |
|---|---|---|---|
| `apps/desktop` | `@shipcode/desktop` (private) | Electron desktop app, the primary product. 333 source files. | Electron 42.3.3, electron-builder 26.8.1, Vite 8.0.16 + vite-plugin-electron 1.0.2, React 19.2.7, Tailwind 4.3.0, zustand 5.0.14, @tanstack/react-query 5.101.0, @xterm/xterm 6.0.0, croner 10, @sentry/electron |
| `apps/cli` | `@shipshitdev/shipcode` (**public npm**) | Headless CLI, same pipeline. 14 commands (`onboard`, `skills seed`, `status`, `run`, `start`, `plan`, `approve`, `review`, `retry`, `logs`, `terminal`, `terminal-summary`, `terminal-comment`, `prd`) registered in `apps/cli/src/program.ts:28-98`. | commander 15.0.0, tsup 8.5.1 (bundles workspace pkgs via `noExternal`), node-pty 1.1.0, simple-git 3.36.0, zod 4.4.3. Node ≥22.5.0 enforced at runtime (`apps/cli/src/index.ts:1-7`) |
| `apps/web` | `@shipcode/web` (private) | Marketing site, single landing route. | Next.js 16.2.7 `output: 'export'` (`apps/web/next.config.ts`), Tailwind v4 CSS-based config (`apps/web/app/globals.css` — no `tailwind.config.*`), no API routes, no analytics |
| `apps/docs` | `@shipcode/docs` (private) | Docs site, content-driven MDX (8 top-level sections; `desktop/` alone has 13 pages). Never deployed standalone — built with `DOCS_BASE_PATH=/docs` and copied into `apps/web/public/docs` by `scripts/sync-docs-to-web.sh`. | Nextra 4.6.1 + nextra-theme-docs 4.6.1 (both **patched** via `patches/`), Next.js 16.2.7 static export |

### Packages

| Workspace | Purpose | Notable internals |
|---|---|---|
| `packages/pipeline` | Phase state machine + orchestration. 12,052 lines in `src/`. | Explicit dispatch loop over `PhaseOutcome`s (`src/pipeline.ts:66-115`); phase handlers split into `src/pipeline/` (planning-phases, execution-phases, execution-shipping-phases, runtime, context). Dynamic-workflow **fan-out executor** (`src/pipeline/fan-out-executor.ts`): N parallel workers (default 3, max 8) + judge + winner promotion, opt-in per repo via `agent.execute_orchestration: fan-out` in `WORKFLOW.md` (`src/workflow-loader.ts`). Also: `gh-sync-queue`, `issue-group-scheduler`, `phase-sync`, `reconciliation-loop`, `retry-scheduler`, `template-renderer` (liquidjs 10.27.0), `workflow-watcher`. |
| `packages/agents` | Agent providers + process control. 149 source files. | Providers: `claude`/`codex` (`providers/cli-provider.ts`), `cursor`, `gemini`, `openrouter` (HTTP SSE client `providers/openrouter-http.ts` — native fetch, 429 backoff, no SDK dep) + `registry`. `AgentType = 'claude' \| 'codex' \| 'gemini' \| 'cursor' \| 'gh' \| 'openrouter' \| 'shell'` (`packages/shared/src/types/agents.ts:3`). Per-phase run mode `programmatic \| interactive` (`claude -p --output-format stream-json` vs PTY; `packages/shared/src/types/pipeline-core.ts:33-61`). OS sandbox for programmatic Claude execute via `@anthropic-ai/sandbox-runtime` 0.0.55 (`src/sandbox/srt.ts`) — fails closed if unavailable. GitHub via `gh` CLI wrapper (`src/github/gh-cli.ts`) — no octokit. `process-manager.ts` owns node-pty. Skills embedded as generated code (`src/skills/defaults.generated.ts`). |
| `packages/db` | SQLite persistence. | Node built-in `node:sqlite` (`DatabaseSync`), no ORM, no external driver (`src/index.ts:1-15`). WAL + tuned PRAGMAs. **31 tables**; hand-rolled sequential migrations `migrate()`→`migrateV63()` across 5 files (`src/migrations/base-schema.ts`, `v02-v20.ts`, `v21-v40.ts`, `v41-v62.ts`, `v63-v80.ts`). One anomaly: `issue_edges` is created out-of-band by `src/queries/issue-edges.ts`, and `src/migrations/20260423_issue_edges.sql` is an orphaned reference file never executed. 30 `*Queries` classes exported. Manual `BEGIN/COMMIT/ROLLBACK` transaction helper (`src/utils.ts`) — no nesting support. |
| `packages/git` | Git/worktree layer over simple-git 3.36.0. | `WorktreeManager` (create with collision retry, `remove(path, branch)` takes concrete values by contract, repair/prune/move/list/merge) and `GitService` (25 methods, 388 lines). `RemoteBranchSnapshot` type defined but not re-exported from the barrel. |
| `packages/shared` | Leaf types/utils package (only runtime dep: zod 4.4.3). | 30 barrel modules (`src/index.ts`); `worktree-path.ts` deliberately isolated on its own subpath export (`@shipcode/shared/worktree-path`) to avoid Vite renderer externalization. `AppSettings` has ~60 fields (`src/types/settings.ts:18-154`) including per-phase model routing, sandbox policy, Discord/Telegram integration, concurrency limits. Model presets `claude \| codex \| hybrid \| opus-combo \| fable-combo` (`src/model-config-presets.ts`) — opus-combo: Opus 4.8 plans, GPT-5.5 reviews/executes, GPT-5.4 Mini verifies; fable-combo: Fable 5 plans, GPT-5.6 Sol reviews, Terra executes, Luna verifies. |
| `packages/ui` | Internal ShipCode-specific feature-component library (KanbanBoard, DiffViewer, PlanViewer, GitVisualizer, …). | tsup 8.5.1 dual ESM/CJS build with `"use client"` banner; Radix deps; Tailwind classes with **consumer-provided** Tailwind compiler (no tailwindcss dep in the package). Public barrel exports ~25 feature components; the `primitives/` dir (badge, button, dropdown-menu, select) is internal-only. Layering (per owner): the separately published `@shipshitdev/ui@0.8.0` npm package (`bun.lock:874`) is the shared cross-project **primitives** layer (Button, Badge, Card, Alert, …) consumed directly by the desktop renderer (`apps/desktop/src/renderer/App.tsx:4`), while `packages/ui` holds app-specific feature components layered above it — deliberate wrapper split, not duplication. |
| `e2e` | Playwright 1.60.0 suite. | 18 spec files (15 desktop, 2 web, 1 cli); 3 Playwright projects; desktop project launches the **real built Electron app** with temp userData, seeded SQLite, fake `gh`/`claude`/`codex` binaries on PATH, and `SHIPCODE_E2E_MODE=1` (`e2e/src/fixtures/electron-app.ts:16-77`). 4 coverage manifests gate app/flow/page/behavior coverage. |

### Inter-package dependency edges (from package.json `dependencies`)

`shared` ← (db, git, pipeline, agents, ui*) — leaf.
`pipeline` → agents, db, git, shared.
`agents` → shared.
`apps/desktop` → agents, db, git, pipeline, shared, ui.
`apps/cli` → same set as devDependencies, **bundled** into `dist/index.js` via tsup `noExternal` (`apps/cli/tsup.config.ts:14-20`).
`apps/web` → shared, ui. `apps/docs` → ui. (*ui bundles shared at build time despite listing it as devDependency-only — `packages/ui/tsup.config.ts`.)

Workspace consumption (as of 2026-07-02): all internal cross-package imports use package roots; `./source` subpath exports were removed from shared/agents/db. The only source-level indirection left is the deliberate Vite dev alias for `@shipcode/ui` (`apps/desktop/shipcode-ui-source-alias.ts`, renderer HMR).

### Other top-level directories

| Path | Contents |
|---|---|
| `skills/` | 14 app-runtime prompt skills (adversarial-review, plan-generation, plan-execution, plan-execution-tdd, plan-revision, plan-verification, pr-generation, prd-quality-gate, execution-debugging, context-engineering, github-label-sync, issue-terminal-session, skill-security-auditor, writing-prds). Compiled into `packages/agents/src/skills/defaults.generated.ts` by `scripts/build-skill-defaults.ts`; CI verifies sync. |
| `scripts/` | 12 operational scripts: git-hook setup, node-pty permission fix (Bun tarball mode-bit bug), skills symlink management, affected-workspace verifier, sharded coverage runner + summary gate, docs→web sync, agent-memory compiler, raw-HTML lint (2 variants), staged Biome. |
| `docs/` | Thin: `cli-demo.png`, `screenshot.svg`, `coverage-leftovers.md` (dated 2026-05-24), `superpowers/plans/` (2 historical plan docs). Real docs live in `apps/docs/content/`. |
| `patches/` | Bun `patchedDependencies` for nextra@4.6.1 (disables eager twoslash import broken on Node 25) and nextra-theme-docs@4.6.1 (schema fix). |
| `.agents/` | Committed repo memory (`memory/`, `SESSIONS/`, `skills/`, `SYSTEM/`). `AGENTS.md` at root is generated from it by `scripts/sync-agent-memory.sh`. |
| `.githooks/` | Single `pre-commit` hook: staged Biome fix + raw-HTML element block. Wired via `core.hooksPath` in postinstall. |

---

## 3. Runtime/deployment map

| Artifact | Target | Mechanism | Evidence |
|---|---|---|---|
| Desktop macOS | dmg + zip, x64 and arm64, **unsigned** (ad-hoc signature only: `mac.identity: null`, afterPack `codesign --sign -`) | electron-builder in `publish.yml` on GitHub-hosted macos-15 runners; uploaded to GitHub Release; Homebrew cask `shipshitdev/homebrew-tap` updated with SHA256s | `apps/desktop/electron-builder.yml:20-23`, `apps/desktop/scripts/ad-hoc-sign.cjs`, `.github/workflows/publish.yml:218-302` |
| Desktop Linux | AppImage + deb | electron-builder on ubuntu-latest, uploaded to GitHub Release | `.github/workflows/publish.yml:146-217` |
| Desktop Windows | **Not built** | no `win:` target configured | `apps/desktop/electron-builder.yml` |
| CLI | npm `@shipshitdev/shipcode`, `bin: shipcode` | `npm publish --provenance` via OIDC Trusted Publisher (no token secret), gated by `vars.NPM_PUBLISH_ENABLED` | `.github/workflows/publish.yml:303-354`, `apps/cli/package.json:12-20` |
| Web + docs | Vercel production (project `prj_em8zYt0Lxin5PqxObNI47qBl2fOa`, hardcoded), fully static (`output: 'export'`, `outputDirectory: apps/web/out`) | `vercel pull/build/deploy --prebuilt --prod` in publish.yml, or manual `bun run deploy:web`; git auto-deploy disabled (`git.deploymentEnabled: false`) | `vercel.json`, `apps/web/vercel.json`, `.github/workflows/publish.yml:116-144` |
| Auto-update | **Notify-only**: `UpdateService` polls GitHub Releases API every 30 min and pushes a banner event; no in-app download/install | — | `apps/desktop/src/main/update-service.ts:1-187` |

Release gating: `validate-release` enforces tag ↔ `apps/cli` ↔ `apps/desktop` version equality; `release-quality` runs lint/typecheck/test/builds/CLI smoke before any artifact job (`.github/workflows/publish.yml:46-114`).

Desktop process architecture: main entry `apps/desktop/src/main/index.ts` (48 flat files + `ipc/`), preload exposes a frozen `{invoke, on}` bridge (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`), strict CSP `default-src 'none'` in production, navigation locked to the bundled origin (`apps/desktop/src/main/index-helpers.ts:146-235`). **202 `ipcMain.handle` registrations** across 15 domain handler files, all wrapped by a timing/Sentry decorator in `src/main/ipc.ts`. Largest: register-project-handlers.ts (61), register-pipeline-handlers.ts (37), register-github-handlers.ts (26).

Pipeline phase model (13 states): `idle, planning, clarifying, reviewing, revising, approval, executing, testing, verifying, shipping, paused, completed, failed` (`packages/shared/src/types/pipeline-core.ts:5-19`). Dispatch chain: plan → review → (revision ↔ review) → execute → testing → verification → commit → shipping, with cancelable retry outcomes (`packages/pipeline/src/pipeline.ts:66-115`).

---

## 4. Data/auth/integration map

**Database.** Single local SQLite file `~/.shipcode/data/shipcode.db` (per-user, no server DB anywhere). Opened with WAL, `busy_timeout=5000`, `synchronous=NORMAL`, mmap/cache tuning (`packages/db/src/index.ts`). 31 tables covering projects, threads, plans, reviews/findings, verifications, checkpoints, pipeline run/phase/step logs, terminal events, agent conversations, automations, skills, task graphs, triage rules, telemetry, settings. Migration = sequential numbered functions, idempotent-ish via "duplicate column" catch (`packages/db/src/migrations/schema-helpers.ts`). No Postgres/Prisma/Redis in this repo despite them being the owner's usual stack — this codebase is fully local-first.

**Auth.** ShipCode has no auth provider of its own. It delegates:
- GitHub → `gh` CLI's own auth (`packages/agents/src/github/gh-cli.ts`; `onboard` verifies `gh auth` — `apps/cli/src/commands/onboard.ts:47-230`).
- Claude/Codex/Cursor/Gemini → each CLI's own subscription login (health-checked at onboarding).
- OpenRouter → `OPENROUTER_API_KEY` env var (`packages/agents/src/providers/openrouter-provider.ts:84,181`).
- No direct Anthropic/OpenAI API usage anywhere (only `@anthropic-ai/sandbox-runtime` for the srt sandbox).

**Secrets at rest.** Telegram bot token and Discord webhook URL are stored as **plaintext rows in the SQLite `settings` table** (`packages/shared/src/types/settings.ts` fields `telegramBotToken`, `discordWebhookUrl`; persisted via `packages/db/src/queries/settings.ts:588`). No `keytar` and no Electron `safeStorage` usage anywhere in `apps/desktop/src` (grep: zero matches).

**Integrations.**

| Service | Where | Notes |
|---|---|---|
| GitHub (issues, labels, PRs, comments, releases) | `packages/agents/src/github/*` via `gh` CLI; label sync `apps/desktop/src/main/github-pipeline-label-sync.ts`; issue-comment→chat sync `issue-chat-comment-sync.ts` | Settings-driven polling (`githubPollingEnabled`, `githubPollingIntervalMs`) |
| OpenRouter | `packages/agents/src/providers/openrouter-http.ts` | OpenAI-compatible SSE, native fetch, 429 retry w/ jitter |
| Sentry | `@sentry/electron` main + renderer (`apps/desktop/src/main/telemetry.ts`, `src/renderer/telemetry.ts`) | DSN only from env (`SHIPCODE_SENTRY_DSN`/`SENTRY_DSN`), user-consent gated (`telemetryEnabled`), no hardcoded DSN in repo |
| Telegram / Discord | `apps/desktop/src/main/chat-notification-service.ts` | Outbound pipeline-event notifications (bot API / webhooks) |
| Vercel, Homebrew, npm | publish workflow only | Secrets: `VERCEL_TOKEN`, `TAP_GITHUB_TOKEN`, `GITHUB_TOKEN` — the only 3 secrets referenced in all of `.github/` |

**Background jobs.** All in-process (no queue infrastructure): `AutomationScheduler` (cron expressions via croner 10), `PipelineScheduler`, `ReconciliationLoop` (`packages/pipeline/src/reconciliation-loop.ts`), `RetryScheduler` with backoff, GitHub issue poller, 30-min update poll, `ResourceMonitor` + CPU-throttle settings. Weekly repo-level crons live in GitHub Actions (see §5).

**Observability.** Sentry (opt-in) + `electron-log` structured event log (`logger.service.ts`) + local `prompt_telemetry`/`pipeline_*_log` SQLite tables + dev-mode slow-IPC metrics (threshold 150 ms, `apps/desktop/src/preload/index.ts`). No PostHog, no OpenTelemetry, no product analytics anywhere (web included).

---

## 5. CI/test/tooling map

**Workflows** (all runners GitHub-hosted; no self-hosted runner exists in `.github/` — the "macstudio" in repo memory is a manual local process, see risks):

| Workflow | Trigger | Jobs / purpose |
|---|---|---|
| `ci.yml` | push/PR to master, Sun 06:00 UTC cron, dispatch, workflow_call | trust gate (external-PR protection: repo match / author association / `run-ci` label) → lint, design (`design.md lint`), typecheck, test. PRs use `turbo --affected` with `TURBO_SCM_BASE`; pushes run full. Coverage job (cron/dispatch/master-push only) with `COVERAGE_MIN=80`. |
| `e2e.yml` | Sun 07:00 UTC cron, dispatch, workflow_call, PR (paths: e2e/apps/pipeline/ui) | `web-smoke` per-PR on ubuntu (Playwright web+cli projects, no Electron); `desktop-e2e` weekly/manual on macos-15 running full suite + 4 coverage gates (app 100 / flow 90 / page 100 / behavior 100). Manual Electron `install.js` workaround for Bun. **Not a required merge check.** |
| `full.yml` | dispatch only | One-button chain: ci.yml → e2e.yml. |
| `publish.yml` | release published, dispatch | validate-release → release-quality → deploy-web, linux/macOS desktop builds, Homebrew cask, npm CLI (see §3). |
| `codeql.yml` | Mon 05:00 UTC cron, dispatch | JS/TS scan of `apps/`+`packages/`, advisory (never on PR). |
| `react-doctor.yml` | PR + master push | millionco/react-doctor@v2, sticky comment, required check. |
| `secret-scan.yml` | every push/PR | gitleaks v8.30.1 pinned tarball + SHA256 verification, filesystem scan, required check. |

Shared composite action `.github/actions/setup-bun-env` (Bun 1.3.14 default, Node 22, Bun+Turbo caches, `--frozen-lockfile`).

**Testing.**
- Unit: Vitest 4.1.8. `vitest.workspace.ts` lists only 5 projects (shared, agents, db, pipeline, desktop) — cli/web/docs/git/ui run their own vitest via turbo `test` but are outside the workspace file. Shared config factories: `vitest.coverage.ts`, `vitest.package-config.ts`.
- Coverage: sharded runner `scripts/run-coverage-shards.mjs` (4 shards, blob merge) + `scripts/coverage-summary.mjs` gate. **Two different floors exist**: local script default 95/95/95/90, CI env sets 80/80.
- E2E: Playwright 1.60.0, 18 specs, serial (`workers: 1`), real Electron launch with seeded DB + fake agent binaries.

**Code quality tooling.** Biome 2.4.16 (single quotes, 100 cols, organizeImports); `@google/design.md` 0.2.0 linting `DESIGN.md` (383-line design token spec, required CI check); react-doctor with 5 targeted per-file rule suppressions (`doctor.config.json`); knip via ad-hoc `bunx knip` (version unpinned, not a devDependency); clawpatch 0.5.0 (codex-provider AI review, no auto-commit/PR — `clawpatch.config.json`); `code-review-graph` MCP registered for Codex (`codex.json`); pre-commit hook (Biome + raw-HTML blocker); `bunfig.toml` sets `minimumReleaseAge = 3h` (supply-chain mitigation).

**Custom verification.** `scripts/verify-affected-workspaces.ts` — git-diff → affected-workspace resolution → topo-ordered dependency builds → per-package typecheck/test (241 lines, used for focused local verification).

---

## 6. Main architectural risks noticed during mapping

Factual observations only; remediation belongs to follow-up sessions.

1. **Plaintext secrets in SQLite.** `telegramBotToken` and `discordWebhookUrl` live unencrypted in `~/.shipcode/data/shipcode.db` `settings` table; no `safeStorage`/`keytar` anywhere in the desktop app. Any local process (or a pipeline agent with a mis-scoped worktree) reading that file gets them. (`packages/shared/src/types/settings.ts`, `packages/db/src/queries/settings.ts`) — These power the Telegram/Discord pipeline-event notifications in `apps/desktop/src/main/chat-notification-service.ts`.
2. ~~Two UI libraries in the same renderer.~~ **Resolved as intended layering** (2026-07-02): `@shipshitdev/ui@0.8.0` is the shared cross-project primitives layer; `packages/ui` holds ShipCode-specific feature components above it. See §2 package table.
3. **Hand-rolled 63-step migration chain** in 5 range-named files, plus the out-of-band `issue_edges` table created by a query module and an orphaned never-executed `20260423_issue_edges.sql`. No down-migrations, no framework. Fragile as table count (31) keeps growing. (`packages/db/src/migrations/`, `packages/db/src/queries/issue-edges.ts`)
4. ~~Three inconsistent workspace-consumption patterns.~~ **Fixed 2026-07-02**: all `/source` deep imports converted to package-root imports and the `./source` export subpaths removed from `@shipcode/shared`, `@shipcode/agents`, `@shipcode/db` — every bundle now resolves each workspace package exactly one way (dist for bundled root imports, src for `@shipcode/ui` via its deliberate dev alias), eliminating the dual-module-instance hazard in the desktop main bundle. Remaining deliberate subpaths: `@shipcode/shared/worktree-path`, `@shipcode/ui/second-ticker`.
5. **Unsigned macOS distribution + notify-only updates.** Ad-hoc signature, Gatekeeper `xattr` workaround documented in README, and `UpdateService` cannot install updates — users on old builds stay there. (`apps/desktop/electron-builder.yml:20-23`, `update-service.ts`) — **Accepted for now** (owner decision, 2026-07-02): pre-release "green app" state.
6. **IPC god-files.** 202 IPC handlers total; `register-project-handlers.ts` alone has 61. The decorator gives uniform logging, but per-handler input validation depth was not verifiable in this pass (unknown — needs the security session).
7. **Coverage-floor incoherence.** Local gate 95/90, CI weekly gate 80/80, E2E manifests 100/90/100/100. It is not determinable from the repo which number is the actual standard. (`scripts/coverage-summary.mjs`, `ci.yml:150-181`, `e2e.yml:58-61`)
8. **E2E is advisory.** Desktop E2E runs weekly only; web-smoke runs on PRs but is not a required check. Regressions in the Electron app can merge gated only by unit tests. (live branch-protection query; `e2e.yml`) — **Partially addressed 2026-07-02**: a `Build` job (turbo build of all workspaces + desktop `build:code`, affected-scoped on PRs, mirroring genfeed.ai's CI) was added to `ci.yml`; making it a required branch-protection check needs one green run first, then a repo-settings update.
9. ~~Version drift in CI pins.~~ **Fixed 2026-07-02**: publish.yml Bun pinned to 1.3.14 (lockstep comment added); publish-cli's Node 24 documented as deliberate (npm Trusted Publishing needs npm ≥ 11.5); knip pinned as devDependency 6.23.0; `engines.node >=22.5.0` added to root package.json. Coverage floor unified at 95/90 in ci.yml (matching `scripts/coverage-summary.mjs` defaults and the release contract in `docs/coverage-leftovers.md`).
10. ~~Docs/README staleness.~~ **Fixed 2026-07-02**: CLI README now documents all 14 commands; root README diagram and docs phase tables no longer reference "Opus 4.6" (default planner is Claude Sonnet 4.6 per `PINNED_MODEL_DEFAULTS`, `packages/shared/src/model-catalog.ts:105`).
11. **Hardcoded deploy identity.** Vercel project ID is inline in `publish.yml:123` rather than a var like its sibling `VERCEL_ORG_ID`.
12. **Sandbox dependency pre-1.0.** The fail-closed Claude execute sandbox rests on `@anthropic-ai/sandbox-runtime` 0.0.55 with an asar-unpack special case; version churn there directly affects the security posture. (`packages/agents/src/sandbox/srt.ts`, `electron-builder.yml:10-14`)
13. **Unverified legacy process.** Repo memory says the personal Mac Studio still runs the "authoritative" weekly E2E manually (`.agents/memory/e2e-ci.md`, last_verified 2026-06-16); nothing in-repo can confirm whether the GitHub cron has actually replaced it. **Missing evidence: external to repo.**

Known unknowns carried forward: per-handler IPC validation depth; whether `@shipshitdev/shipcode` latest on npm matches 0.1.3 (no network check performed); full contents of `security.ts`/`worktree-locks.ts`; whether GitHub rulesets add checks beyond the classic protection API's 7; knip's resolved version.

## 7. Suggested follow-up audit sessions

1. **01 — Dependency & dead-code audit.** Run knip (now pinned at 6.23.0), verify the orphaned `issue_edges.sql` and other unreferenced files. (UI-library reconciliation dropped — layering confirmed intentional; Bun/Node pins and root `engines` fixed 2026-07-02.)
2. **02 — Security audit.** Secrets-at-rest (move Telegram/Discord tokens to `safeStorage`), IPC input validation sampling across the 202 handlers, `sandbox: false` justification, srt sandbox failure modes, worktree path-escape review (`assertWorkspaceSafe` coverage), gitleaks full-history scan.
3. **03 — Data layer audit.** Migration chain consolidation strategy, `issue_edges` normalization into the chain, backup/corruption story for `~/.shipcode/data`, transaction usage review (manual BEGIN/COMMIT with zero nesting today).
4. **04 — Pipeline reliability audit.** Retry/reconciliation semantics, checkpoint-resume correctness (`retry` command paths), fan-out failure modes and worktree cleanup on judge failure, concurrency-cap interaction (global × per-state × CPU throttle).
5. **05 — Release & distribution audit.** Code-signing plan (Apple Developer ID + notarization), real auto-update (electron-updater or equivalent), Windows target decision, version-bump automation (currently 3 package.jsons must agree manually).
6. **06 — Test strategy audit.** One coverage floor, promote web-smoke (and possibly a desktop smoke) to required checks, add cli/web/docs/git/ui to the vitest workspace or document why not, retire the Mac Studio manual E2E definitively.
7. **07 — Docs & DX audit.** CLI README command table, root README model references, `docs/` root cleanup, onboarding flow accuracy against `onboard.ts`.
