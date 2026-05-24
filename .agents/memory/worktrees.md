---
name: feedback_path_as_truth_worktrees
description: WorktreeManager.remove(path, branch) takes concrete values — never recompute from threadId
type: feedback
status: active
last_verified: 2026-04-10
topics: [worktrees, git, cleanup, api-design]
---

**Rule:** `WorktreeManager.remove(path, branch)` accepts concrete values. **Never recompute the worktree path from `threadId`** at cleanup time.

**Why:** The worktree path is derived from `worktreeRoot` + `projectSlug` + `threadId`. If the user toggles `worktreeRoot` in Settings mid-session (e.g. changes from default to a custom location), and then a pipeline finishes and tries to clean up, a `remove(threadId)` API would recompute the path using the **new** setting and delete the wrong directory — or more commonly, silently fail to find the actual worktree, leaving it orphaned on disk.

The fix is **path-as-truth**: when a worktree is created, its path is persisted (to `Thread.worktreePath`). Cleanup reads the persisted path and passes it directly to `remove`, so the cleanup is insulated from any mid-flight setting changes.

Same logic applies to `list()` — it parses `git worktree list --porcelain` and filters by `shipcode/*` branch prefix, not by substring match on the current `worktreeRoot` path.

**How to apply:**
- When calling `WorktreeManager.remove()`, always pass `thread.worktreePath` directly from the DB — do not re-derive it from `resolveWorktreeParent(projectPath, settings.worktreeRoot)`.
- Anywhere that needs to enumerate worktrees, use `WorktreeManager.list()` — don't glob the filesystem.
- When adding any new worktree operation, follow the same pattern: concrete values in the API, derive-once at creation, persist.
- When deleting a project, iterate its threads via DB query, call `remove(thread.worktreePath, thread.branch)` for each, **then** delete the project row.
