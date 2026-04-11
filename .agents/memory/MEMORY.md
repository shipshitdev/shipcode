# Repo memory brief — shipcode

Loaded after `~/.agents/memory/MEMORY.md` (global). Project-scoped facts only. For detail, see the individual files in this directory.

## Shape

- **ShipCode** is an Electron desktop app orchestrating AI-driven dev pipelines on GitHub issues.
- **Monorepo:** Turborepo + Bun workspaces.
- **Apps:** `apps/desktop` (Electron), `apps/docs` (Nextra 4, static), `apps/web` (Vercel `shipcode-web`).
- **Packages:** `agents`, `pipeline`, `git`, `db`, `shared`, `ui`.
- **Pre-release** — no backward-compat concerns when refactoring defaults.
- See: `project_shipcode_overview.md`.

## Pipeline

- **Phases:** plan → review → execute → verify. Each runs in an isolated git worktree.
- **Executor models:** `claude | codex | openrouter`. State machine lives in `packages/pipeline/src/pipeline.ts`.
- **Planner input:** GitHub issue body = PRD = plan prompt (all the same text). Grep `GitHub Issue #` in `pipeline.ts` for the template.
- See: `project_pipeline_flow.md`.

## Worktrees

- **Default:** `~/.shipcode/worktrees/<projectSlug>/<threadId>` where `projectSlug = <basename>-<sha256[:6]>`.
- **`AppSettings.worktreeRoot`:** `null`=default, `''`=legacy project-local, absolute/tilde=custom. Validation at `settings:set`.
- **Grep-stable anchors:** `projectSlug`, `resolveWorktreeParent` in `packages/shared/src/worktree-path.ts`.
- See: `project_worktree_defaults.md`.

## Current state (2026-04-11)

- **OpenRouter Tier 1/2/3 all shipped** in PR #9 (merged 2026-04-10). Provider abstraction, HTTP backend for plan/review/verify, in-process tool-call EXECUTE harness, and `openrouter/auto` meta-router with per-phase telemetry all live. Tracked under closed epic shipshitdev/shipcode#8 with sub-issues #20/#21/#22. PR #17 (2026-04-11) is a separate test-fix PR — do NOT conflate them.
- **Pipeline phases can all route through OpenRouter.** Claude and codex CLIs still work unchanged. `AgentType = 'claude' | 'codex' | 'gh' | 'openrouter'`.

## Hard rules (from past incidents)

- **Pipe `claude -p` prompts via stdin, never argv.** Argparser breaks on `---` YAML. Reuse `runClaudeWithStdin` in `packages/agents/src/prd-generator.ts` or `spawnWithStdin` in `packages/agents/src/github/gh-cli.ts`. See: `feedback_claude_cli_prompts_via_stdin.md`.
- **`WorktreeManager.remove(path, branch)` takes concrete values** — never recompute from `threadId`. Mid-session setting toggles would orphan worktrees. See: `feedback_path_as_truth_worktrees.md`.
- **Clamp IPC error messages** to first-line + ~280 chars; log full trace to main-process console. (Batch 2 — extract from session 2026-04-10 when promoting.)

## References

- **Session logs:** `.agents/SESSIONS/YYYY-MM-DD.md` (committed)
- **PRD style guide:** `.agents/skills/writing-prds/SKILL.md` (read by `ai:enhance-prd` handler from the target repo, not the ShipCode install)
- **Plans:** `~/.claude-genfeedai/plans/<slug>.md`

## Further reading

- `project_shipcode_overview.md`, `project_pipeline_flow.md`, `project_worktree_defaults.md`
- `feedback_claude_cli_prompts_via_stdin.md`, `feedback_path_as_truth_worktrees.md`
- `BATCH_2_CANDIDATES.md` — extraction backlog
