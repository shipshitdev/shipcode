# @shipshitdev/shipcode

Headless CLI for ShipCode — an autonomous AI coding pipeline that takes GitHub issues in and ships pull requests out.

This package is the **terminal / CI / server** entry point. If you want the desktop GUI instead, install [the ShipCode desktop app](https://shipcode.shipshit.dev/docs/getting-started) via `brew tap shipshitdev/tap && brew install --cask shipcode` — the two share the same pipeline engine but are otherwise separate products. You don't need both.

## Install

```bash
# Run once without installing
npx @shipshitdev/shipcode onboard

# Or install globally so the `shipcode` command is always on your PATH
npm install -g @shipshitdev/shipcode
shipcode onboard
```

The package is published to npm as `@shipshitdev/shipcode`. The bin name stays `shipcode`, so `npx @shipshitdev/shipcode`, `npm install -g @shipshitdev/shipcode`, then `shipcode ...`.

## Prerequisites

- **Node.js ≥ 22.5.0** — required for the built-in `node:sqlite` module
- **git**, **gh**, **claude**, **codex** CLIs — all four must be installed and on `PATH`
- **gh** authenticated (`gh auth login`)
- **claude** authenticated
- **OpenRouter API key** (optional) — set `OPENROUTER_API_KEY` to enable the `openrouter` executor

The `shipcode onboard` command runs a doctor pass against all of these and fails fast if anything is missing.

## Commands

| Command | Description |
|---------|-------------|
| `shipcode onboard` | Doctor check + initialize ShipCode in the current repo (verifies tools, gh/claude auth, GitHub labels, writes project row) |
| `shipcode skills seed [bundle]` | Seed curated ShipCode-compatible repo skills into `./skills` (`dev-loop` by default; skips existing files unless `--force`) |
| `shipcode status` | Show active pipelines and recent threads |
| `shipcode run <issue>` | Process a single GitHub issue end-to-end through the plan → review → execute → verify → ship pipeline |
| `shipcode start` | Interactive mode — prompt for an issue number |
| `shipcode plan <issue>` | Generate and review a plan, stopping at the approval gate |
| `shipcode approve <issue>` | Approve a plan awaiting approval and start execution |
| `shipcode review <issue>` | Run plan + adversarial review and print the findings as JSON |
| `shipcode retry <issue>` | Resume a pipeline from its last checkpoint |
| `shipcode logs <issue>` | Show recorded terminal events for an issue's pipeline |
| `shipcode terminal <issue>` | Open an official Claude/Codex interactive CLI inside the issue's worktree (`--provider`, `--model`) |
| `shipcode terminal-summary <issue>` | Show the latest interactive terminal session summary for an issue |
| `shipcode terminal-comment <issue>` | Preview (or `--post`) a GitHub comment built from the latest terminal summary |
| `shipcode prd <keywords...>` | Generate or enhance a PRD from keywords, using `skills/writing-prds` when present |

Pass `--help` to any subcommand for its flags.

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENROUTER_API_KEY` | Optional | Enables the `openrouter` executor + `shipcode:agent:openrouter`, `shipcode:agent:openrouter/auto`, `shipcode:agent:openrouter/free` GitHub label routes |

Claude and Codex auth come from their own CLIs (`claude auth`, `codex login`); `gh` auth comes from `gh auth login`. The CLI does not read any other env vars directly.

## Local development

From the monorepo root:

```bash
bun install                                             # install all workspace deps
bun run --filter shipcode build                         # build apps/cli -> apps/cli/dist
node apps/cli/dist/index.js onboard                     # run the built CLI in any repo
```

Watch mode (rebuild on change):

```bash
bun run --filter shipcode dev
```

## Providers

The CLI supports the same execution providers as the desktop app:

- `claude` — Claude Code CLI
- `codex` — OpenAI Codex CLI
- `openrouter` — OpenRouter provider (any model, routed through their API)

Executor selection happens per-issue via GitHub labels (`shipcode:agent:claude`, `shipcode:agent:codex`, `shipcode:agent:openrouter`, `shipcode:agent:openrouter/auto`, `shipcode:agent:openrouter/free`). Unknown or missing labels fall back to `shipcode:agent:claude`.

## Architecture

The CLI is a thin wrapper over the shared workspace packages:

- `@shipcode/shared` — types, constants, `PipelinePhase`, `AgentType`
- `@shipcode/agents` — provider registry (`createClaudeCliProvider`, `createCodexCliProvider`, `createOpenRouterProvider`), health checks
- `@shipcode/db` — SQLite persistence via `node:sqlite`
- `@shipcode/git` — git service + worktree manager
- `@shipcode/pipeline` — state machine (plan → review → execute → verify → ship)

See the [architecture docs](https://shipcode.shipshit.dev/docs/architecture) for the full package layout.

## CLI vs Desktop — which do I need?

| If you want... | Use |
|---|---|
| A GUI to watch pipelines, triage issues, edit settings, view costs | Desktop app (`brew tap shipshitdev/tap && brew install --cask shipcode`) |
| To run the pipeline from a terminal, script, cron job, or CI job | This CLI (`npm i -g @shipshitdev/shipcode`) |
| Both | Install both — they share the same SQLite DB and worktree layout |

## See also

- [Full CLI docs](https://shipcode.shipshit.dev/docs/cli) — long-form reference
- [Getting started](https://shipcode.shipshit.dev/docs/getting-started) — install + first pipeline run
- [Configuration](https://shipcode.shipshit.dev/docs/configuration) — GitHub label conventions and status-label mapping
