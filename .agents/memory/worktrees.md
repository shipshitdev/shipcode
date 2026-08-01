---
name: project_worktrees
description: Worktree defaults (~/.shipcode/worktrees/<slug>/<threadId>, AppSettings.worktreeRoot) + path-as-truth rule — WorktreeManager.remove(path, branch) takes concrete values, never recompute from threadId
type: project
status: active
last_verified: 2026-07-02
topics: [worktrees, git, cleanup, settings, api-design]
---

Every pipeline run happens in its own git worktree to isolate AI-generated changes from the user's current branch.

**Default location:** `~/.shipcode/worktrees/<projectSlug>/<threadId>`
- `projectSlug` = `<basename>-<sha256[:6]>`, deterministic, collision-safe.
- Global-by-default because project-local worktrees bleed into iCloud/Dropbox-synced project dirs.

**Setting:** `AppSettings.worktreeRoot` — **two states, not three**
- `null` → default (`~/.shipcode/worktrees`)
- absolute path or `~`-prefix → custom root
- relative paths and `~user/…` are **rejected at `settings:set` time**, not at worktree creation

**Project-local mode is retired** (was `''` → `<project>/.shipcode/worktrees`). It was
unreachable in practice: `SettingsStore.set()` serializes `null` to `''` for *every* key, so
`''` at rest is the storage encoding of "unset" and was never distinguishable from the default;
no UI ever offered the choice (the Settings input maps a blank field to `null`). `expandWorktreeRoot('')`
now returns the default root rather than throwing, so any `''` surviving in an old database or an
options bag degrades to the default instead of breaking worktree creation. Existing on-disk
project-local worktrees keep validating because `assertWorkspaceSafe` authorizes a concrete
workspace by its Git linked-worktree registration, never by re-deriving the parent from settings.

**Grep-stable anchors:** `projectSlug` and `resolveWorktreeParent` in `packages/shared/src/worktree-path.ts`; `expandWorktreeRoot` is the validator. Don't hardcode `.shipcode/worktrees` anywhere — always go through `resolveWorktreeParent`.

## Path-as-truth rule (hard rule)

`WorktreeManager.remove(path, branch)` accepts concrete values. **Never recompute the worktree path from `threadId`** at cleanup time.

**Why:** the path derives from `worktreeRoot` + `projectSlug` + `threadId`. If the user changes `worktreeRoot` in Settings mid-session, a `remove(threadId)` API would recompute with the **new** setting — deleting the wrong directory or silently orphaning the real worktree. So the path is persisted at creation (`Thread.worktreePath`) and cleanup reads the persisted value.

**How to apply:**
- Pass `thread.worktreePath` from the DB directly to `remove()` — never re-derive via `resolveWorktreeParent`.
- Enumerate worktrees with `WorktreeManager.list()` (parses `git worktree list --porcelain`, filters by `shipcode/*` branch prefix) — don't glob the filesystem or substring-match the current `worktreeRoot`.
- New worktree operations follow the same pattern: concrete values in the API, derive-once at creation, persist.
- When deleting a project: iterate its threads via DB query, `remove(thread.worktreePath, thread.worktreeBranch)` for each, **then** delete the project row.
