# Worktree path safety

ShipCode treats a persisted worktree path and branch as one authorization record. Existing
worktrees are accepted only when Git registers that exact path and branch under the expected
project repository. The current `worktreeRoot` setting is used only to choose a new worktree
location; it is never used to reconstruct an existing path.

## Persisted source of truth

`Thread.worktreePath` and `Thread.worktreeBranch` are written when the worktree is created. Every
later execution, terminal, QA, artifact, move, repair, and cleanup flow reads those concrete values
from the thread record. A settings change therefore cannot redirect an existing thread to another
directory.

## Entry points and guards

| Entry point | Path source | Required guard |
| --- | --- | --- |
| `WorktreeManager.create` | Newly derived parent and name | Canonical direct child, safe Git ref, absent target, non-symlink parent before Git mutation |
| Pipeline execute and runtime commands | Persisted thread path and branch | Exact Git worktree registration for the project before provider or shell spawn |
| CLI and desktop issue terminals | Persisted thread path and branch | Exact registration before prompt-file writes and process spawn |
| Issue chat and instant failure-fix sessions | Persisted thread path and branch | Exact registration before prompt persistence and process spawn |
| Feature QA server | Persisted thread path and branch | Exact registration before server spawn |
| OpenRouter and CLI providers | Pipeline request path and project | Canonical real path, matching Git common directory, exact linked-worktree registration |
| Artifact listing and pruning | Persisted thread path and branch | Exact registration plus real-path containment for every artifact |
| Worktree move and repair | Persisted path and branch | Exact source registration; move destination is a safe direct child of the configured creation root |
| Worktree removal | Persisted path and branch | Exact registration before worktree removal or branch deletion |

The guards fail closed on traversal and non-canonical segments, symlink aliases or escaped artifact
paths, foreign repositories, detached worktrees, and branch/path mismatches. Cleanup intentionally
accepts an exact stale Git registration for a missing directory so Git metadata and its matching
branch can still be removed safely.
