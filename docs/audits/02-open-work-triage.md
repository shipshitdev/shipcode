# 02 — Open-work triage: PRs + issue backlog (2026-07-03)

Reviewed: 3 open PRs, 74 open issues. Every claim below was verified against master (`5d8065a8`) or the PR head branches on 2026-07-03. This doc is the implementation handoff — issue bodies carry the specs; this carries ordering, dependencies, staleness corrections, and decisions.

> **Decisions log (Vincent, 2026-07-03) — all applied to the issues; comments there are authoritative:**
>
> - **#309**: canonical fallback = `symbolic-ref` → `main` → `master` → current → `'main'` (git-service order). Table-driven test first.
> - **#306**: auth-row fix — add `model_deprecated` to the shared union; desktop copy: *"Model deprecated — pick a replacement in Settings → Models"* (warning tone).
> - **#311**: deferred (labeled), no implementation now; #307 still proceeds.
> - **#312**: root-cause fix — extract phase-model routing to a shared package consumed by desktop **and** CLI (after #298). Not scheduled yet.
> - **Hygiene applied**: #75, #249 closed as done; #314 closed as stale; #159 closed as dup of #277; #124 folded into #125 (now a two-phase spike); #250 split into #317 (bugs) / #318 (IPC hardening) / #319 (narrowing+plumbing) / #320 (QA-carry verification) and closed; stale-body corrections posted on #194, #211, #91, #93; deferral-scope clarification on #242.
> - **Ruleset**: keep required thread resolution; agent workflow rule added to repo `CLAUDE.md` (resolve threads before ending a PR turn).

---

## 1. Open PRs — all CI-green, two blocked only on unresolved review threads

Branch protection on `master` requires **review-thread resolution** (ruleset `required_review_thread_resolution: true`). That, not CI, is what blocks #315 and #272. All three branches are 0 behind master.

### PR #273 — DRY/slop audit report (docs-only) — `CLEAN`, merge first
- Zero code changes; ships `docs/audits/01-dry-slop-audit.md`.
- **Merge this before starting any Wave issue**: all 34 wave issues (#280–#313) cite section anchors in this file, which does not exist on master yet.

### PR #315 — AGENTS.md under Codex 32 KiB limit — blocked by 1 thread
- The unresolved CodeRabbit thread is **valid**: `.agents/memory/worktrees.md` example says `remove(thread.worktreePath, thread.branch)` but the real field is `worktreeBranch` (`packages/shared/src/types/pipeline-core.ts:74`; real usage `packages/pipeline/src/pipeline/execution-phases.ts:222`).
- Action: fix the doc line on the branch, re-run `scripts/sync-agent-memory.sh`, resolve thread, merge.

### PR #272 — repo-map audit + cleanup fixes — blocked by ~6 threads, all minor
- Threads: markdownlint fixes in `docs/audits/00-repo-map.md` and the session log (fence language, escaped pipes, missing table cell, blank line), plus one legit hardening ask: `persist-credentials: false` on the new Build job's checkout in `ci.yml`.
- Action: apply all six (each is a 1–3 line change), resolve, merge.
- **Untracked follow-up this PR creates**: the new `Build` job is *not yet a required check* — needs one green run on master post-merge, then a branch-protection/ruleset update. Fold into #278 (which already proposes promoting checks) so it isn't lost.

**Merge order:** #273 → #315 → #272 (order between 315/272 is free; no overlapping files).

---

## 2. Close as already done (verified in code)

| Issue | Evidence |
|---|---|
| **#75** Inject github_graphql tool | Fully implemented: `packages/agents/src/tools/github-graphql.ts` (331 L, exact spec'd error codes `multi_op_rejected`/`auth_missing`), registered in `tools/registry.ts`, 445-line test file. |
| **#249** Secret Scan hardening | All 3 items live in `.github/workflows/secret-scan.yml`: `persist-credentials: false`, pinned `GITLEAKS_VERSION: 8.30.1`, `GITLEAKS_SHA256` verified via `sha256sum --check --strict`. |
| **#314** Legacy Opus slug | Near-stale. The dashed slugs are an **intentional** legacy-alias layer (`OPENROUTER_MODEL_ALIASES` in `packages/shared/src/reasoning-effort.ts:43-47` normalizes them to canonical; label map keeps legacy keys for stored settings). Only remnant: placeholder text `e.g. claude-opus-4-8` at `apps/desktop/src/renderer/features/automations/executor-model-options.ts:38` — and even that is a valid human shorthand normalized at the input boundary. Close with a one-line comment, or fix the placeholder to the dotted form in any passing PR. |

## 3. Update the issue body before implementing (stale claims)

| Issue | What's stale |
|---|---|
| **#194** Issue-scoped agent chat (epic) | Checklist badly understates progress. #195 checked, but #196 (Chat tab UI → `IssueChatTab.tsx`, mounted in `IssueDetailTabs.tsx`), #197 (GH comment sync → `issue-chat-comment-sync.ts` + test), and most of #199 (resume → `--resume`/`resume <sessionId>` wiring in `issue-chat-session.ts`) are already in tree. Re-audit checkboxes, close done sub-issues, re-scope the epic to what genuinely remains. |
| **#211** Chat resume authority | Largely implemented: `issue-chat-session.ts` already persists provider/sessionId/model/reasoningEffort/worktreePath and builds resume args. Re-scope to "verify + document the authority model + gate comment-sync dispatch", not net-new design. |
| **#91** Dual-plan workflow | "Blocked on #90" is stale — #90's conversation-log infra exists (`ConversationsTab.tsx`, `agent-conversations` queries). Issue is actually unblocked. Minor line-number drift in anchors; the core dependency (`activeProcessId` still single-valued) is real. |
| **#93** Cursor SDK evaluation | Partially superseded: a `cursor-cli` executor already exists and is registered (`packages/agents/src/providers/cursor-cli-provider.ts`, `case 'cursor'` in registry, `CURSOR_API_KEY` env allowlist + health check). Re-scope to the SDK-specific delta (indexing/MCP/subagents) or close. |
| **#159** Defer Apple signing | Revisit trigger ("first production release, v0.1.0") already passed — repo is at 0.1.3 and still ad-hoc-signed. Decision still operative in practice. **Consolidate into #277** (release-audit follow-up already owns signing/notarization/auto-update/Windows/version-bump). Close #159 as duplicate-of-#277. |

## 4. Split / consolidate

- **#250 (12-item grab-bag from PR #226) — split it.** Verified status: item 4 done (retry routing aligned); items 5–9, 12 confirmed **not done**; item 10 partial; items 1–3, 11 unverified. Three of these are real bugs, not style: 
  - v27 migration **overwrites `raw_output`** instead of preserving it (`packages/db/src/migrations/v21-v40.ts`, `SET raw_output = ? || structured || ?`);
  - `worktreeHasChanges` returns `true` on any git probe failure (`catch { return true; }` in `execution-phase-utils.ts`);
  - sidebar resize listeners/body classes leak on mid-drag unmount (`ProjectSidebar.tsx`).
  Recommended split: (a) bug-fix issue for the three above, (b) IPC error-clamping sweep (items 1–3, matches the `ipc-errors.md` house rule), (c) type-narrowing + plumbing leftovers (items 9, 10, 12), (d) verify item 11 separately. Then close #250.
- **#251 — keep, both items confirmed still broken**: stale `<phase>-output.md` reused across retries (no per-attempt path, no unlink), and `forceInteractiveClaude` ignored by `packages/pipeline/src/pipeline/runtime.ts` (`effectiveRunMode` only checks `isPoolExhausted()`; setting only honored in instant handlers). Small, well-scoped — good early Opus task.
- **#124 + #125 (Codex app-server / goals)** — strictly sequential spikes (#125 needs #124's client). Merge into one two-phase spike issue, or leave #125 explicitly blocked-by #124.
- **#242 vs #246** — #246 (defer-cloud epic) lists #242 as a sub-issue, but #242's P0/P1 (local automation polish) is explicitly *not* deferred by #246's own "still allowed" section. Add a clarifying comment on #242: P2+ deferred under #246; P1 available for scheduling.
- **Deferred cluster is coherent** — #60/#70/#76/#144 under #246 all verified unimplemented, consistent, no action needed until revisit criteria hit.

## 5. Implementation queue for Opus 4.8

### Phase 0 — unblock (this week)
1. Merge #273, then #315, #272 (Section 1).
2. Post the stale-issue updates from Sections 2–4 (closures + body edits). ~15 min of `gh issue` commands.

### Phase 1 — DRY Wave 1 (#280–#294, 15 issues; all Small, Low risk)
Well-specced with file:line anchors; claims spot-verified (e.g. `_resolvePhaseModels` dup at `apps/desktop/src/main/pipeline-scheduler.ts:348`; neither PipelineEvent switch handles `pipeline:turn-started`/`turn-completed` — `apps/cli/src/adapters/cli-emitter.ts` has no default case at all; kanban dead helpers live in `packages/ui/src/kanban-board/utils.ts`).

Ordering constraints inside Wave 1:
- **#280 first** (migration MIGRATIONS array — highest ROI, other db work rebases on it), then #281 (same package).
- **#282 before #303** (Wave-2; same kanban utils file).
- **#286 and #285 before #297** (Wave-2 pipeline bootstrap; land small extractions first).
- Everything else in Wave 1 is order-independent; parallelize freely.
- Bug-flagged: #290 (event drops) and #294 (truncation overshoot) — prioritize within the wave.

### Phase 2 — DRY Wave 2 (#295–#305, 11 issues; Medium)
- #295 (gh-cli clone, ~112 L) and #305 (spawn/settle gaps) need **new tests written first** — no existing coverage.
- #298 includes deleting the `_resolvePhaseModels` copy — verified still present.
- #303 blocked-by #282; #297 blocked-by #285/#286.

### Phase 3 — DRY Wave 3 (#306–#313) — **4 of 8 need Vincent's decision first**

| Issue | Decision owed |
|---|---|
| #306 | Desired user-visible copy for `model_deprecated` in desktop UI (bug fix itself is unambiguous). |
| #309 | Which `getDefaultBranch` fallback order is canonical (`git-service.ts:102` vs `worktree.ts:325` disagree). |
| #311 | Does CLI retry parity matter at all? (Gated; also blocked-by #307.) |
| #312 | CLI model-routing parity vs. documented divergence. |

No-decision-needed Wave-3 items #307, #308, #310, #313 can proceed anytime after their noted test-first caveats.

### Phase 4 — follow-up bundles
- #251 (both fixes), the #250 split issues (bugs first), then #274–#279 investigation follow-ups. #276 (pipeline reliability traces) and #274 (secrets → `safeStorage`) are the highest-value of the six.

### Feature backlog (post-cleanup; all specs verified current)
Ready and unblocked: #91 (dual-plan; now unblocked), #81 (PR review status labels), #83 (sub-issues/blockers), #84 (staleness flags), #85 (kanban keyboard nav), #82 (analytics), #66 (lifecycle hooks; depends on #65), #18 (conversational PRD; needs new `agent:input` IPC), #212 (checkpoint refs — the real remaining item of the chat cluster). #79 → #88 (Linear then Jira) remain deferred-shaped; #79 is the prerequisite abstraction.

---

## 6. Systemic observations

1. **Review-thread resolution is the silent merge blocker.** Two of three PRs sat green-but-blocked on minor bot threads. Consider making thread-resolution part of the PR-author loop (resolve-or-reply before requesting merge), or relax the ruleset for bot-only threads.
2. **Follow-up issues rot fast.** #249 was fully fixed in code but stayed open; #194/#211's checklists lag reality by weeks. A periodic "close-the-loop" sweep (grep-verify open follow-up issues against master) would keep the backlog honest — cheap to automate as a ShipCode automation.
3. **The wave issues are a model backlog.** Effort/risk/dependency/anchor discipline made this triage nearly mechanical. The older feature PRDs (#79, #88, #91) hold the same bar; the weak spots are multi-item grab-bags (#250) — avoid bundling unrelated findings into one issue.
4. **Real bugs currently open, ranked:** #306 (user-visible status collapse), #250-item-6 (migration data overwrite), #250-item-8 (git failure ⇒ "has changes"), #290 (dropped pipeline events), #251-item-2 (`forceInteractiveClaude` ignored), #294 (truncation overshoot), #250-item-5 (listener leak).
