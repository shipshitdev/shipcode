# DRY / Slop Audit — ShipCode Monorepo

**Date:** 2026-07-02
**Scope:** `apps/{desktop,cli,web,docs}`, `packages/{agents,pipeline,git,db,shared,ui}`, `e2e/`, `scripts/` — ~240k lines of TypeScript (110k in `apps/desktop`).
**Method:** Machine evidence first (knip dead-code scan, jscpd exact-clone detection: 81 exact clones / 1,453 duplicated lines / 1.29%), then 12 domain auditors fanned out in parallel, then **one adversarial verifier per finding** instructed to refute it by re-reading the cited code. Only findings that survived verification (or were corrected by it) appear below. 7 findings were refuted and are documented in §8 so they don't get "re-discovered" later. Every claim below was checked against the actual files, not just tool output.

---

## 1. Executive summary

The codebase is in **better shape than the average repo this size** — exact-clone density is 1.29%, git invocation is fully centralized in `packages/git`, the model catalog is a genuine single source of truth in `packages/shared/src/model-catalog.ts`, and knip's scariest output (391 "unused files") is almost entirely config-loading noise. The slop is concentrated, not smeared: five hotspots account for most of the real risk.

**The five findings that matter most:**

1. **The DB migration order is hand-duplicated in 3–4 places with zero enforcement** ([packages/db/src/index.ts:24-215](../../packages/db/src/index.ts), [test-helpers.ts:2-134](../../packages/db/src/test-helpers.ts), plus a third incomplete copy in `schema.test.ts` that stops at V62). Adding migration 64 requires editing multiple lists in lockstep; a miss means tests silently run against a different schema than production. Cheapest highest-value fix in the repo (§2, Cluster E).
2. **The single largest exact clone in the repo (~112 lines) sits inside [gh-cli.ts](../../packages/agents/src/github/gh-cli.ts):** `getPullRequestFeedback` (943-1158) and `getPullRequestDetail` (1160-1381) duplicate the GraphQL check-rollup/review-thread fragments *and* the parsing loops byte-for-byte. A bugfix applied to one path and not the other is the most probable regression source found in this audit (§2, Cluster C).
3. **A real user-facing bug from type duplication:** `OpenRouterAuthStatus` is declared twice with incompatible shapes ([packages/shared/src/types/health.ts:119](../../packages/shared/src/types/health.ts) string union vs [packages/agents/src/health-check.ts:686-692](../../packages/agents/src/health-check.ts) discriminated union). The hand-written bridge at health-check.ts:866 collapses `model_deprecated` into `'unreachable'`, so users with a deprecated OpenRouter model are told to debug their network/API key instead of picking a new model (§4.1).
4. **Both pipeline event emitters silently drop events today:** the `PipelineEvent` switch is hand-duplicated in [cli-emitter.ts:21-87](../../apps/cli/src/adapters/cli-emitter.ts) and [pipeline-bridge.ts:207-265](../../apps/desktop/src/main/pipeline-bridge.ts) with no exhaustiveness guard — and verification found `pipeline:turn-started` / `pipeline:turn-completed` are **already unhandled in both** (§4.2).
5. **`pipeline.ts` entry points duplicate ~150 lines of bootstrap** (`startFromGitHubIssue` vs `startFromQuickTask`: identical 14-field options type ×4 declaration sites, byte-identical git-resolution and `ensureContext` blocks), and desktop's `pipeline-scheduler.ts` carries a line-for-line private copy of `resolveIssuePhaseModels` that already exists as an export in `ipc/helpers.ts` (§2, Clusters A & B).

**Also notable:** the CLI (`shipcode retry`, issue routing) is not a copy of desktop logic but a *weaker reimplementation* — retries from the CLI skip model re-resolution, resume-context, and cross-thread plan borrowing that desktop performs. That's a product-consistency gap, not textbook duplication (§4.3).

**What was checked and found clean:** git shell-out centralization, model-catalog delegation, `packages/git` module boundaries, `packages/ui` thin re-export wrappers, desktop date formatters (three genuinely distinct formatters, not clones), env-var access (verifier refuted the "scattered config" claim), e2e workspace deps (needed by turbo's `^build` graph), and the `yaml` dep in apps/cli (needed at runtime by the tsup bundling setup). Details in §8.

---

## 2. High-impact duplication clusters

Grouped by domain impact. Effort: S < 1h, M ≈ half day, L = multi-day. All line numbers verified against current `master` (worktree `claude/nice-bardeen-4017cf`).

### Cluster A — Pipeline entry-point bootstrap (`packages/pipeline/src/pipeline.ts`)

The god-file (684 lines) holds three start functions and two teardown functions with heavy internal duplication, while phase logic already lives cleanly in `pipeline/*.ts` submodules.

| # | Finding | Evidence | Fix |
|---|---------|----------|-----|
| A1 | `startFromGitHubIssue` (205-354) / `startFromQuickTask` (356-515) duplicate ~150 lines | Byte-identical (diff-verified, zero delta): the 14-field `options` param type (declared **4×** — twice in pipeline.ts:210-225/361-376, twice in [types.ts:575-623](../../packages/pipeline/src/types.ts)); the `execFileSync symbolic-ref` + `rev-parse` git-resolution block (230-253 vs 381-404); `updateAutonomousFields`+`clearClarification`; the ~30-field `ensureContext(...)` call (only 2 of ~34 lines differ). Real divergence: only `startFromGitHubIssue` has the cachedIssue-based `requireApproval` branch. | Extract shared `PipelineStartOptions` type in types.ts + private `bootstrapPipelineRun(threadId, projectPath, options)` helper. **Do not merge the tails** — plan-generation vs synthesized-plan dispatch is real business logic. Effort M, mechanical. |
| A2 | `cancel()` (588-612) / `pause()` (614-637) duplicate teardown verbatim | Identical 5-statement block: `cancelled=true`, clear `retryTimer`, `abort.abort()` try/catch, `processManager.kill`, `runtimeQaCleanup()`. **Caution from verification:** the tails are intentionally asymmetric — `emitPhase('paused')` already finishes the run record via `mapPhaseToRunStatus`, while `emitPhase('idle')` does not, which is why only `cancel()` calls `finishCurrentRun` explicitly. No test asserts this. | Extract `haltActivePipeline(threadId)` for the shared 5 steps only. Document the tail asymmetry in the PR; do **not** symmetrize (would double-finish or under-finish the run record). Effort S, mechanical. |
| A3 | `ensureContext`'s `phaseReasoningEfforts` computation duplicated between branches, with a hidden invariant | [context.ts](../../packages/pipeline/src/pipeline/context.ts) 270-296 vs 375-401 byte-identical; worse, the existing-context branch (297-316) **re-invokes** `resolveProviderReasoningEffort` on its own `.effective` output while the new-context branch just aliases. Only correct today because the function happens to be idempotent — unstated invariant. | Extract `resolvePhaseReasoningEfforts(...)`, alias the legacy scalars in both branches, drop the redundant second resolve. Semantic — needs a reviewer who knows `resolveProviderReasoningEffort`'s contract. Add an equality assertion test first. Effort M. |
| A4 | `startFromQuickTask` (485-508) / `startFromAutomation` (554-575) both hand-synthesize a single-step `ShipCodePlan` | Same shape, `nanoid()` id, single-element `steps`. Intentional divergence: quick-task = `'low'` complexity, automation = `'medium'` (the finder had this backwards; verifier corrected it). `objective`/`acceptanceCriteria`/`rationale` also differ per site. | Extract `synthesizeDirectExecutionPlan({threadId, objective, prompt, rationale, acceptanceCriteria, estimatedComplexity})` — all divergent fields as params, not hardcoded. Effort S, mechanical. |

Once A1/A2/A4 land, consider moving the helpers into `pipeline/entry-points.ts` for layout consistency — but note `cancel`/`pause`/`dispatch` need direct `activePipelines` Map access that no other submodule has, so pipeline.ts remains the legitimate composition root. Not a standalone work item.

### Cluster B — Launch orchestration: desktop main ↔ scheduler ↔ CLI

| # | Finding | Evidence | Fix |
|---|---------|----------|-----|
| B1 | [pipeline-scheduler.ts:348-387](../../apps/desktop/src/main/pipeline-scheduler.ts) `_resolvePhaseModels` is a line-for-line copy of the exported `resolveIssuePhaseModels` in [ipc/helpers.ts:87-126](../../apps/desktop/src/main/ipc/helpers.ts) | Diff-verified identical (same 12-key object, same resolver calls). Scheduler already imports three other helpers from `'./ipc/helpers'` but not this one; `register-pipeline-handlers.ts` imports and uses the real export (line 23 import, line 745 call). Verifier confirmed the types are drop-in compatible. | Delete the private copy, import the export. Then extract the shared `_launch`/`_launchQuickTask` orchestration (resolve → assert → persist → reset → supersede → identical catch-block transition-to-failed, diff-verified byte-identical at 451-459 vs 518-526). Effort M, semantic (parameterization design). |
| B2 | `RetryAction` / `IssueRetryAction`: same 5-value union + near-identical decision logic duplicated across main and renderer | [retry-phase.ts:3](../../apps/desktop/src/main/ipc/retry-phase.ts) vs [issue-detail/helpers.ts:263](../../apps/desktop/src/renderer/components/issue-detail/helpers.ts) — same 5 literals, different order, no shared import. Both walk the identical `structuredPlan → worktreePath → verification.result` branches; renderer adds one extra `/no code changes/i` guard on `thread.lastError`. UI can show "Resume execution" while main actually resumes review. | Move the union + `getRetryAction`'s pure decision function to `packages/shared` (it only takes `Thread`/`PlanRecord`/`VerificationRecord`, all already shared types). Renderer keeps only label/summary formatting. Resolve the `lastError`-regex divergence deliberately. Effort S, semantic. |
| B3 | CLI `retry` is a weaker reimplementation of desktop's `retryPipelineThread` | [apps/cli/src/commands/retry.ts](../../apps/cli/src/commands/retry.ts) (79 lines): bare switch on `checkpoint.phase`. Desktop ([register-pipeline-handlers.ts:720-871](../../apps/desktop/src/main/ipc/register-pipeline-handlers.ts)): re-resolves phase models, smart `getRetryAction`, `buildExecutionResumeContext`, cross-thread plan borrowing via `plans.getLatestStructuredForIssue`. None exist in the CLI (grep-verified zero hits). | Behavior gap, not dead code. `getRetryAction` is already pure — move as-is (see B2). `resolveIssuePhaseModels` wraps already-shared `resolveExecutorModelForIssue` — move to shared. `buildExecutionResumeContext` is the only piece needing real extraction work. Effort M, semantic, **needs product sign-off** that CLI retry should reach parity. |
| B4 | CLI issue routing picks models from GitHub labels only; desktop resolves per-phase from settings/project/issue cascade | [issue-pipeline.ts:19-26](../../apps/cli/src/commands/issue-pipeline.ts) `routeFromLabels` + `'codex'` fallback vs desktop's `resolveIssuePhaseModels`. Same issue started from CLI vs desktop can select different models. | Product decision: (a) wire CLI into `resolveIssuePhaseModels` (CLI already has `ctx.project`), or (b) document label-only routing as intended. Effort M if (a). |

### Cluster C — GitHub API layer (`packages/agents/src/github/`)

| # | Finding | Evidence | Fix |
|---|---------|----------|-----|
| C1 | **Largest clone in the repo:** `getPullRequestFeedback` (943-1158) / `getPullRequestDetail` (1160-1381) in [gh-cli.ts](../../packages/agents/src/github/gh-cli.ts) | GraphQL fragments for `statusCheckRollup`/`contexts` (CheckRun/StatusContext union) and `reviewThreads`/`comments` are byte-identical (diff-verified), as are the post-processing loops (CheckRun-vs-StatusContext discrimination → `GitHubPrCheckSummary[]`; unresolved-thread filter → `unresolvedReviewComments`). Callers are genuinely distinct: `ipc/helpers.ts:290` (lean blocking-check) vs `register-pr-handlers.ts:38` (full detail panel) — so the two *methods* are legitimate; the *parsing* is not. | Extract pure `buildCheckSummaries(contexts)` + `buildUnresolvedReviewComments(reviewThreads)` helpers; keep the two query strings separate (field selection genuinely differs). Effort M, mechanical. Needs new unit tests for the two helpers (none exist). |
| C2 | `fetchProjectPriorities` / `fetchProjectStatuses` duplicate the Projects-v2 pagination + error harness | [project-priority.ts:168-215](../../packages/agents/src/github/project-priority.ts) vs [project-status.ts:274-320](../../packages/agents/src/github/project-status.ts): same parseGithubProjectUrl bail, same isOrg query-pair ternary, byte-identical cursor-paginated `gh api graphql` loop and `isMissingScopeError` → "run gh auth refresh -s read:project" warning. Any future project-field sync (iteration, custom fields) will copy it a third time. | Extract `paginateProjectV2Items({projectUrl, cwd, maxPages, onWarn, orgQuery, userQuery, extractPage})` in `github/project-v2-pagination.ts`. Effort M, mechanical. |
| C3 | PRD-rewrite model-pick + skill-fallback prompt duplicated byte-for-byte across two IPC handlers | [register-github-handlers.ts:1501-1522](../../apps/desktop/src/main/ipc/register-github-handlers.ts) (`github:rewrite-issue`) ≡ [register-support-handlers.ts:116-138](../../apps/desktop/src/main/ipc/register-support-handlers.ts) (`ai:enhance-prd`): settings→modelId pick, `assertPrdRewriteModelSupported`, `skills/writing-prds/SKILL.md` read with the same ~500-char hardcoded fallback prompt. Two entry points to "PRD rewrite" can silently hand different prompts to the agent. | Extract `resolvePrdRewriteContext(settings, project)` → `{modelId, skillContent}` in ipc/helpers.ts. Effort S, mechanical. |

### Cluster D — Agent process/CLI invocation (`packages/agents`)

Verified inline (the domain finder for this package repeatedly stalled; seeds were checked by hand and cross-covered by the over-abstraction verifiers).

| # | Finding | Evidence | Fix |
|---|---------|----------|-----|
| D1 | `runPrdCliWithStdin` ([prd-generator.ts:~130-165](../../packages/agents/src/prd-generator.ts)) ≡ `runSkillCliWithStdin` ([skill-rewriter.ts:170-207](../../packages/agents/src/skill-rewriter.ts)) | Near-identical ~35-line wrappers: same codex-rejection guard, same args array (`-p`, `--model`, `--output-format json`, `--max-turns 3`, thinking-tokens IIFE, `--allowedTools ''`), same `runCliWithStdin` call with `CLAUDE_TEXT_ENV_KEYS`. **Real divergence found: prd-generator validates `modelId` against an injection-guard regex; skill-rewriter's copy lacks the guard entirely.** | Extract shared `runNoToolsTextGeneration(cli, prompt, {cwd, timeoutMs, modelId, reasoningEffort, errorLabel})` next to `runCliWithStdin` in cli-stdin-runner.ts; include the modelId validation in the shared path (skill-rewriter gains the missing guard — deliberate behavior fix, note in PR). Effort S, semantic (one site gains validation). |
| D2 | `ProcessManager.spawn` (L311) / `spawnWithStdin` (L428) duplicate spawn preamble + settle wiring | [process-manager.ts](../../packages/agents/src/process-manager.ts): identical `nanoid` id / `outputMode` default / `assertWorkspacePolicy` / env-cache refresh / `resolveCommand` preamble (315-335 vs 433-448), plus similar exit/output listener wiring. The pty-vs-child_process backends legitimately differ after the preamble. | Extract the preamble into a private `prepareSpawn(command, cwd, options)` helper. Effort S, mechanical. |
| D3 | Settle/abort logic duplicated between [cli-provider.ts:150-175](../../packages/agents/src/providers/cli-provider.ts) and [stdin-cli-runner.ts:90-117](../../packages/agents/src/providers/stdin-cli-runner.ts) | Same output/exit handler + abort-then-2s-grace-settle (exit 130) pattern. **Real divergence: stdin-cli-runner handles a pre-aborted signal (`if (req.signal.aborted) abortHandler()`); cli-provider does not** — if the signal is already aborted before listeners attach, cli-provider waits for natural process exit. | Extract a shared `awaitManagedProcess(processManager, process, signal, {onData})` settle helper; adopt the pre-aborted check in both (behavior fix for cli-provider, note in PR). Effort S, semantic. |
| D4 | Two stdin-runner modules exist: `cli-stdin-runner.ts` (root, text-generation path) and `providers/stdin-cli-runner.ts` (provider path) | Same conceptual job (spawn CLI, pipe prompt via stdin per the repo's argv rule, await settle) implemented twice for two call families. | Fold into one module once D1/D3 land; don't force-merge before — the terminal-event forwarding is a real difference. Effort M, semantic, low priority. |

### Cluster E — DB migration registry (`packages/db`) — **highest ROI in the repo**

- [index.ts](../../packages/db/src/index.ts) imports all 63 migration functions (24-88) and calls them sequentially (153-215). [test-helpers.ts](../../packages/db/src/test-helpers.ts) duplicates both lists **byte-for-byte** (diff exit 0, 132 lines). Verification found a **third** hand-typed copy in `schema.test.ts:103-168` that stops at V62 (missing V63), plus a `migrateThrough` helper walking it. [schema.ts](../../packages/db/src/schema.ts) only re-exports grouped by source file — order exists nowhere canonically.
- **Fix:** add `export const MIGRATIONS: Array<(db: DatabaseSync) => void> = [migrate, migrateV2, …, migrateV63]` to schema.ts; `getDatabase()` / `createTestDb()` / `schema.test.ts` loop over it. **Constraint from verification:** keep the individual named exports — `prompt-telemetry.test.ts` (migrateV35), `pipeline-runs.test.ts` (migrateV56), `pipeline-steps.test.ts` (migrateV38), `pipeline-wake-requests.test.ts` (migrateV57) import specific migrations by name for version-pinned seeding. Additive only.
- Effort S, mechanical, low risk — 29 query test files already exercise `createTestDb()`, so any ordering regression fails loudly.
- **Related sweep (verified in run 1):** `ISO_NOW_SQL` exists in [packages/shared/src/sqlite-time.ts:25](../../packages/shared/src/sqlite-time.ts) precisely so the strftime format string is single-sourced, but **7 query files hardcode the identical literal inline** (`issue-chat-sessions.ts:60,82`, `task-graphs.ts`, `feature-qa-results.ts`, `issue-edges.ts`, `pipeline-steps.ts`, `review-findings.ts`, `project-failures.ts`) while 9 files import the constant. `github-issues.ts` is compliant except one **non-substitutable** variant at line 590 (`strftime(..., 'now', '-5 minutes')` — date-modifier syntax the constant can't express; leave it, add a comment). Byte-identical substitution for the 7. Effort S, mechanical.

### Cluster F — `packages/git` divergent duplicates (semantic, small but real)

- **`getDefaultBranch()` implemented twice with different fallback priority:** [git-service.ts:102-113](../../packages/git/src/git-service.ts) checks `main → master → current ?? 'main'`; [worktree.ts:325-337](../../packages/git/src/worktree.ts) checks `current → main → master → 'main'`. On a repo where origin/HEAD is unset and the current branch is neither main nor master, cleanup-protection and worktree-base selection can disagree about "the default branch." Fix: one `resolveDefaultBranch(git, branchLocal)` helper with a **deliberately chosen** order (recommend symbolic-ref → main → master → current → 'main'); add a table-driven test locking the order — the divergence went unnoticed precisely because this case is untested. Effort S, **semantic** (behavior decision).
- `getBranchDivergence` (253-279) vs `getDivergence`+`resolveCompareRef` (281-327) duplicate the `rev-list --left-right --count` parse idiom (including the same asymmetric `?? '0'` quirk). Genuinely different call shapes; low priority — extract `parseRevListCounts(raw)` only if touching the file anyway.

### Cluster G — Desktop renderer boilerplate

| # | Finding | Evidence | Fix |
|---|---------|----------|-----|
| G1 | Settings/telemetry `useQuery` boilerplate: **9 files** re-declare the same query, no shared hook | `queryKey: ['settings']` grep = 11 files, but verification removed 2 (HealthBanner, TelemetryConsentDialog only `invalidateQueries`). Of the real 9, blocks are *not* byte-identical: NotificationToaster adds `enabled: notifications.length > 0`, ProjectSettingsModal adds `enabled: projectSettingsModalOpen`, IssueDetail types as `AppSettings \| null`. `staleTime` is already a shared constant. | Extract `useAppSettings({enabled?})` / `useTelemetryStatus()` hooks in `renderer/hooks/`. **Not a naive drop-in** — the `enabled` param must be designed in or two components silently change fetch behavior. Effort S–M, semantic-lite. |
| G2 | Update-status query + live IPC sync duplicated | [UpdateBanner.tsx:13-25](../../apps/desktop/src/renderer/components/UpdateBanner.tsx) ≡ [AboutSettingsSection.tsx:58-70](../../apps/desktop/src/renderer/components/settings-panel/AboutSettingsSection.tsx): identical `useQuery(['update-status'])` + `useEffect` subscribing `update:status-changed` → `setQueryData`. Banner and settings can disagree about update availability if one copy drifts. Only two call sites (grep-verified). | Extract `useUpdateStatus()` (query + sync effect). Existing component tests already mock and exercise the event — re-run as regression bar. Effort S, mechanical. |
| G3 | Confirm-dialog interaction contract duplicated 4× | ThreadPanelArchiveDialog, ThreadPanelBoardReviewDialog, and 2 modals inside IssueDetailDialogs.tsx each redeclare the `e.metaKey && e.key==='Enter'` → confirm handler + Modal + warning box + Cancel/Confirm footer. CleanupModal correctly excluded (multi-step UI). | Extract `ConfirmDialog({open, onClose, title, warningText, warningVariant, confirmLabel, confirmVariant, onConfirm, disabled?})` on the existing Modal/ModalFooter primitives. Add interaction tests for Cmd+Enter + disabled state first. Effort M, mechanical. |
| G4 | Settings form-row markup copy-pasted | [PipelineSettingsSection.tsx:594-660](../../apps/desktop/src/renderer/components/settings-panel/PipelineSettingsSection.tsx): three identical label+Select blocks (paid/free/fallback model). [IntegrationsSettingsSection.tsx:150-233](../../apps/desktop/src/renderer/components/settings-panel/IntegrationsSettingsSection.tsx): terminal-picker and project-opener sections are the same component written twice (Select + DesktopAppHealthCard list). | Extract `LabeledModelSelect` (local) and `AppPickerSection({title, description, targets, value, onChange})`. Effort S each, mechanical, presentational-only. |
| G5 | 8 GitHub issue-override IPC handlers repeat get-or-throw → validate → mutate → broadcast → refetch | [register-github-issue-override-handlers.ts:19-251](../../apps/desktop/src/main/ipc/register-github-issue-override-handlers.ts): all 8 issue-scoped handlers repeat `getByNumber`-or-throw → field validation → one `update*Override` call → `sendGithubIssuesUpdated` → refetch-return. The broadcast-after-mutate contract is a behavioral invariant repeated 8× by hand; this file grows with every new per-issue override. | Handler factory `defineIssueOverrideHandler(ipcMain, mainWindow, queries, channel, mutate)`. Keep per-field validation inline (genuinely differs). Effort M, mechanical. |
| G6 | IssuesPanel action handlers: 25 occurrences of refresh→invalidate→log→toast — **but do NOT extract one generic helper** | Verification read all handler bodies (IssuesPanel.tsx:507-1141): `onCancel` has no toast; `onPause`/`onResume` invalidate an extra key; `onMarkDone`/undo roll back bespoke local state; `onRetry` branches IPC channels; `onRefreshBranches`/`onBaseBranchChange` intentionally skip `refreshIssues`. A generic `runPipelineAction` would either change behavior at multiple sites or need so many flags it stops simplifying. | Scope extraction to the plain `invoke → refresh → catch(refresh+log+toast)` subset only (onPause/onResume/onStartPipeline-shaped handlers); explicitly exclude the seven divergent handlers. Effort M, semantic. |

### Cluster H — Kanban board internals (`packages/ui/src/kanban-board`)

| # | Finding | Evidence | Fix |
|---|---------|----------|-----|
| H1 | Status→tone branch logic implemented 3× with different output shapes | [utils.ts](../../packages/ui/src/kanban-board/utils.ts): `statusDotColorClass` (84-100), `statusDotTextColorClass` (102-118), `rowToneFor` (438-455) — normalized branch trees are byte-identical (verifier script-checked), outputs differ (`bg-*` class / `text-*` class / `RowTone` enum). One of the three is already dead (H3). A new pipeline status requires three hand-synced edits; drift = dot color disagreeing with row tint. | One canonical `statusTone(status, approvedAwaitingExecution) → RowTone`, plus tone→class lookup tables. Existing utils.test.ts branch assertions verify the refactor mechanically. Do together with H3. Effort M, semantic-lite. |
| H2 | Column-header chrome duplicated between `DroppableColumn` (143-189) and `StackedColumn` (551-597) in [BoardColumns.tsx](../../packages/ui/src/kanban-board/BoardColumns.tsx) | Count badge + hide-column DropdownMenu blocks differ only in two identifier substitutions (diff-verified). The DraggableCard prop spreads below them genuinely diverge (backlog-only actions vs full lifecycle actions) — **not** mergeable. | Extract `ColumnHeaderCountBadgeAndMenu({colorClass, count, readOnly, onHideColumn})`. Leave card prop surfaces alone. Effort S, mechanical. |
| H3 | Dead status helpers, one a permanent no-op | `statusDotColorClass` + `dragOverlayBorderClass` (147-152 — unconditionally `return ''`, params underscore-prefixed): zero production call sites repo-wide (rg-verified), not in the package barrel, only self-referential tests. The real drag-overlay border is hardcoded in IssueCardParts.tsx L636. | Delete both + their test assertions — **surgically**: the assertions live inside `it` blocks that also cover live functions (utils.test.ts 753-769, 771-780); remove lines 754-760 and 777 only, not the blocks. Effort S, mechanical. |
| H4 | `issueReferenceLabel` duplicated verbatim | Private helper in [IssueCardParts.tsx:54-59](../../packages/ui/src/kanban-board/IssueCardParts.tsx) reimplemented inline in [IssueListView.tsx:83-89](../../packages/ui/src/kanban-board/IssueListView.tsx). | Hoist into utils.ts, import in both. Effort S, mechanical. |
| H5 | List-view row-prop wiring duplicated within one file — **narrower than it looks** | Verification refuted the cross-file "three forks" framing: DroppableColumn vs SectionBlock render different action sets for statically different column types (constants.ts config; never interchangeable). The only real duplication is local to IssueListView.tsx: ListSectionBlock (365-384) vs the flat inline map (510-527), diverging only in `onArchiveIssue` forwarding. | Small local `getListRowProps(issue, columnKey, …)` helper in IssueListView.tsx only. **No cross-file hook, no BoardColumns changes.** Effort S, mechanical. |

### Cluster I — Text/formatting utilities

| # | Finding | Evidence | Fix |
|---|---------|----------|-----|
| I1 | Four independent relative-time formatters | [shared/format-relative-time.ts](../../packages/shared/src/format-relative-time.ts) (s/m/h/d, past-only; 6 call sites); [automation-time.ts](../../apps/desktop/src/renderer/features/automations/automation-time.ts) (reimplemented bucketing + future support + 'just now', **no seconds bucket**, different input union); [Titlebar.tsx:61-75](../../apps/desktop/src/renderer/components/Titlebar.tsx) `formatCheckedAt` (third copy: 45s 'just now' threshold, `Math.round` not `floor`); [staleness.ts:49-52](../../packages/shared/src/staleness.ts) (intentionally coarser — hours/days only). Users see inconsistent phrasing for the same concept. | Consolidate into shared `formatRelativeTime(input, {mode: 'past-only'\|'bidirectional', granularity: 'second'\|'minute', justNowThresholdSec?})`. Verification upgraded this from S to **M**: both existing test fixture sets (5 assertions in coverage-utilities.test.ts, 10 in automation-time.test.ts) must be preserved exactly; input unions must be reconciled. Leave `formatStalenessAge` alone (deliberate coarseness — merging would change badge text). Effort M, semantic. |
| I2 | 7+ truncate-with-ellipsis implementations | [shared/errors.ts:9-18](../../packages/shared/src/errors.ts) `clampError` owns the concept; [review-findings.ts:13-21](../../packages/pipeline/src/pipeline/review-findings.ts) `truncateCompact` re-implements it + whitespace collapse; inline one-liners at RunsTab.tsx:58 (220), git-workflows.ts:26 (800), telemetry.ts:112 (**500 — appends '...' with no reserved space, overshoots its own bound by up to 3 chars**), register-project-handlers.ts:834 (60), claude-normalizer.ts:46 ≡ codex-normalizer.ts:54 (identical 60-char pattern in sibling files — cleanest first target). Mixed `...` vs `…` glyphs. | Shared `truncate(text, max, {collapseWhitespace?})` in shared/errors.ts, standardizing on the `max-1` reservation convention (fixes telemetry.ts overshoot — call out as intentional behavior fix). `compact()` in review-findings is multi-purpose (also feeds hash fingerprinting); leave it, route only `truncateCompact` through the shared helper. Effort S, mechanical + one flagged fix. |
| I3 | `formatTimestamp` placement | [components/format-timestamp.ts](../../apps/desktop/src/renderer/components/format-timestamp.ts) is a genuinely distinct absolute-timestamp formatter (not a clone — see §8), but it's the only `format-*` utility living outside `packages/shared`, used 9+ places. | Move to `packages/shared/src/format-timestamp.ts` with its test. Effort S, mechanical, low priority. |

### Cluster J — HTTP fetch wrappers (critic-surfaced gap)

Four hand-rolled one-shot fetch implementations, no shared primitive:

| Site | Timeout | Retry | Error shape |
|------|---------|-------|-------------|
| [update-service.ts:93-124](../../apps/desktop/src/main/update-service.ts) | manual AbortController + setTimeout/.finally, 10s hardcoded | none | throws; 404-as-success business rule |
| [chat-notification-service.ts:218-256](../../apps/desktop/src/main/chat-notification-service.ts) | `AbortSignal.timeout(10s)` | hand-rolled recursive, `[0,500,1500]` | never throws; clampError status object |
| [health-check.ts:717,763,790](../../packages/agents/src/health-check.ts) (3 sites) | `AbortSignal.timeout(10s)` | none | degrades to non-fatal warning |
| [openrouter-http.ts:197-251](../../packages/agents/src/providers/openrouter-http.ts) | custom `anySignal` (external signal + internal timeout) | exponential backoff + Retry-After | typed `OpenRouterError(kind, retryable)` |

The differing **error shapes are legitimate** (health checks must never throw; notification delivery needs a status record). The duplicated part with no reason to differ is the timeout/abort plumbing. **Fix:** extract `fetchWithTimeout(url, init, timeoutMs, outerSignal?)` in `packages/shared` (adopting the `anySignal` combination); migrate the first three rows. **Leave openrouter-http.ts alone** — its retry/backoff/SSE-streaming layer is provider-specific and already well-factored. A 5th fetch site, `server-lifecycle.ts:43-60 pollHttp`, is a deadline-loop readiness poller (localhost-only, swallow-all-errors) — verified as a legitimately different shape; **exclude it** from any consolidation. Existing update-service/chat-notification tests (fake-timer abort, retry call counts) are the acceptance bar. Effort S, mechanical.

### Cluster K — e2e and test-file duplication

| # | Finding | Evidence | Fix |
|---|---------|----------|-----|
| K1 | 3 of 5 e2e coverage-gate scripts share a byte-identical skeleton | check-app-coverage.mjs (172L) / check-page-coverage.mjs (126L) / check-flow-coverage.mjs (100L): identical `fail()`, `readJson`, gate-precedence chain (env > manifest.gateMinPct > default), rows/covered/drift computation, artifact write, ✓/⚠/· table. check-behavior-coverage.mjs (177L) shares the algorithm but different glyph conventions (FAIL/OK/MISS/TODO). check-page-inventory.mjs is a different concern (derive-from-source) — keep separate. All wired into `e2e:ci` (e2e/package.json:9; e2e.yml:199) — **not dead**, contrary to knip. | Extract `e2e/scripts/lib/coverage-gate.mjs` (`runCoverageGate({manifestPath, artifactPath, envVar, defaultGateMin, rows, driftCheck, extraChecks})`); each checker becomes a ~25-line manifest adapter. Parameterize or deliberately normalize behavior-coverage's glyphs (sign-off needed if normalizing). Re-run `bun run e2e:ci` before/after as the regression check. Effort M, mechanical. |
| K2 | e2e specs duplicate navigation preludes | `selectSeedProject` defined verbatim in both app-shell-behaviors.e2e.ts and page-behaviors.e2e.ts (fixtures dir has no such helper); pipeline-lifecycle.e2e.ts duplicates its own issue-detail-open prelude within one file (37-57 vs 74-87, including identical explanatory comments). | Add `selectSeedProject`, `openIssueDetail`, `openAutomationCreateModal` to `e2e/src/fixtures/flows.ts`. Effort S, mechanical. |
| K3 | Two test files cover the same telemetry behavior | `pipeline-prompt-telemetry.test.ts` (4 tests) and `prompt-telemetry.test.ts` (2 tests) — no production file under either name; identical describe name, near-identical fixtures, one test duplicated almost by name. | Merge into pipeline-prompt-telemetry.test.ts; diff the `it()` sets first to preserve the 3 unique assertions. Effort S, mechanical. |

---

## 3. Dead / obsolete code candidates

**Safe deletes (mechanical):**

| Item | Evidence | Action |
|------|----------|--------|
| `statusDotColorClass` + `dragOverlayBorderClass` in [packages/ui/src/kanban-board/utils.ts:84-100,147-152](../../packages/ui/src/kanban-board/utils.ts) | Zero production call sites (rg-verified); second one is an unconditional `return ''`. | Delete + surgical test-line removal (see H3). |
| `coverage:legacy` script ([package.json:27](../../package.json)) | Zero references in `.github/workflows/*`; predates the sharded pipeline that CI actually runs (`ci.yml:172` → `bun run coverage`). | Delete the script entry (or comment why it's kept as a manual escape hatch). |
| `DEFAULT_FAN_OUT_WORKER_COUNT` export ([workflow-loader.ts:8](../../packages/pipeline/src/workflow-loader.ts)) | Used only within its own file (lines 80, 116); zero external importers. | Drop the `export` keyword. |
| Unused-export knip hits worth acting on: `breadcrumbForEvent`/`recordBreadcrumb` (telemetry.ts), `syncIssueChatCommentsOnce`/`buildGithubIssueChatTurn` (issue-chat-comment-sync.ts), `resolveLinkedPullRequestPipelineStatus` (ipc/helpers.ts:208), `parseOnboardingRepoList` (register-support-handlers.ts:44), `cleanTerminalText` (provider-usage-parsers.ts) | Flagged by knip; spot-verified subset has no cross-module importers. | Per-symbol: delete or un-export after a final grep each (5-minute batch). |
| `docs/coverage-leftovers.md` snapshot | "Last updated 2026-05-24", ~5.5 weeks stale, actively cross-referenced as "source of truth" by `.agents/SYSTEM/SUMMARY.md`. | Refresh via `node scripts/coverage-summary.mjs`, don't delete — it's a live workflow doc with a stale payload. |

**Needs-decision (do NOT mechanically delete — verification found live wiring):**

- **`clawpatch:*` scripts (6, incl. `clawpatch:status` the finder missed):** no CI usage, but deliberately integrated in one commit (config + .gitignore + biome exclusion, 2026-05-17, by repo owner) as a manual local review tool. Confirm with owner before touching; CI-absence is by design for manual tooling.
- **`@anthropic-ai/sandbox-runtime` (apps/desktop dep, knip-flagged):** resolved at *runtime* via `require.resolve` in [srt.ts:137](../../packages/agents/src/sandbox/srt.ts) — the desktop declaration ensures it ships in the Electron install tree. Keep; knip false positive.
- **`srt.ts` `buildSrtPolicy`/`resetSrtResolutionCache`, `_internals` in cursor/gemini providers, `__resetForTests`/`__TEST_INTERNALS` (path-fix.ts):** test-only escape hatches, several `@knipignore`-tagged. Keep.

**Verified knip false positives (documented so the next sweep doesn't re-litigate):** `.deepsec/` (isolated separate pnpm workspace, not part of the monorepo graph); `shipcode-ui-source-alias.ts` (imported by vite.config.ts:7 and vitest.config.ts:4); all five `e2e/scripts/check-*.mjs` (wired into `e2e:ci`); `test-fake-proc.ts` (shared test helper, 6 importers); `scripts/run-coverage-shards.mjs` + `scripts/verify-affected-workspaces.ts` (root package.json `coverage:sharded` / `verify:affected`); `vitest.package-config.ts` (imported by 5 package vitest configs — pipeline, agents, shared, db, git); `collectDirtyStatusFiles` (used at git-workflows.ts:79 feeding `runAutoCommitWorkflow`); the 391 "unused files" (knip failed to load every vite/vitest/playwright config — `Cannot find module` errors at the top of its output — so it never saw config-file imports). **Root-cause fix worth doing:** make `bun run deadcode` able to load the configs (the missing modules exist in workspace node_modules; knip runs from root context) — until then, every knip run will re-produce ~400 lines of noise that buries the ~10 real findings.

**Abandoned migrations:** none — `packages/db` uses sequential in-code migrations (base-schema + v-range files), all 63 referenced; no orphaned migration files found.

---

## 4. Inconsistent local patterns (same concept, divergent behavior)

These are the dangerous ones — not textual clones, but the same business concept implemented with different semantics.

### 4.1 `OpenRouterAuthStatus` — duplicate name, incompatible shapes, silent data loss (bug)
[shared/types/health.ts:119](../../packages/shared/src/types/health.ts) = `'missing_key'|'valid'|'invalid_key'|'unreachable'` (10+ renderer consumers). [agents/health-check.ts:686-692](../../packages/agents/src/health-check.ts) = `{ok:true,…} | {ok:false, reason:'missing_key'|'invalid_key'|'unreachable'|'model_deprecated', …}` (re-exported a third time from agents/index.ts:65). The bridge at health-check.ts:866 is a non-exhaustive boolean ternary that maps `model_deprecated → 'unreachable'`. Meanwhile [apps/cli/onboard.ts:112](../../apps/cli/src/commands/onboard.ts) *does* distinguish `model_deprecated` — so CLI onboarding tells users the truth and the desktop settings UI doesn't. **Fix:** rename the agents type to `OpenRouterAuthCheckResult` (it's an RPC result, not a status enum); add `'model_deprecated'` to the shared union or derive `authStatus` via an exhaustive switch on `auth.reason`. Test gap confirmed: health-check.test.ts covers `model_deprecated` construction but not its propagation through `checkOpenRouterHealth`. Effort S, semantic.

### 4.2 PipelineEvent switches with no exhaustiveness — already dropping events
[cli-emitter.ts:21-87](../../apps/cli/src/adapters/cli-emitter.ts) and [pipeline-bridge.ts:207-265](../../apps/desktop/src/main/pipeline-bridge.ts) hand-enumerate the event union; neither has a `default: event satisfies never` guard, and **verification found `pipeline:turn-started`/`pipeline:turn-completed` (types.ts:160-166) are unhandled in both switches today** — a new event type just makes the CLI "go silent" with no error. **Fix:** do not merge the emitters (side effects legitimately differ); add exhaustiveness guards to both — the compile errors they immediately raise for the two turn events prove the fix works. Effort S, semantic.

### 4.3 CLI vs desktop behavior parity
Covered as B3/B4 above: retry semantics and model routing differ silently between the two front ends. Flagged as product decisions, not blind merges.

### 4.4 Smaller divergences found by verification
- `prd-generator` validates modelId; `skill-rewriter`'s cloned wrapper doesn't (D1).
- `stdin-cli-runner` handles pre-aborted signals; `cli-provider` doesn't (D3).
- `telemetry.ts` truncation overshoots its own 500-char bound (I2).
- `ensureContext`'s two branches only agree because `resolveProviderReasoningEffort` happens to be idempotent (A3).
- `getDefaultBranch` fallback order differs between GitService and WorktreeManager (F).
- `PrdMetadata` inline type declared 3× (`register-github-handlers.ts:955-968,1069-1082` + the canonical contract in [ipc-channels.ts:360-377](../../packages/shared/src/ipc-channels.ts)) with no named export; no `PrdMetadataInput` exists in shared. Extract `PrdMetadataFields` in `prd-issue-metadata.ts`, reference from all three. Effort S, mechanical.
- Two test files named `prompt-scope.test.ts` exist ([src/prompt-scope.test.ts](../../packages/agents/src/prompt-scope.test.ts) and [src/prompts/prompt-scope.test.ts](../../packages/agents/src/prompts/prompt-scope.test.ts)) — inspected: **different content** (module unit tests vs prompt-builder integration tests), not duplicates; rename the latter (e.g. `prompt-builders.test.ts`) to kill the confusion. Cosmetic.

### 4.5 Slop watch (no action mandated, keep visible)
- **God files** (non-test, >900 lines): IssueDetail.tsx 1835, execution-phases.ts 1719, gh-cli.ts 1583, register-github-handlers.ts 1566, register-project-handlers.ts 1468, health-check.ts 1324, register-pipeline-handlers.ts 1253, IssuesPanel.tsx 1189, KanbanBoard.tsx 1017, PipelineSettingsSection.tsx 1007. The clusters above chip at the worst offenders; don't do a "split the file" pass for its own sake — every extraction here is tied to a concrete duplication.
- The `*.callbacks.test.tsx` / `*.coverage.test.tsx` naming pattern in desktop/ui suggests coverage-driven test padding; this audit sampled adjacent suites (utils.test.ts asserts real branch outputs) but did **not** conclusively assess the callbacks family. Open question, not a finding.

---

## 5. Recommended shared modules/components

Only abstractions that passed the "removes real complexity / one source of truth for behavior that must stay in sync" bar. Explicitly rejected generalizations are in §8.

**packages/shared:**
1. `MIGRATIONS` ordered array in `packages/db/src/schema.ts` (E) — the one everyone should do first.
2. `truncate(text, max, {collapseWhitespace?})` in `errors.ts` (I2).
3. `formatRelativeTime(input, opts)` consolidation (I1).
4. `fetchWithTimeout(url, init, timeoutMs, outerSignal?)` (J).
5. `RetryAction` union + `getRetryAction` decision fn (B2/B3 — pure, already shared-typed inputs).
6. `PrdMetadataFields` type in `prd-issue-metadata.ts` (§4.4).
7. `'model_deprecated'` member on `OpenRouterAuthStatus` (4.1).

**packages/agents:**
8. `buildCheckSummaries` / `buildUnresolvedReviewComments` pure parsers (C1).
9. `paginateProjectV2Items` harness (C2).
10. `runNoToolsTextGeneration` CLI wrapper (D1).
11. `prepareSpawn` / `awaitManagedProcess` process helpers (D2/D3).

**packages/pipeline:**
12. `PipelineStartOptions` + `bootstrapPipelineRun` + `haltActivePipeline` + `synthesizeDirectExecutionPlan` (A1/A2/A4).

**apps/desktop:**
13. `useAppSettings` / `useTelemetryStatus` / `useUpdateStatus` hooks (G1/G2).
14. `ConfirmDialog` on Modal primitives (G3).
15. `resolvePrdRewriteContext` in ipc/helpers.ts (C3).
16. `defineIssueOverrideHandler` factory (G5).
17. `LabeledModelSelect`, `AppPickerSection` (G4).

**packages/ui:** 18. `statusTone` + tone→class tables; `ColumnHeaderCountBadgeAndMenu`; hoisted `issueReferenceLabel` (H1/H2/H4).

**e2e:** 19. `scripts/lib/coverage-gate.mjs`; `src/fixtures/flows.ts` (K1/K2).

---

## 6. Refactor roadmap (ROI-ordered)

### Wave 1 — mechanical, S-effort, low-risk (one PR each or batched; ~1–2 days total)
| Order | Item | Cluster |
|---|---|---|
| 1 | `MIGRATIONS` registry (keep named exports) | E |
| 2 | ISO_NOW_SQL sweep (7 files) | E |
| 3 | Delete dead kanban helpers (surgical) | H3 |
| 4 | Hoist `issueReferenceLabel`; local `getListRowProps` | H4/H5 |
| 5 | `resolvePrdRewriteContext` extraction | C3 |
| 6 | `synthesizeDirectExecutionPlan` | A4 |
| 7 | `haltActivePipeline` (+ tail-asymmetry note) | A2 |
| 8 | `useUpdateStatus` hook | G2 |
| 9 | `PrdMetadataFields` type (3 sites) | 4.4 |
| 10 | `coverage:legacy` delete; `DEFAULT_FAN_OUT_WORKER_COUNT` unexport; unused-export batch | §3 |
| 11 | Exhaustiveness guards on both event switches (fixes 2 live gaps) | 4.2 |
| 12 | `fetchWithTimeout` + migrate 3 call families | J |
| 13 | e2e `fixtures/flows.ts` preludes | K2 |
| 14 | Merge telemetry test files | K3 |
| 15 | Normalizer truncation dedupe + `truncate()` helper (flag telemetry.ts bound fix) | I2 |

### Wave 2 — mechanical-leaning, M-effort (each its own PR; ~3–5 days total)
| Order | Item | Cluster |
|---|---|---|
| 16 | gh-cli parse-helper extraction (**largest clone**) + new unit tests | C1 |
| 17 | Projects-v2 pagination harness | C2 |
| 18 | Pipeline bootstrap extraction (`PipelineStartOptions`, `bootstrapPipelineRun`) | A1 |
| 19 | Scheduler: delete `_resolvePhaseModels` copy; extract launch orchestration | B1 |
| 20 | `useAppSettings`/`useTelemetryStatus` (designed `enabled` param) | G1 |
| 21 | Issue-override handler factory | G5 |
| 22 | `ConfirmDialog` + interaction tests | G3 |
| 23 | Settings field components | G4 |
| 24 | `statusTone` consolidation + column-header component | H1/H2 |
| 25 | e2e coverage-gate lib | K1 |
| 26 | `runNoToolsTextGeneration` + `prepareSpawn`/`awaitManagedProcess` | D1–D3 |

### Wave 3 — semantic, needs decisions/tests-first (sequence deliberately; ~1 week)
| Order | Item | Why gated |
|---|---|---|
| 27 | `OpenRouterAuthStatus` rename + `model_deprecated` propagation | User-visible status text changes; add propagation test first |
| 28 | `RetryAction`/`getRetryAction` to shared; reconcile renderer's lastError guard | Decision logic merge; add unit tests for `resolveIssueRetryPresentation` first (none exist) |
| 29 | `ensureContext` reasoning-effort dedupe (drop redundant re-resolve) | Add branch-equality assertion test first |
| 30 | `resolveDefaultBranch` canonical fallback order | Behavior decision; table-driven test locks the order |
| 31 | Relative-time consolidation (mode + granularity params) | Two existing test fixture sets must survive exactly |
| 32 | CLI retry parity (move `buildExecutionResumeContext`) | Product sign-off: should CLI match desktop retry? |
| 33 | CLI model-routing parity or explicit label-only doc | Product decision |
| 34 | IssuesPanel narrowed action-helper subset | Verified 7 handlers must be excluded; line-by-line catch-block diffing |

Dependencies: 28 before 32 (shared `getRetryAction` unlocks CLI parity). 3 before 24 (delete dead helper before consolidating tone logic). 18/A2 before any pipeline/entry-points.ts layout move (explicitly not tracked as its own item).

---

## 7. Risk & test coverage per refactor

| Item | Risk | Existing coverage | Required before merge |
|---|---|---|---|
| MIGRATIONS registry (1) | Low | 29 query test files boot `createTestDb()` — ordering regressions fail loudly | Full `packages/db` suite; keep named exports (4 version-pinned test importers) |
| ISO_NOW_SQL sweep (2) | Low | Insert/upsert timestamps covered per query file | Byte-identical substitution; skip github-issues.ts:590 modifier variant |
| Dead kanban helpers (3) | Low | Self-referential tests only | Remove assertion lines 754-760/777 only; keep live-fn assertions in same `it` blocks |
| gh-cli parsers (16) | Medium | **None on the parsing loops** | New unit tests for both helpers from recorded GraphQL fixtures; both IPC paths (helpers.ts:290, register-pr-handlers.ts:38) smoke-tested |
| Pipeline bootstrap (18) | Medium | pipeline.test.ts has dedicated describe blocks for both entry points incl. option-override assertions (~5367, ~5675) | Scoped pipeline.test.ts run; preserve the cachedIssue `requireApproval` divergence |
| cancel/pause teardown (7) | Low | cancel/pause tests incl. missing-thread no-ops (~5935-6017) | Do NOT symmetrize tails; no test asserts `pipelineRuns.finish` call counts — add one |
| Scheduler dedupe (19) | Medium | register-pipeline-handlers.test.ts + pipeline-scheduler.test.ts | Type-compat verified already; assert both launch paths persist identical phase-model sets |
| useAppSettings hooks (20) | Low-med | Component tests mock `window.shipcode` | `enabled` param must reproduce NotificationToaster/ProjectSettingsModal guards exactly |
| useUpdateStatus (8) | Low | UpdateBanner.test.tsx + AboutSettingsSection.test.tsx already exercise the event | Re-run both suites — sufficient |
| ConfirmDialog (22) | Low | Unknown per-dialog coverage | Add Cmd+Enter + disabled-state interaction tests to the new component first |
| Override-handler factory (21) | Low | register-github-handlers tests exist for siblings | Assert broadcast+refetch contract once in factory tests; keep per-field validation tests |
| statusTone (24) | Low | utils.test.ts asserts all three branch outputs | Mechanical verification against existing assertions |
| Event-switch guards (11) | Low (compile-time) | None | The guard IS the test; then decide handling for the 2 newly-surfaced turn events |
| fetchWithTimeout (12) | Low | update-service/chat-notification tests assert timeout + retry counts with fake timers | Those stay green as acceptance; new abort-on-timeout unit test for the primitive |
| OpenRouterAuthStatus (27) | Medium | model_deprecated construction covered; propagation NOT | Add checkOpenRouterHealth propagation test; sweep renderer `authStatus` string comparisons |
| RetryAction share (28) | Medium | Main-side covered; renderer `resolveIssueRetryPresentation` untested | New table-driven tests over thread/plan/verification fixtures asserting both callers agree |
| Reasoning-effort dedupe (29) | Medium | None asserting branch equality | Equality assertion test first — it distinguishes refactor bugs from real semantic change |
| resolveDefaultBranch (30) | Medium | None (divergence proves it) | Table-driven fallback-order test; audit call sites: cleanup protection + worktree base/merge |
| Relative-time consolidation (31) | Medium | 5 + 10 assertions in two suites | Both fixture sets pass against the unified fn before deleting either impl |
| CLI retry parity (32) | High | CLI retry.test.ts covers only the simple switch | Product decision first; new shared-decision tests; e2e smoke on `shipcode retry` |
| Coverage-gate lib (25) | Low | e2e:ci is the only harness | Identical pass/fail/artifact output before/after on current manifests |
| IssuesPanel subset (34) | Medium | Action-handler coverage thin | Per-handler catch-block diff; success+failure path tests for the migrated subset |

---

## 8. Refuted claims & verified non-findings (do not re-flag)

Adversarial verification killed these — recorded so future audits/sweeps don't rediscover them:

1. **"apps/cli's `yaml` dep is unused"** — refuted. `tsup.config.ts` bundles `@shipcode/pipeline` via `noExternal` and pins `external: ['yaml']`; `workflow-loader.ts`'s `parseYaml` runs inside the CLI bundle and resolves yaml at runtime. Removing it breaks the built CLI.
2. **"e2e's @shipcode/* deps are unused"** — refuted. turbo's `e2e.dependsOn: ["^build"]` uses package.json deps as the build graph; removing them stops the desktop bundle being built before e2e runs.
3. **"execution-phases.ts / runtime.ts re-export shims are dead"** — refuted. `runtime.test.ts:9` imports `buildFrozenInstallFallback`/`resolveSetupShell` through the shim and executes them. (The shims are still *odd* — tests are their only consumers — but they are not zero-consumer deletes.)
4. **"Env-var access is scattered and needs a config module"** — refuted (production read-sites are few and localized; the claimed 13-site count didn't survive inspection).
5. **"onboarding:list-repos bypasses GhCli with raw exec"** — refuted on inspection.
6. **The only direct `git` shell-out outside packages/git** is `checkCli('git','--version')` in health-check.ts:1012 — a toolchain version probe, not a repo operation. Centralization holds; do not route it through GitService.
7. **`second-ticker.ts` root file** — a deliberate package sub-path export (`"./second-ticker"` in ui's exports map), not an orphan.

Verified non-findings (checked and clean by design):
- `IssueDetail.tsx`'s two prop-threading blocks = required React prop passing to two sibling panes, not drift.
- `format-timestamp` / `format-relative-time` / `format-clock-time` = three genuinely different formatters.
- `model-provider-options.tsx` / `executor-model-options.ts` already delegate to the shared model catalog — this is the target pattern, not a violation.
- `packages/ui/lib/model-display.ts` (1-line re-export) and `lib/time.ts` (6-line adapter) = legitimate package-boundary wrappers.
- `packages/git` four-module separation (GitService / WorktreeManager / cleanup-analyzer / worktree-artifacts) = clean, non-overlapping responsibilities.
- `pollHttp` (server-lifecycle.ts) = a readiness poller, intentionally not part of the fetch-wrapper family.
- Over-abstraction hunt found **no** delete-worthy indirection layers: the provider registry, template-renderer, and workflow-loader all have real multiple consumers; the repo's bigger problem is missing abstractions, not premature ones.

---

## Appendix — methodology & tooling notes

- **jscpd:** 81 exact clones / 1,453 lines / 1.29% across apps+packages+e2e+scripts (tests and prisma migrations excluded, min-tokens 70). Clone list drove the seed set; every seed was human/agent-verified before inclusion.
- **knip (`bun run deadcode`):** produced 391 "unused files" — noise from failing to load vite/vitest/playwright configs (see §3 root-cause fix). Real signal: ~30 unused exports, ~10 dep flags, of which roughly a third survived verification.
- **Verification protocol:** every finding got an independent adversarial agent instructed to refute it (open cited files, re-run greps, check package.json/turbo.json/.github wiring before accepting any "dead" claim). 54 findings confirmed or adjusted; 7 refuted; corrections from verification are folded into the tables above (several findings' line numbers, counts, and recommendations were materially corrected).
- Coverage limitation: the `packages/agents` domain finder stalled repeatedly under provider rate limits; its seed list was verified manually (Cluster D) and its two largest clones were independently confirmed by the over-abstraction verifiers (C1, C2). The `*.callbacks.test.tsx` test-slop question remains open (§4.5).
