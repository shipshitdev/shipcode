---
name: project_current_branch
description: feat/openrouter-tier1 in progress — adds openrouter to PipelineExecutorModel + providers/ dir
type: project
status: temporary
last_verified: 2026-04-10
expires_after: branch-merged-or-abandoned
topics: [in-progress, openrouter, branch-state]
---

**DELETE THIS MEMORY** once `feat/openrouter-tier1` is merged into master or abandoned. This is intentionally `status: temporary`.

## Current state (as of 2026-04-10)

Branch `feat/openrouter-tier1` is mid-flight. It extends `PipelineExecutorModel` from `claude | codex` to `claude | codex | openrouter` and introduces a new `packages/agents/src/providers/` directory with a provider-pattern abstraction for the CLI subprocesses.

**Parallel work also on this branch** (from a different agent session):
- Notifications (`apps/desktop/src/main/notification-service.ts`, `NotificationToaster.tsx`, `db/queries/notifications.ts`)
- Dashboard view (`DashboardView.tsx`, `db/queries/dashboard.ts`, `db/queries/activity.ts`)

## Known LSP errors (unresolved at last check)

- `packages/pipeline/src/pipeline.ts` — `PipelineContext` missing `startedAt`, `executorModelOverride`, `abort` fields
- `packages/pipeline/src/pipeline.ts` — `Pipeline` type missing `listActive` method
- `packages/pipeline/src/pipeline.ts` — `executorModel` parameter typed as `"claude" | "codex"` but should accept full `PipelineExecutorModel` (including `"openrouter"`)
- `packages/db/src/queries/settings.ts` — `AppSettings` missing ~14 fields (`verifierModel`, `notificationsEnabled`, etc.)
- `apps/desktop/src/renderer/components/IssueDetail.tsx` — `X` not exported from `@shipcode/ui`
- Several unused-variable warnings (`useWorktree`, `canReject`)

## Git state

- 25 modified files, 8 untracked, none committed.
- Commit-splitting strategy (noted in session 2026-04-10): three logical groups (parallel-agent work, UI redesign, AI PRD enhance flow).

**How to apply:** When working on pipeline, providers, or AppSettings code, expect these errors and don't introduce new ones. When the branch lands, **delete this file** — that's the explicit stale-memory cleanup signal.
