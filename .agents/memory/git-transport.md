---
name: feedback_git_transport_async_and_locked
description: Never run sync git on the pipeline execute path — use the async transport in packages/git/src/git-exec.ts, and hold withGitLock across any stage→commit sequence
type: feedback
status: active
last_verified: 2026-08-01
topics: [git, pipeline, electron-main, performance, concurrency]
---

**Rule:** Git on the pipeline execute path goes through `packages/git/src/git-exec.ts`. No `execFileSync`, `execSync`, or `child_process` in `execution-phase-utils.ts` or the per-node helpers in `execution-phases.ts` — a source-guard test in `execution-phase-utils.test.ts` enforces it.

**Why:** These run in the Electron **main** process, once per node on the execute path and again per fan-out worker. A synchronous subprocess freezes the whole event loop for its duration — `git add -A` on a large worktree is not fast — so the UI stalls, IPC queues, and the pipeline heartbeat cannot be written. `checkpoint.ts` had documented this policy since it was written; the execute path just never followed it. Converted 2026-08-01.

**The transport:**
- `runGitUnlocked(cwd, args, env?)` — one `simple-git` `raw()` call, trimmed stdout. Use only when the call cannot contend for the real index (checkpoint capture stages into an isolated `GIT_INDEX_FILE`; restore is off the per-node path).
- `runGit(cwd, args, env?)` — the locked single-shot. Default choice for a standalone command.
- `withGitLock(cwd, run => …)` — **required** around any multi-command sequence that touches the index.
- `buildScopedGitEnv(overrides)` — drops the keys simple-git's unsafe-operations guard rejects. Only pass `.env()` when you actually have overrides; calling it unconditionally would replace the ambient environment.

**How to apply:**
- **Any stage→commit pair belongs in one `withGitLock`.** `execFileSync` gave stage/commit atomicity for free; awaiting between `add -A` and `commit` lets a second caller stage into the same index mid-sequence. The lock is what gives that back.
- **`withGitLock` is not reentrant.** Inside the callback use the supplied `run`, never the exported `runGit` and never a nested `withGitLock` on the same cwd — that self-deadlocks. When two entry points share a body, factor the body to take `run` (see `resolveDiffBaseWith` vs the public `resolveWorktreeDiffBase`).
- **The lock is keyed by `path.resolve(cwd)`**, so fan-out workers — each with its own worktree from `wm.create(\`${threadId}-fan-${i+1}\`, …)`, therefore its own index — still run fully in parallel. The lock exists because `context.worktreePath ?? context.projectPath` falls back to the *shared* project repo when a context has no worktree.
- **Error shape changed from sync throw to rejected promise.** Keep the original try/catch and move the `await` inside it; do not let a rejection escape a handler that used to catch a throw.
- **Still sync, deliberately out of scope as of 2026-08-01:** `execution-phases.ts` ~1561-1598 (verify-phase `git add -A` + commit) and all of `execution-shipping-phases.ts`. Same class of bug, once per turn rather than once per node. Convert them the same way.

**Testing gotcha:** `pipeline.test.ts` mocks `@shipcode/git` **wholesale** (no `...actual`), unlike `execution-phases.test.ts` which spreads the real module. Any new git export the execute path uses must be added to that mock by hand, or the affected tests silently receive `undefined`. Both files route the transport into their existing `execFileSync` sink so per-test git stubs keep one `(command, args) => stdout` shape.

**See also:** `.agents/memory/worktrees.md` (path-as-truth rule), `.agents/memory/pipeline.md` (phase flow).
