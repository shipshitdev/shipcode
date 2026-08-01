# Repo memory brief — shipcode

Loaded after `~/.agents/memory/MEMORY.md` (global). Project-scoped facts only. Detail in the files listed under **Further reading**.

## Shape

- **ShipCode** is an Electron desktop app orchestrating AI-driven dev pipelines on GitHub issues.
- **Monorepo:** Turborepo + Bun workspaces.
- **Apps:** `apps/cli` (published `@shipshitdev/shipcode` CLI), `apps/desktop` (Electron), `apps/docs` (Nextra 4, static), `apps/web` (Vercel `shipcode-web`).
- **Packages:** `agents`, `pipeline`, `git`, `db`, `shared`, `ui`.
- **Pre-release** — no backward-compat concerns when refactoring defaults.
- See: `overview.md`.

## Pipeline

- **Phases:** plan → review → execute → verify. Each runs in an isolated git worktree.
- **Executor models:** `claude | codex | openrouter`. State machine lives in `packages/pipeline/src/pipeline.ts`.
- **Planner input:** GitHub issue body = PRD = plan prompt (all the same text). Grep `GitHub Issue #` in `pipeline.ts` for the template.
- **Interactive CLI mode:** terminal-like Claude/Codex actions stream raw PTY output as ShipCode terminal events and complete on process exit. Claude `stream-json` is only available through `claude -p`, which is the billing-sensitive programmatic path. See: `interactive-cli-run-modes.md`.
- See: `pipeline.md`.

## Worktrees

- **Default:** `~/.shipcode/worktrees/<projectSlug>/<threadId>` where `projectSlug = <basename>-<sha256[:6]>`.
- **`AppSettings.worktreeRoot`:** `null`=default, `''`=legacy project-local, absolute/tilde=custom. Validation at `settings:set`.
- **Grep-stable anchors:** `projectSlug`, `resolveWorktreeParent` in `packages/shared/src/worktree-path.ts`.
- See: `worktrees.md`.

## Skills and memory layout

- **`skills/`** — ShipCode app skills (pipeline prompts, `writing-prds`, `github-label-sync`). Read by the app at runtime.
- **`.agents/skills/`** — dev workflow skills for building ShipCode (React, TS, Tailwind, etc.). Discovered by Claude Code via `.claude/skills → ../.agents/skills`.
- **`.claude/skills`, `.claude/memory`, `.codex/skills`, `.codex/memory`** — relative within-repo symlinks only. Never point outside the repo.
- See: `skills.md`.

## `.agents/` structure — never create new dirs

Allowed: `memory/`, `SESSIONS/`, `skills/`, `SYSTEM/`. Nothing else.

Where things live:
- **What to build** → GitHub issues
- **Why it was built a certain way** → `.agents/memory/` (short flat filenames)
- **Inline SPECS / TODOS / DECISIONS dirs** → never

## Current state

- **Trunk-based since 2026-06-16 (PR #235).** Single `master` trunk — `develop`/`staging`
  deleted. PRs → master, squash-merge after 7 required checks (`Trust Check`, `Lint`,
  `Design System`, `Typecheck`, `Test`, `Secret Scan`, `React Doctor`); strict, linear
  history, no force-push. CI backbone (trust gate, turbo `--affected`, `setup-bun-env`
  composite, CodeQL advisory) matches genfeed.ai / vitae.ai. See: `e2e-ci.md`.
- **OpenRouter Tier 1/2/3 all shipped** (2026-04-11) in PR #9 (merged 2026-04-10). Provider abstraction, HTTP backend for plan/review/verify, in-process tool-call EXECUTE harness, and `openrouter/auto` meta-router with per-phase telemetry all live. Tracked under closed epic shipshitdev/shipcode#8 with sub-issues #20/#21/#22.
- **Pipeline phases can all route through OpenRouter.** Claude and codex CLIs still work unchanged. `AgentType = 'claude' | 'codex' | 'gh' | 'openrouter'`.

## Hard rules (from past incidents)

- **Pipe `claude -p` prompts via stdin, never argv.** Argparser breaks on `---` YAML. Reuse `runClaudeWithStdin` in `packages/agents/src/prd-generator.ts`. See: `claude-cli.md`.
- **Do not use `claude -p` for interactive terminal mode.** Interactive mode launches the real terminal CLI, wraps raw output in our own terminal events, and uses process exit as completion. See: `interactive-cli-run-modes.md`.
- **`WorktreeManager.remove(path, branch)` takes concrete values** — never recompute from `threadId`. See: `worktrees.md`.
- **Never call `webContents.send` directly in the main process.** Every send goes through `safeSend` in `apps/desktop/src/main/safe-send.ts` — a raw send throws on a destroyed window and that throw escapes the IPC handler, reporting an already-successful write as a failure. See: `ipc-errors.md`.
- **Clamp IPC errors** to first-line + ~280 chars; log full trace to main-process console only. See: `ipc-errors.md`.

## References

- **Session logs:** `.agents/SESSIONS/YYYY-MM-DD.md` (committed)
- **PRD style guide:** `skills/writing-prds/SKILL.md` (read by `ai:enhance-prd` handler from the target repo)

## Sub-agents

- Nine custom agents in `.claude/agents/` — use `subagent_type` to spawn.
- **Routing:** `planner` (opus) for design, `explorer` (haiku) for research, specialists (`pipeline-dev`, `ui-dev`, `web-dev`) for domain work, `implementer` for cross-cutting, `test-writer` parallel with any implementer, `reviewer` post-implementation, `debugger` for root-cause investigation.
- See: `agents.md`.

## Further reading

- `overview.md` — app shape, packages, tech stack
- `pipeline.md` — phase flow, state machine, provider routing
- `worktrees.md` — default paths, settings, path-as-truth rule, cleanup pattern
- `claude-cli.md` — stdin-not-argv rule for claude CLI
- `interactive-cli-run-modes.md` — interactive-vs-programmatic terminal routing and event model
- `ipc-errors.md` — clamp IPC errors at main-process boundary
- `skills.md` — skills/memory folder layout, symlink rules
- `agents.md` — custom sub-agent roster, routing rules, parallel patterns
- `e2e-ci.md` — trunk-based CI+E2E backbone: single master trunk, trust gate, affected scoping, weekly crons, build ordering
