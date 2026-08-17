---
name: project_worktrees
description: Worktree defaults (~/.shipcode/worktrees/<slug>/<threadId>, AppSettings.worktreeRoot), shipcode/ branch naming + isShipCodeBranch recognition, and the path-as-truth rule — WorktreeManager.remove(path, branch) takes concrete values, never recompute from threadId
type: project
status: active
last_verified: 2026-08-16
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

## Branch naming

Every branch ShipCode creates lives under one prefix — `shipcode/`.

- **Issue worktrees:** `shipcode/{id}-{slug}`, from the user-overridable `AppSettings.worktreeBranchFormat` (Settings → General → Branch format). `DEFAULT_BRANCH_FORMAT` in `packages/shared/src/branch-name.ts` is the default; `packages/db/src/queries/settings.ts` validates custom templates (`{id}` required, must produce a legal git ref).
- **Non-issue worktrees** (Quick Task, automations, fan-out workers, chat threads): `shipcode/{slug}`, falling back to `shipcode/{threadId}` when there's no title. Built in `WorktreeManager.getBranchName`, not from the setting.
- **Legacy `ship/{id}-{slug}`** was the issue default before the unification (#532). Nothing creates it any more, but existing repos still carry those branches.

**Recognition has one source of truth:** `isShipCodeBranch(name)` in `packages/shared/src/branch-name.ts`, which matches `SHIPCODE_BRANCH_PREFIX` *and* legacy `ship/\d+`. Never re-inline the regex — it used to be duplicated in `branches.ts`, `worktree.ts`, and `cleanup-analyzer.ts` and drifted. Callers: `WorktreeManager.list()`, the cleanup analyzer's managed-branch check, and the base-branch selector filter in `normalizeBranches`. The `\d+` guard is what keeps user branches like `ship/my-feature` out of ShipCode-managed listings.

## Path-as-truth rule (hard rule)

`WorktreeManager.remove(path, branch)` accepts concrete values. **Never recompute the worktree path from `threadId`** at cleanup time.

**Why:** the path derives from `worktreeRoot` + `projectSlug` + `threadId`. If the user changes `worktreeRoot` in Settings mid-session, a `remove(threadId)` API would recompute with the **new** setting — deleting the wrong directory or silently orphaning the real worktree. So the path is persisted at creation (`Thread.worktreePath`) and cleanup reads the persisted value.

**How to apply:**
- Pass `thread.worktreePath` from the DB directly to `remove()` — never re-derive via `resolveWorktreeParent`.
- Enumerate worktrees with `WorktreeManager.list()` (parses `git worktree list --porcelain`, filters with `isShipCodeBranch`) — don't glob the filesystem or substring-match the current `worktreeRoot`.
- New worktree operations follow the same pattern: concrete values in the API, derive-once at creation, persist.
- When deleting a project: iterate its threads via DB query, `remove(thread.worktreePath, thread.worktreeBranch)` for each, **then** delete the project row.

## Never `git stash` from a worktree (dev workflow, hard rule)

`refs/stash` is a **single repo-global ref shared by every worktree**, not per-worktree state. A `git stash push` in `.claude/worktrees/<name>` lands on the same stack the main checkout and every other worktree use, and a later `git stash pop` there takes whatever is on top — which may be another session's work, applied into the wrong tree while yours stays buried.

**Instead:** `git diff > /tmp/x.patch` to snapshot, or read a clean tree with `git show <ref>:<path>`.

**Recovery if it already happened:** stash commits survive as dangling objects. `git fsck --unreachable | grep commit`, match on `git log -1 --format=%s <sha>`, then `git restore --source=<sha> -- <paths>` for tracked files and `--source=<sha>^3` for the untracked ones the stash carried.
