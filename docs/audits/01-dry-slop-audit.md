# DRY / Slop Audit — ShipCode Monorepo

**Date:** 2026-07-09

**Baseline:** `802cc8ce` (`v0.1.4` / `origin/master`)

**Scope:** `apps/{desktop,cli,web,docs}`, `packages/{agents,pipeline,git,db,shared,ui}`, `e2e`, `scripts`, and root/workflow configuration

**Constraint:** Evidence and refactor plan only. No production or test code was changed by this audit.

The audit combined exact-clone detection, production-mode dead-code analysis, symbol/reference searches, and independent reviews of the pipeline/data layer, renderer/UI, and tooling/tests. Exact clones were measured with jscpd in strict mode at a 10-line / 80-token threshold over `typescript,tsx,javascript` formats. The production command scanned `apps packages scripts` and ignored `*.test.*`, `*.spec.*`, test directories/helpers, generated files, build output, and coverage output. The inclusive command scanned `apps packages e2e scripts` and ignored only generated/build/coverage output. These are scoped JS/TS metrics, not whole-repository metrics: workflows, MDX, root configuration, and agent-source Markdown are outside them.

| Scan | Files | Lines | Exact clones | Duplicated lines | Density |
|---|---:|---:|---:|---:|---:|
| Production JS/TS (`apps packages scripts`) | 443 | 102,930 | 41 | 874 | 0.85% |
| Test/e2e-inclusive JS/TS (`apps packages e2e scripts`) | 839 | 238,800 | 521 | 11,475 | 4.81% |

`bun run deadcode` currently reports 32 unused-file candidates, 8 unused-dependency candidates, and 30 unused exports. Those are raw Knip results, not deletion instructions: most file/dependency hits are runtime entry points, generated content, build tooling, or test seams. Section 3 contains only candidates that survived reference inspection.

## 1. Executive summary

ShipCode does not have a broad copy-paste problem in production code. Its 0.85% exact-clone density is low for a monorepo of this size. The costly slop is semantic: the same business decision is encoded in several places, and the copies have already diverged.

The highest-priority findings are:

1. **The CLI starts an issue pipeline with a project ID where the pipeline requires a thread ID.** `startIssuePipeline` passes `ctx.project.id` into `startFromGitHubIssue(threadId, ...)` in [apps/cli/src/commands/issue-pipeline.ts](../../apps/cli/src/commands/issue-pipeline.ts). The pipeline immediately performs thread-keyed updates and run creation in [packages/pipeline/src/pipeline.ts](../../packages/pipeline/src/pipeline.ts). Desktop's scheduler correctly creates/reuses and links a thread before passing `thread.id` in [apps/desktop/src/main/pipeline-scheduler.ts](../../apps/desktop/src/main/pipeline-scheduler.ts). Existing CLI tests assert the wrong ID, so mocks currently preserve the defect.
2. **The CLI's `plan` and `review` commands do not implement their advertised stop points.** A1 currently makes fresh invocations exit with “thread not found” or read a stale/preexisting thread. Once that ID defect is fixed, both commands still call the unrestricted fire-and-forget starter and immediately read the database; they need an awaitable stop policy before they can truthfully promise “stops at approval” or “review only.”
3. **Provider eligibility has drifted into invalid UI states.** [`PHASE_DESCRIPTORS`](../../packages/shared/src/model-resolution.ts) is the canonical policy and limits Cursor to execute. Issue detail instead offers every executor provider for every phase in [issue-detail/helpers.ts](../../apps/desktop/src/renderer/components/issue-detail/helpers.ts), although [cursor-cli-provider.ts](../../packages/agents/src/providers/cursor-cli-provider.ts) rejects non-execute phases. Automation has the inverse error: its form omits registered Gemini/Cursor executors, while its DTO is over-broad `AgentType` and also admits non-executors `gh`/`shell`.
4. **The shipping retry can bypass thrown preflight-read errors.** [`startCommitAndPush`](../../packages/pipeline/src/pipeline/execution-shipping-phases.ts) wraps HEAD lookup, `git log`, branch lookup, and push in one `try`; its catch retries by resolving the branch and pushing regardless of which command threw. Predicate failures such as verified-SHA mismatch and “no commits ahead” return safely, but command exceptions can still fall through to a push attempt.
5. **Database schema authority is split.** V1–V63 migration order is hand-maintained in production and tests, and `schema.test.ts` already stops one registry at V62 and another at V53. Separately, `issue_edges` is created as a constructor side effect, while an unreferenced SQL file contains the same DDL. Database shape therefore depends on which query classes an entry point instantiates.
6. **The universal IPC boundary neither clamps renderer errors nor centralizes diagnostics.** [apps/desktop/src/main/ipc.ts](../../apps/desktop/src/main/ipc.ts) records the raw message and rethrows the original error. Roughly 15 handlers compensate with local clamping wrappers. Main synchronously appends every successful IPC call in all environments; development additionally emits a preload diagnostic for the same invocation.
7. **The largest exact production clone is still GitHub PR parsing.** `GhCli.getPullRequestFeedback` and `getPullRequestDetail` duplicate roughly 112 lines of check-rollup and unresolved-review-thread parsing in [packages/agents/src/github/gh-cli.ts](../../packages/agents/src/github/gh-cli.ts).

The safest high-ROI cleanup is the migration registry, dead export/file removal, SQLite timestamp constant adoption, scheduler helper deduplication, and pure GitHub parser extraction. The CLI lifecycle, shipping, provider policy, retry policy, IPC boundary, and git-default changes are semantic refactors and should land separately with behavior-first tests.

## 2. High-impact duplication clusters

### A. Issue-pipeline lifecycle and shipping

#### A1. CLI launch is an incomplete copy of desktop orchestration

- [`startIssuePipeline`](../../apps/cli/src/commands/issue-pipeline.ts) passes `ctx.project.id` as the first argument to `startFromGitHubIssue`.
- [`startFromGitHubIssue`](../../packages/pipeline/src/pipeline.ts) names that argument `threadId`, calls `threads.updateAutonomousFields(threadId, ...)`, creates a run from `threads.getById(threadId)`, and stores active context under that key.
- [`PipelineScheduler._launch`](../../apps/desktop/src/main/pipeline-scheduler.ts) performs the missing domain work: reusable-thread validation, thread create/update, issue linking, phase-model resolution, failure reset, plan supersession, and then `pipeline.startFromGitHubIssue(thread.id, ...)`.
- [apps/cli/src/commands/pipeline-commands.test.ts](../../apps/cli/src/commands/pipeline-commands.test.ts) and [run.test.ts](../../apps/cli/src/commands/run.test.ts) expect `"project-1"` in the thread-ID position, so the test double validates call shape rather than domain state.

**Refactor:** create an application-neutral issue-launch coordinator that owns thread creation/reuse, issue linkage, phase-model persistence, failure reset, plan supersession, and invocation of the pipeline. Desktop should retain label synchronization and renderer notifications around it; CLI should not duplicate those UI-specific side effects.

#### A2. CLI phase commands race asynchronous work

- [`planCommand`](../../apps/cli/src/commands/plan.ts) and [`reviewCommand`](../../apps/cli/src/commands/review.ts) await only startup, then immediately query plan/review rows.
- [`Pipeline.launch`](../../packages/pipeline/src/pipeline.ts) intentionally returns before provider work and subsequent phases finish.
- [apps/cli/src/program.ts](../../apps/cli/src/program.ts) promises `plan` stops at approval and `review` runs only through adversarial review, but neither passes a stop policy.

**Refactor:** add an awaitable phase-completion API plus an explicit stop policy (`approval` or `reviewed`). If those semantics are not worth supporting, delete the façade commands rather than retaining misleading aliases for `run`.

#### A3. Pipeline bootstrap is duplicated internally

- `startFromGitHubIssue` and `startFromQuickTask` repeat the start-option shape, base-branch/fork-point lookup, thread initialization, run creation, and a large `ensureContext` call in [pipeline.ts](../../packages/pipeline/src/pipeline.ts). jscpd reports a 59-line exact clone.
- `cancel` and `pause` repeat teardown but have intentionally different tails; only the common halt operation should move.
- `startFromQuickTask` and `startFromAutomation` synthesize nearly identical single-step plans with different complexity and rationale.
- Existing/fresh-context reasoning resolution repeats in [pipeline/context.ts](../../packages/pipeline/src/pipeline/context.ts); one branch resolves an already resolved “effective” value again.
- [`PipelineScheduler._resolvePhaseModels`](../../apps/desktop/src/main/pipeline-scheduler.ts) is a line-for-line copy of exported [`resolveIssuePhaseModels`](../../apps/desktop/src/main/ipc/helpers.ts).

**Refactor:** introduce `PipelineStartOptions`, `bootstrapPipelineRun`, `haltActivePipeline`, and a parameterized direct-execution-plan builder. Import `resolveIssuePhaseModels` in the scheduler. Keep GitHub, quick-task, and automation tails explicit.

#### A4. Push retry also catches preflight command errors

[`startCommitAndPush`](../../packages/pipeline/src/pipeline/execution-shipping-phases.ts) retries from a catch that covers command exceptions from:

- HEAD lookup;
- “commits ahead” `git log` inspection;
- current-branch resolution; and
- the push itself.

Verified-SHA mismatch and a successful empty log both return `failed` before the catch, and `resolveWorktreeDiffBase` contains its own fallback behavior. Only the final push exception should enter a push retry. Existing coverage in [packages/pipeline/src/pipeline.test.ts](../../packages/pipeline/src/pipeline.test.ts) tests “first push fails,” but not “HEAD/log/branch command throws and must perform zero pushes.”

**Refactor:** complete preflight outside the retry block; retry a small `pushCurrentBranch` operation only.

### B. Phase/provider policy and model presentation

[`PHASE_DESCRIPTORS`](../../packages/shared/src/model-resolution.ts) already encodes provider eligibility, settings keys, override keys, and phase status mapping. Copies bypass it:

- [`PHASE_PROVIDER_OPTIONS`](../../apps/desktop/src/renderer/components/issue-detail/helpers.ts) assigns all `PIPELINE_EXECUTOR_PROVIDERS` to plan, review, execute, and verify. [`PipelineTab`](../../apps/desktop/src/renderer/components/issue-detail/PipelineTab.tsx) therefore offers Cursor for unsupported read-only phases.
- [create-automation-modal.tsx](../../apps/desktop/src/renderer/features/automations/create-automation-modal.tsx) lists only Claude, Codex, and OpenRouter. [executor-model-options.ts](../../apps/desktop/src/renderer/features/automations/executor-model-options.ts) likewise ignores existing Gemini/Cursor catalogs. The persistence contract should narrow from `AgentType` (which also includes `gh`/`shell`) to the runnable `ExecutorModel` union.
- [`IssueDetail`](../../apps/desktop/src/renderer/components/IssueDetail.tsx) hand-builds effective providers, inherited selections, encoded values, and efforts across seven maps. Its unloaded-state fallbacks disagree both with adjacent maps and with [`DEFAULT_SETTINGS`](../../packages/shared/src/constants.ts), which defaults every pipeline phase to Codex.
- [`PipelineSettingsSection`](../../apps/desktop/src/renderer/components/settings-panel/PipelineSettingsSection.tsx) repeats the four descriptor rows and their key mappings.
- Documentation duplicates stale routing facts in two ways. [configuration.mdx](../../apps/docs/content/configuration.mdx) says missing labels fall back to Claude, while [model-router.ts](../../packages/agents/src/github/model-router.ts) and [openrouter.mdx](../../apps/docs/content/openrouter.mdx) say Codex. [index.mdx](../../apps/docs/content/index.mdx) and [pipeline/overview.mdx](../../apps/docs/content/pipeline/overview.mdx) agree with each other but duplicate the incorrect claim that Verify defaults to Claude during onboarding; onboarding writes only planner/reviewer, so the verifier remains the Codex `DEFAULT_SETTINGS` value.

**Refactor:** derive every provider option list and phase row from `PHASE_DESCRIPTORS`. Add a renderer-local pure `buildIssuePhasePresentation` for UI encoding/inheritance. Do not merge global, project, issue, and automation forms: their inheritance and persistence semantics differ.

### C. Database migration and schema authority

#### C1. Migration sequence exists in four forms and is already stale

- [packages/db/src/index.ts](../../packages/db/src/index.ts) imports and invokes V1–V63 manually.
- [packages/db/src/test-helpers.ts](../../packages/db/src/test-helpers.ts) repeats the full import and invocation sequence.
- [packages/db/src/schema.test.ts](../../packages/db/src/schema.test.ts) defines `migrations` only through V62.
- The same test's “newer schema skips every migration” list stops at V53.

**Refactor:** export canonical ordered `MIGRATIONS` and `runMigrations` from [schema.ts](../../packages/db/src/schema.ts). Keep named migration exports for version-pinned tests. Use registry slices for `migrateThrough` and skip tests so V64 cannot be omitted silently.

Historical migrations also repeat version-check/transaction/version-marker scaffolding. Add `runVersionedMigration` for future migrations; rewriting V2–V63 provides little immediate value and increases migration risk.

#### C2. `issue_edges` schema is constructor-coupled

- [`20260423_issue_edges.sql`](../../packages/db/src/migrations/20260423_issue_edges.sql) is not referenced by the migration runner.
- The same DDL is embedded as `ISSUE_EDGES_SCHEMA_SQL` in [queries/issue-edges.ts](../../packages/db/src/queries/issue-edges.ts).
- `IssueEdgeQueries` executes it in the constructor. Desktop happens to instantiate that query at startup in [apps/desktop/src/main/index.ts](../../apps/desktop/src/main/index.ts); CLI does not.

No numbered V1–V63 migration is orphaned, but this non-numbered SQL artifact is. More importantly, a database opened through different entry points can have a different schema.

**Refactor:** create V64 from the authoritative DDL, remove constructor-time DDL, then delete the orphan SQL artifact. Schema must exist after `getDatabase`, before any query object is constructed.

#### C3. Shared SQLite timestamp expression is bypassed

[`ISO_NOW_SQL`](../../packages/shared/src/sqlite-time.ts) exists for this exact purpose, but seven query files inline the same expression: `issue-chat-sessions.ts`, `issue-edges.ts`, `task-graphs.ts`, `feature-qa-results.ts`, `project-failures.ts`, `review-findings.ts`, and `pipeline-steps.ts`. Replace them mechanically. Preserve the modified `'-5 minutes'` expression in `github-issues.ts`.

### D. IPC error handling and diagnostics

- The wrapper in [apps/desktop/src/main/ipc.ts](../../apps/desktop/src/main/ipc.ts) logs the raw `error.message` to `events.log` and rethrows the original value.
- [`clampError`](../../packages/shared/src/errors.ts) is explicitly documented as the IPC-safe renderer boundary.
- Handler-local compensations include `throwClampedIpcError` plus roughly 15 `throw new Error(clampError(...))` sites across pipeline, project, GitHub, skills, and automation handlers.
- Some handlers bypass the logger with direct `console.error` / `console.info` calls.
- Main records each invocation through `logEvent('ipc:handle', ...)` in all environments. In development only, preload emits a second per-call `diagnostics:renderer-ipc` event. `logEvent` synchronously creates directories and appends to disk, including for successful calls.

**Refactor:** make the universal wrapper authoritative: capture/log the full error privately, persist only the clamped first line, and throw `new Error(clampError(error))`. Remove only local catches whose sole purpose is clamp/log; retain rollback, fallback, partial-success, and domain-translation catches. Keep aggregate timing, slow-call, and failure diagnostics; stop synchronously persisting every successful main-process call, and remove the development-only duplicate event if it adds no distinct signal.

### E. GitHub and agent-process clients

| Finding | Evidence | Narrow refactor |
|---|---|---|
| PR status/review parsing clone | `GhCli.getPullRequestFeedback` and `getPullRequestDetail` in [gh-cli.ts](../../packages/agents/src/github/gh-cli.ts), 112 duplicated lines | Pure `buildCheckSummaries` and `buildUnresolvedReviewComments`; keep distinct GraphQL queries/results |
| Projects v2 transport clone | [project-priority.ts](../../packages/agents/src/github/project-priority.ts) and [project-status.ts](../../packages/agents/src/github/project-status.ts) repeat response types, pagination, scope errors, and warnings | Shared ProjectV2 pagination/transport envelope; keep priority/status mapping separate |
| CLI onboarding bypasses canonical GitHub clients | [onboard.ts](../../apps/cli/src/commands/onboard.ts) raw-runs auth/repo/label commands; [`GhCli.ensureLabels`](../../packages/agents/src/github/gh-cli.ts) and [`checkGhAuth`](../../packages/agents/src/health-check.ts) already exist | Reuse canonical clients. The local label listing uses gh's default cap; the canonical client raises it to 200, reducing—not eliminating—truncation |
| PRD rewrite context copied | [register-github-handlers.ts](../../apps/desktop/src/main/ipc/register-github-handlers.ts) and [register-support-handlers.ts](../../apps/desktop/src/main/ipc/register-support-handlers.ts) repeat model selection, validation, skill read, and fallback prompt | `resolvePrdRewriteContext` helper |
| No-tools Claude wrapper copied | `runPrdCliWithStdin`, `runSkillCliWithStdin`, `runMemoryCliWithStdin`, and `runCliTriage` repeat environment filtering/spawn/timeout policy | `runNoToolsClaudeGeneration` with canonical env filtering and model-ID validation; keep caller-specific max turns/cwd |
| Prompt-in-argv compatibility fallback | Provider interfaces make `spawnWithStdin` optional and fall back through `materializeStdinArgsForLegacySpawn` even though concrete `ProcessManager` implements stdin spawning | Require `spawnWithStdin` and update fakes; prompt content must never enter argv |
| Process lifecycle scaffolding copied | `ProcessManager.spawn` / `spawnWithStdin` and the two stdin runners repeat prepare, settle, abort, and failed-spawn cleanup | Private prepare/cleanup helpers and one tested settle primitive; retain PTY vs child-process differences |

### F. Renderer queries, mutations, and reusable interaction patterns

1. **Settings/integration queries:** nine components independently define `settings:get` queries and five define integration queries. Add named `useAppSettings({enabled?})`, `useIntegrationStatus({enabled?})`, and `useTelemetryStatus` hooks. Do not create a generic `useIpcQuery`.
2. **Project relink:** [ProjectSidebar.tsx](../../apps/desktop/src/renderer/components/ProjectSidebar.tsx), [ProjectMissingView.tsx](../../apps/desktop/src/renderer/components/ProjectMissingView.tsx), and [ProjectSettingsModal.tsx](../../apps/desktop/src/renderer/components/ProjectSettingsModal.tsx) repeat directory selection, `project:relink-path`, invalidations, and GitHub refresh. Only the modal invalidates `['project-setup', projectId]`, so other entry points can retain setup data for the old path.
3. **Notifications:** [`useIpc`](../../apps/desktop/src/renderer/hooks/useIpc.ts), `ProjectSidebar`, and [InboxView.tsx](../../apps/desktop/src/renderer/components/InboxView.tsx) all subscribe to notification events. Fire can trigger three invalidations; dismiss updates Zustand centrally but relies on component listeners to reconcile React Query.
4. **Resize lifecycle:** `ProjectSidebar` and [`useResizableDetailSidebar`](../../apps/desktop/src/renderer/components/issue-detail/useResizableDetailSidebar.ts) repeat mouse listeners, body classes, repeat-mousedown cleanup, mouseup cleanup, and unmount cleanup. The same leak fix and parallel tests were recently needed in both.
5. **Update status:** [UpdateBanner.tsx](../../apps/desktop/src/renderer/components/UpdateBanner.tsx) and [AboutSettingsSection.tsx](../../apps/desktop/src/renderer/components/settings-panel/AboutSettingsSection.tsx) duplicate the query and IPC subscription exactly.
6. **Confirmations:** reuse/rename the existing specialized `ThreadPanelArchiveDialog` for the duplicate archive interaction in `IssueDetailDialogs`. A generic flag-heavy `ConfirmDialog` is not justified after that; board review and close-issue dialogs have materially different bodies and action semantics.
7. **Integration picker UI:** terminal/project opener sections in `IntegrationsSettingsSection` are near-identical and justify one local `AppPickerSection`. Keep the local `StatusPill`: it has 12 consumers and usefully centralizes four integration-health tones. Replacing it with Badge would be a separate visual-system migration, not DRY cleanup.
8. **Presentation:** `ProjectInsights` and `ActivityHeatmap` reimplement shared `formatCost`; `CostsTab` and `RunsTab` bypass `formatTokenCount`, producing `1500k` where other views show `1.5M`.

### G. Contract/type drift

| Contract | Divergence | Refactor |
|---|---|---|
| `AgentConversationRecord` | DB type in [agent-conversations.ts](../../packages/db/src/queries/agent-conversations.ts) includes `runId`; shared type in [verification.ts](../../packages/shared/src/types/verification.ts) omits it. IPC promises the shared type while returning raw DB records | One canonical DTO, or explicit IPC mapping if `runId` must remain private |
| Issue-chat provider/session/start results | Repeated in main session code, `IssueChatTab`, and inline [ipc-channels.ts](../../packages/shared/src/ipc-channels.ts) contracts | Named shared IPC DTOs |
| `ActivePipelineSummary` | Pipeline runtime summary and enriched dashboard/UI summary share a name but intentionally differ | Rename runtime one to `ActivePipelineRuntimeSummary`; do not merge shapes |
| Phase vocabularies | `PromptPhase`, `ProviderPhase`, `PipelinePromptPhase`, and a feature-QA inline union repeat the same literals; prompt-scope/policy interfaces also mirror each other | One shared phase vocabulary and one policy contract |
| Query capabilities | Pipeline hand-copies subsets of DB query classes and weakens at least one return type to `unknown` | `Pick<...>` contracts or explicit narrow adapters |
| Automation executor | Form options omit registered Gemini/Cursor, while persisted `AgentType` also permits non-executors `gh`/`shell` | Narrow to `ExecutorModel` and derive options from the execute descriptor |
| Project opener targets | Target union, DB validator, health labels, main order/names, IssuesPanel metadata, and integrations metadata are six sources of truth with differing order | Shared target metadata; retain platform bundle identifiers in agents |
| `PrdMetadata` | IPC contract and two handler annotations repeat the same inline shape | Named shared metadata type |

### H. Test and tooling slop

- Adding test and e2e sources raises scoped clone density from 0.85% to 4.81%. Desktop tests contain at least 13 local `makeProject`, 11 `makeIssue`, and 8 `makeThread` builders. Add desktop-local builders with explicit scenario overrides; do not create a cross-workspace mega-fixture.
- [check-app-coverage.mjs](../../e2e/scripts/check-app-coverage.mjs), [check-page-coverage.mjs](../../e2e/scripts/check-page-coverage.mjs), [check-flow-coverage.mjs](../../e2e/scripts/check-flow-coverage.mjs), and [check-behavior-coverage.mjs](../../e2e/scripts/check-behavior-coverage.mjs) repeat the same manifest/gate/artifact algorithm.
- More importantly, behavior/flow gates count `covered: true` plus “assigned spec file exists”; they do not prove the manifest ID maps to a test. All 79 behavior rows claim coverage even though none of their IDs occurs in the assigned spec source; only 4 of 11 flow IDs occur. IDs need typed test annotations or title binding before the percentage is meaningful.
- `selectSeedProject` and renderer invocation helpers are duplicated across e2e specs despite an existing Harness. Add `Harness.invoke<T>` and domain flow helpers.
- [vitest.workspace.ts](../../vitest.workspace.ts) lists only shared, agents, DB, pipeline, and desktop. Root Vitest can silently omit CLI/docs/web/git/ui. Complete it or delete it and enforce package-scoped commands.
- [scripts/verify-affected-workspaces.ts](../../scripts/verify-affected-workspaces.ts) reimplements dependency selection less completely than Turbo: it selects directly changed workspaces, can omit dependents, and skips root changes. Decide whether its local fast path is intentionally different; otherwise delete it for Turbo `--affected`.
- `build:skills` generates `defaults.generated.ts`, but CI has no regenerate-and-diff guard. [dev-loop.generated.ts](../../packages/agents/src/bundled-repo-skills/dev-loop.generated.ts) is live and its header pins upstream commit `93b5ca4`, but the repository has no local generator or machine-verified regeneration guard.

## 3. Dead / obsolete code candidates

### Safe mechanical candidates

| Candidate | Evidence | Action |
|---|---|---|
| [`packages/agents/src/memory-loader.ts`](../../packages/agents/src/memory-loader.ts) | No production caller; only barrel-exported and self-tested. `loadRepoContext` in `context-loader.ts` subsumes its behavior and adds structured classification | Delete file, test, and export |
| [`packages/agents/src/context-generator.ts`](../../packages/agents/src/context-generator.ts) | Compatibility façade over memory-generator; production handlers use memory APIs directly; compatibility tests only verify delegation | Move unique assertions, then delete façade/tests/exports |
| [`packages/ui/src/LoadingButtonContent.tsx`](../../packages/ui/src/LoadingButtonContent.tsx) | Zero production consumers; desktop uses the equivalent `@shipshitdev/ui/common` component | Delete file and barrel export |
| `statusDotColorClass` / `dragOverlayBorderClass` in [kanban utils](../../packages/ui/src/kanban-board/utils.ts) | Zero production callers; the latter always returns an empty string | Delete functions and surgical test assertions |
| [`scripts/check-native-elements.sh`](../../scripts/check-native-elements.sh) | Zero references, points at a nonexistent `apps/web/src` tree, and overlaps with the staged-file [`lint-no-raw-html.sh`](../../scripts/lint-no-raw-html.sh) while applying a different `packages/ui` scope | Delete the unwired stale script; document the staged hook as the intended policy |
| [`apps/docs/content/desktop/mission-control.mdx`](../../apps/docs/content/desktop/mission-control.mdx) | Hidden legacy-name redirect; repo policy explicitly rejects compatibility routes for the green app | Delete the page and its old-name e2e manifest/spec entries |
| Root `coverage:legacy` script | No workflow or script reference; superseded by current sharded coverage | Delete package-script entry |
| `recordBreadcrumb` in [desktop telemetry](../../apps/desktop/src/main/telemetry.ts) | No production caller; pipeline failures use the thread-local breadcrumb trail | Delete, then remove any controller path made dead |
| Dead pipeline types | `ThreadStatus`, duplicate/narrow `ProviderPhaseHints`, and `ListedPipelinePhase` in [pipeline/shared.ts](../../packages/pipeline/src/pipeline/shared.ts) have no consumer | Delete |
| Redundant exports | `DEFAULT_FAN_OUT_WORKER_COUNT` is same-file-only; `cleanTerminalText` and several query/helper types are internal-only | Remove `export` rather than deleting live internals |
| Back-compat aliases | `ContextFileInfo`, `ContextGeneratorCli`, `SHIPCODE_STATUS_LABELS`, and unused `hasObsoleteContextDirectory` surface | Delete after replacing remaining type-only references |

The unreferenced `20260423_issue_edges.sql` is runtime-safe to delete now, but sequencing it after V64 preserves a readable DDL source during the migration refactor. Deleting it alone would not fix constructor-coupled schema creation.

### Decision-required candidates

| Candidate | Why it is not a mechanical delete |
|---|---|
| [`scripts/verify-affected-workspaces.ts`](../../scripts/verify-affected-workspaces.ts) | Live root script with weaker semantics than Turbo. Delete if no intentional local-only contract exists; otherwise fix and document it |
| [`vitest.workspace.ts`](../../vitest.workspace.ts) | Live but incomplete. Choose “complete workspace authority” or “package-scoped only”; leaving silent partial coverage is the bad state |
| [`docs/coverage-leftovers.md`](../coverage-leftovers.md) | Stale snapshot; its only live repository reference is the repo-map audit, not a workflow or script. Choose refresh-and-own or delete both the snapshot and reference |

### Knip false positives to retain

Do not remove `@anthropic-ai/sandbox-runtime` (runtime `require.resolve` and packaging), e2e checker scripts (wired to `e2e:ci`), MDX `useMDXComponents` (framework entry point), provider/test internals marked for test seams, `yaml` in CLI bundling, e2e workspace dependencies required through Turbo, or generated skill bundles that are imported by the seeder. The right fix for generated bundles is reproducibility, not deletion.

## 4. Inconsistent local patterns

| Concept | Current implementations | Divergence / decision |
|---|---|---|
| CLI data directory | [context.ts](../../apps/cli/src/context.ts) uses `os.homedir()`; `guard.ts`, `status.ts`, and `onboard.ts` use `process.env.HOME ?? ''` | Absent/empty `HOME` can make the latter path cwd-relative or runtime-dependent. One `resolveCliDataDir` should require a non-empty home and fall back to `os.userInfo().homedir` |
| Default branch | [GitService](../../packages/git/src/git-service.ts): symbolic → main → master → current; [WorktreeManager](../../packages/git/src/worktree.ts): symbolic → current → main → master; pipeline falls back directly to `main` | Choose and table-test one order. Pipeline should consume the git package instead of direct synchronous shell-outs |
| Retry decision | Main `getRetryAction`, renderer `resolveIssueRetryPresentation`, and CLI checkpoint switch | Renderer adds a `/no code changes/i` replan guard; CLI lacks model re-resolution, resume context, and cross-thread plan borrowing. One pure decision contract, then product-test parity |
| Error handling | Universal raw IPC rethrow, handler-local clamping, direct console logging | Central boundary must own renderer safety; retain domain recovery locally |
| OpenRouter auth types | Shared string `OpenRouterAuthStatus` and agents discriminated result with the same name | Rename agents result to `OpenRouterAuthCheckResult`. Production call sites omit `pinnedModel`, so their health/onboarding bridges cannot receive `model_deprecated`; retain the tested optional API result unless the API itself is deleted, and remove only unreachable caller conditionals |
| Pipeline events | CLI switch has no turn-event cases; desktop forwards generic events but has no structured-log or renderer consumer for them | Decide whether turn events are intentionally internal/noisy. Delete variants/emissions or add explicit consumers, then add exhaustive guards; do not merge emitters |
| Relative time | Shared past-only formatter, automation bidirectional formatter, Titlebar “checked at” formatter | Unify only through explicit options and preserve fixtures. Keep intentionally coarse staleness formatting separate |
| Truncation | `clampError`, `truncateCompact`, provider normalizers, CLI logs, telemetry | One primitive with explicit “maximum total length” semantics. Current telemetry/normalizer helpers can exceed their stated limits after appending ellipses |
| Cost/token rendering | Shared formatters plus local copies/bypasses | Use shared numeric formatting; keep context-specific zero labels as wrappers |
| HTTP timeouts | Update service manual controller, chat notifications and health checks use `AbortSignal.timeout`, OpenRouter has retries/combined signals | Share timeout/outer-signal plumbing for simple fetches. Keep OpenRouter retry/SSE behavior and localhost readiness polling separate |
| Phase/type vocabularies | Four phase unions plus mirrored runtime schemas/interfaces | Consolidate compile-time vocabulary; infer from schemas or add equality assertions before changing optional/default semantics |
| SQLite “now” | Shared constant plus seven hardcoded exact literals | Mechanical constant substitution |
| Docs routing defaults | Configuration's missing-label fallback conflicts with code/OpenRouter docs; the duplicated landing/pipeline phase tables share the same stale verifier-onboarding claim | Correct both facts in one canonical explanatory page; other pages link or summarize |

### Patterns that should remain local

- Keep OpenRouter's typed retry/backoff/SSE client separate from generic fetch timeout plumbing.
- Keep desktop and CLI event emitters separate; their side effects are different.
- Keep global/project/issue/automation model forms separate; share descriptors and pure mapping only.
- Do not merge all kanban cards/list rows into one flag-heavy component. Share status tone and header chrome, not divergent action surfaces.
- Do not replace named React Query hooks with a generic IPC-query framework.
- Keep the integration `StatusPill` local unless a visual-system migration is separately scoped; it is a used, cohesive abstraction.
- Do not matrix-generalize CI jobs whose stable names are required branch checks.
- Do not rewrite 62 historical migrations merely to apply a new harness.
- No production `any`, abandoned numbered migration, commented-out-code block, or TODO/FIXME cluster was found. The model catalog is already centralized, and there is no app-owned auth-guard layer worth abstracting.

## 5. Recommended shared modules / components

Only abstractions below remove an observed synchronization burden or a demonstrated defect.

| Proposed owner | API / component | Consumers and boundary |
|---|---|---|
| `packages/pipeline` | `IssuePipelineLaunchCoordinator` | Shared thread/run/plan/domain preparation for desktop scheduler and CLI; desktop wraps UI/cache/label side effects |
| `packages/pipeline` | Awaitable phase completion + explicit stop policy | CLI `plan` / `review` and future scripted callers |
| `packages/pipeline` | `PipelineStartOptions`, `bootstrapPipelineRun`, `haltActivePipeline`, direct-plan builder | Internal start/cancel/pause entry points only |
| `packages/db` | `MIGRATIONS`, `runMigrations`, future-only `runVersionedMigration` | Production bootstrap, test DB, version-pinned migration tests |
| `packages/shared` | Existing `PHASE_DESCRIPTORS` as sole provider-policy source | Global, project, issue, and automation selectors; renderer-local presentation mapper |
| `packages/git` | Canonical `resolveDefaultBranch` / current-branch / status / diff primitives | `GitService`, `WorktreeManager`, pipeline shipping |
| `apps/cli` | `resolveCliDataDir` | Context, onboarding guard, status, onboarding |
| `packages/agents/github` | `buildCheckSummaries`, `buildUnresolvedReviewComments`, ProjectV2 pagination | PR detail/feedback and priority/status fetchers |
| `packages/agents` | `runNoToolsClaudeGeneration` plus canonical text-generation env policy | PRD, skill, memory, and issue-triage generation |
| `apps/desktop/main` | Universal IPC error/diagnostic boundary | All IPC handlers; local catches retain only recovery/translation |
| `apps/desktop/renderer` | `useAppSettings`, `useIntegrationStatus`, `useTelemetryStatus`, `useUpdateStatus` | Named cache/event contracts; retain per-call `enabled` guards |
| `apps/desktop/renderer` | `selectAndRelinkProject` + `invalidateRelinkedProject` | Sidebar, missing-project view, project settings |
| `apps/desktop/renderer` | Notification event reconciler in `useIpc` | Sole event-to-Zustand/React Query synchronization point |
| `apps/desktop/renderer` | `useHorizontalResize({initial,min,max,direction})` | Project and issue sidebars; shared lifecycle, consumer-specific starting widths and bounds |
| `packages/shared` | Canonical retry decision and named IPC DTOs | Main, renderer, CLI; mapping/presentation stays local |
| `packages/shared` | Small `truncate`, configurable relative-time formatter, existing cost/token formatters | Presentation only; do not turn `errors.ts` into a general utility dump |
| `packages/ui` / renderer-local | Status tone tables, column header shell, specialized archive dialog reuse, local `AppPickerSection` | Repeated UI with matching behavior; no universal confirm/card abstraction |
| `e2e` / desktop test support | Coverage-gate library, typed coverage IDs, `Harness.invoke<T>`, flow helpers, desktop record builders | Remove test clone volume and make claimed coverage traceable |

### Delete instead of generalize

Delete `memory-loader`, the context-generator compatibility façade, local `LoadingButtonContent`, dead kanban helpers, the legacy mission-control route, the obsolete raw-HTML script, and dead exports/types. None has enough distinct consumers to justify another abstraction layer.

## 6. Refactor roadmap ordered by ROI

Semantic and mechanical work should not be mixed in the same PR. That keeps review intent clear and allows mechanical cleanups to land without masking behavior changes.

| Order | Work package | Lane | ROI rationale |
|---:|---|---|---|
| R1 | Correct CLI issue launch through a shared coordinator | Risky semantic | Current ID contract is wrong and tests preserve it; highest correctness impact |
| R2 | Add awaitable stop semantics for CLI `plan` / `review`, or delete commands | Risky semantic | Prevents the post-R1 read race and unrestricted continuation |
| R3 | Restrict push retry to the push operation | Risky semantic | Prevents preflight command exceptions from entering a push retry |
| R4 | Derive all provider selectors from `PHASE_DESCRIPTORS`; gate IssueDetail while loading; align docs | Risky semantic | Removes an impossible Cursor configuration and invalid/missing automation providers |
| R5a | Add canonical `MIGRATIONS` registry and repair V63 test coverage | Safe mechanical | Small diff eliminates recurring schema/test drift |
| R5b | Add V64 for `issue_edges`, remove constructor DDL/orphan SQL | Semantic schema | Makes database shape entry-point-independent |
| R6 | Centralize IPC clamping/logging and reduce per-call/development-duplicate diagnostics | Risky semantic | Renderer safety, prompt/stderr containment, and startup/runtime I/O |
| R7 | Canonicalize CLI data dir and git/default-branch primitives; move pipeline off direct shell-outs incrementally | Risky semantic | Prevents split DBs and branch-policy disagreement |
| R8a | Extract pure PR/ProjectV2 parsers and reuse `GhCli` in onboarding | Mechanical then semantic-lite | Removes largest exact clone and raises label listing from gh's default cap to 200 |
| R8b | Consolidate no-tools generation/process settle helpers; require stdin spawning | Semantic-lite | Enforces prompt transport and one timeout/abort policy |
| R9 | Deduplicate pipeline bootstrap/reasoning/teardown and scheduler model resolver | Mechanical plus isolated semantic tests | Shrinks a high-churn composition root after correctness fixes |
| R10 | Centralize renderer queries, relink invalidations, notifications, update status, and resize lifecycle | Semantic-lite | Removes repeated cache/event contracts that have already diverged |
| R11 | Canonicalize DTOs, phase vocabulary, opener metadata, SQLite time, and formatting | Mechanical in small PRs | Reduces type lies and low-grade presentation drift |
| R12 | Make e2e coverage traceable, extract test gates/flows/builders, decide Vitest/Turbo authority, add generation drift checks | Tooling semantic | Converts self-attested gates into evidence and attacks the 4.81% test/e2e-inclusive scoped clone density |
| R13 | Delete verified dead files/exports/scripts and refresh stale audit docs | Safe mechanical | Low-risk maintenance reduction after dependent migrations/types land |

The fastest parallel mechanical lane is R5a, the pure half of R8a, scheduler resolver reuse from R9, `ISO_NOW_SQL` adoption, dead export removal, and specialized archive-dialog reuse. R1–R4 should remain independently reviewable correctness PRs.

## 7. Risk level and required test coverage

| Refactor | Risk | Required coverage before merge |
|---|---|---|
| R1 — issue-launch coordinator | **High** | In-memory DB with real query objects and mocked provider; assert thread create/reuse/linkage, thread IDs on run/plan writes, phase-model persistence, reset/supersession, and desktop/CLI parity. Replace call-shape tests that expect a project ID |
| R2 — await/stop policy | **High** | Deferred-provider tests proving commands wait for the requested terminal point, emit output only afterward, never enter execute, and handle clarification/failure/cancellation |
| R3 — push-only retry | **High** | Table tests separating safe predicate failures from command exceptions: verified-SHA mismatch and no commits ahead return failed; HEAD, `git log`, and branch lookup exceptions cause zero pushes; push failure alone retries exactly once |
| R4 — provider policy/presentation | **High** | Cursor absent for plan/review/verify and present for execute; Gemini/Cursor available for automation; `gh`/`shell` rejected by the executor DTO/schema; all global/project/issue rows match descriptors; controls remain disabled/non-persisting while settings or project data load; focused docs-routing/default assertions and static export |
| R5a — migration registry | **Low** | Registry ends at V63, has no duplicate/missing versions, production and `createTestDb` use it, skip/newer and version-pinned tests iterate the registry |
| R5b — V64 `issue_edges` | **Medium** | Fresh DB and V63→V64 upgrade; table/index/constraint checks before constructing `IssueEdgeQueries`; issue graph CRUD/body-sync tests; idempotent reopen |
| R6 — IPC boundary | **Medium** | Long multiline Error, string throw, non-Error throw, full private logging, clamped event/renderer message, rollback catches preserved, environment-specific diagnostic counts, slow/error metrics retained |
| R7 — CLI data/git policy | **High** | Absent and empty `HOME` with a valid `os.userInfo` fallback; one DB path across all CLI commands; temporary repos covering symbolic origin HEAD, main-only, master-only, current-only, and detached state; shipping/worktree consumers use same result |
| R8a — GitHub parsers/onboarding | **Medium** | CheckRun and StatusContext variants, unresolved/resolved review threads, ProjectV2 pagination, missing scopes, 31–200 labels, explicit behavior above 200, already-exists race, auth/repo failures |
| R8b — process/stdin helpers | **Medium** | Invalid model IDs, sensitive env filtering, timeout, pool exhaustion, pre-aborted and mid-flight abort, stderr clamping, spawn failure cleanup, and an invariant that prompt text never appears in argv |
| R9 — pipeline internals | **Medium** | Contract tests for GitHub/quick/automation start paths, cancel vs pause tail asymmetry, existing/fresh context reasoning across provider/model/global/phase overrides, direct-plan complexity fields |
| R10 — renderer cache/event hooks | **Medium** | Hook tests for `enabled` transitions/cache sharing; all relink entry points invalidate identical keys including `project-setup`; notification fire/dismiss update Zustand and query cache once; resize bounds/direction/repeated-mousedown/unmount |
| R11 — DTOs/formatting | **Low–Medium** | IPC handler/renderer contract test for `runId` policy; compile-time schema/type equality; opener target inventory test; formatter cases for zero, 999, 1k, 1M, past/future boundaries, and maximum total truncation length |
| R12 — test/tool authority | **Medium** | Coverage manifest IDs bound to test annotations/titles; intentionally broken binding fails the gate; before/after gate artifact parity; Turbo affected fixtures for dependent/root changes; generation produces a byte-clean tree |
| R13 — dead cleanup | **Low** | Final reference search and production Knip delta; package-scoped type/lint checks for touched packages; focused tests migrated before deleting compatibility modules |

For semantic work, use focused local tests while iterating and let normal PR CI run workspace-wide type, lint, build, and test gates. Success is not a lower clone percentage by itself: it is one authoritative decision per domain, explicit behavior at boundaries, and tests that fail when two entry points drift.
