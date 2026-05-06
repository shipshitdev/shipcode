---
name: project_custom_agents
description: Custom Claude Code sub-agents in .claude/agents/ — routing rules and when to use each
type: project
status: active
last_verified: 2026-05-07
topics: [agents, workflow, delegation]
---

Nine custom sub-agents live in `.claude/agents/`. Use `subagent_type` matching the agent filename (without `.md`).

## Agent roster

| Agent | Model | Mode | When to use |
|-------|-------|------|-------------|
| `planner` | opus | read-only | Architecture decisions, feature scoping, multi-file refactor plans, complex design tradeoffs |
| `explorer` | haiku | read-only | Quick codebase research, grep, pattern finding, "where is X" / "how does X work" |
| `implementer` | sonnet | full | General implementation spanning multiple packages or not fitting a specialist |
| `pipeline-dev` | sonnet | full | Changes to `packages/pipeline`, `packages/agents`, `packages/git`, `packages/db` |
| `ui-dev` | sonnet | full | Changes to `apps/desktop/src/renderer/` or `packages/ui/` |
| `web-dev` | sonnet | full | Changes to `apps/web/` or `apps/docs/` |
| `reviewer` | sonnet | read-only | Code review — runs tests/lint/typecheck, reports findings, never edits |
| `test-writer` | sonnet | write tests only | Writes Vitest tests — never modifies source files |
| `debugger` | sonnet | full | Root-cause investigation — systematic diagnosis, then minimal fix |

## Routing rules

- **Start with `planner`** for any non-trivial feature or refactor. It produces a sequenced plan with parallel tracks.
- **Use `explorer`** for all "find/read/understand" tasks. Cheapest agent — haiku model, read-only.
- **Pick the specialist** (`pipeline-dev`, `ui-dev`, `web-dev`) when the work is contained to one domain.
- **Fall back to `implementer`** when work crosses domain boundaries or doesn't fit a specialist.
- **Pair `test-writer` with any implementer** for parallel test writing during implementation.
- **Use `reviewer`** after implementation, before committing. Or for reviewing external PRs.
- **Use `debugger`** when something's broken and the cause isn't obvious.

## Parallel patterns

Common effective pairings:
- `planner` first → then `ui-dev` + `pipeline-dev` in parallel (frontend + backend simultaneously)
- `implementer` + `test-writer` in parallel (code + tests simultaneously)
- `explorer` + `explorer` in parallel (researching two unrelated questions)
- `debugger` → `test-writer` sequentially (fix then regression test)

## Each agent knows

- ShipCode monorepo layout and package boundaries
- Hard rules (stdin-not-argv, path-as-truth worktrees, IPC clamping, verification retry routing)
- Codebase conventions (Tailwind v4, strict TS, Bun, `packages/ui` first)
- Post-work verification steps (test, typecheck, biome)
