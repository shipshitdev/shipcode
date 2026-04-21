---
name: project_worktree_defaults
description: Default worktree root is ~/.shipcode/worktrees/<slug>/<threadId>; path-as-truth API
type: project
status: active
last_verified: 2026-04-10
topics: [worktrees, git, settings]
---

Every pipeline run happens in its own git worktree to isolate AI-generated changes from the user's current branch.

**Default location:** `~/.shipcode/worktrees/<projectSlug>/<threadId>`
- `projectSlug` = `<basename>-<sha256[:6]>`, deterministic, collision-safe.

**Setting:** `AppSettings.worktreeRoot`
- `null` → default (`~/.shipcode/worktrees`)
- `''` (empty string) → legacy project-local (`<project>/.shipcode/worktrees`)
- absolute path or `~`-prefix → custom root
- relative paths and `~user/…` are **rejected at `settings:set` time**, not at worktree creation

**Grep-stable anchors:** `projectSlug` and `resolveWorktreeParent` in `packages/shared/src/worktree-path.ts`. `expandWorktreeRoot` is the validator.

**Why global-by-default:** project-local worktrees bleed into iCloud/Dropbox-synced project dirs. The global default keeps project trees clean and gives one central inspection dir.

**Cleanup:** `WorktreeManager.remove(path, branch)` takes concrete values — **never recompute path from threadId**. See `.agents/memory/worktrees.md` for the full incident that drove this design.

**How to apply:**
- When passing worktree paths around, use the persisted `Thread.worktreePath` as the source of truth, not a re-derivation.
- Don't hardcode `.shipcode/worktrees` anywhere; always go through `resolveWorktreeParent` with the user's current `worktreeRoot` setting.
- When deleting a project, iterate its threads and clean up each worktree before removing the project row.
