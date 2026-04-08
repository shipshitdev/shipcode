# ShipCode

> **Warning**
> This project is under active development and not yet ready for production use. APIs, architecture, and features may change without notice.

Autonomous AI coding pipeline. GitHub issues in, pull requests out.

Label a GitHub issue with `agent:claude` or `agent:codex`, and ShipCode handles the rest: plan, adversarial review, implement, verify, and ship a PR. No human gates until the PR is created.

## How it works

```
GitHub Issue (labeled agent:claude)
       |
       v
    PLAN (Opus 4.6) --- rewrite issue into spec + structured plan
       |
       v
    REVIEW (Codex, high reasoning) --- adversarial critique
       |
       +-- APPROVE --> EXECUTE
       +-- REVISE (max 2 rounds) --> re-review
       +-- REJECT --> FAILED
       |
       v
    EXECUTE (routed model) --- implement in git worktree
       |
       v
    VERIFY (Opus 4.6) --- check diff against acceptance criteria
       |
       v
    SHIP --- push branch, create PR, link to issue
```

## Architecture

Turborepo monorepo with Electron desktop app:

```
apps/
  web/              Marketing site (Next.js + Tailwind)
  desktop/          Electron + Vite + React 19
  cli/              CLI tool (published as 'shipcode' on npm)
  docs/             Documentation (Nextra)
packages/
  shared/           Types, schemas, constants
  agents/           Process manager, prompts, GitHub CLI wrapper
  db/               SQLite persistence (node:sqlite)
  git/              Git operations + worktree manager
  ui/               React components (kanban board, viewers)
```

## Prerequisites

- [Bun](https://bun.sh) >= 1.2
- [Claude Code CLI](https://claude.ai/claude-code) (`claude`)
- [Codex CLI](https://github.com/openai/codex) (`codex`)
- [GitHub CLI](https://cli.github.com) (`gh`) with auth configured
- Git

## Quick Start

```bash
# CLI (requires Node.js >= 22.5.0)
npx shipcode onboard
npx shipcode run 42
```

Or run the desktop app:

```bash
git clone https://github.com/shipshitdev/shipcode
cd shipcode
bun install
bun run dev:desktop
```

## GitHub integration

ShipCode uses the `gh` CLI for all GitHub operations. Make sure you're authenticated:

```bash
gh auth status
```

### Labels

| Label | Effect |
|-------|--------|
| `agent:claude` | Claude implements the issue |
| `agent:codex` | Codex implements the issue |

### Pipeline status labels (set automatically)

| Label | Meaning |
|-------|---------|
| `status:queued` | Issue picked up, waiting for pipeline slot |
| `status:in-progress` | Pipeline is running (plan/review/execute/verify) |
| `status:ready-for-review` | PR created, ready for human review |
| `status:failed` | Pipeline failed |
| `status:needs-human-review` | Autonomous review found unresolvable issues |

## Key design decisions

- **`gh` CLI over GitHub API** -- no OAuth, no token management, uses existing auth
- **Adversarial review** -- Opus plans, Codex critiques with high reasoning. Different model families catch different blind spots
- **Max 2 review rounds** -- diminishing returns after 2, prevents cost runaway
- **PR is the human gate** -- fully autonomous until PR creation. You review the PR, not the plan
- **Fork-point SHA for diffs** -- stable diffs even when base branch moves

## License

MIT
