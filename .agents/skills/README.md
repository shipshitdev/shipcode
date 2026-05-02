# Developer Workflow Skills

Skills in this directory are for **humans building ShipCode** — not for the app itself.

They are Claude Code developer workflow tools: code patterns, linting validators, testing guides, architecture references, and design aids tailored to the monorepo stack (Electron, React, Tailwind v4, TypeScript, Bun, Turborepo, shadcn/ui).

## Discovery

`.claude/skills` is a symlink to this directory. Claude Code auto-discovers all skills here via that symlink. Any contributor who clones the repo gets them immediately — no setup required.

## Stack coverage

| Bundle | Skills |
|--------|--------|
| Frontend | `react-patterns`, `react-hook-form`, `react-testing-library`, `react-component-performance`, `react-refactor`, `shadcn`, `shadcn-setup`, `component-library`, `table-filters`, `tailwind`, `tailwind-validator` |
| Design | `audit`, `clarify`, `critique`, `layout`, `polish`, `quieter`, `shape` |
| Backend | `api-design-expert`, `error-handling-expert`, `testing-expert`, `typescript-expert`, `typescript-refactor`, `biome-validator`, `bun-validator`, `scaffold`, `package-architect` |
| DevOps | `docker-expert`, `turborepo`, `security-expert`, `security-audit` |
| AI | `prompt-engineering`, `mcp-builder`, `claude-code-guide` |
| Product planning | `writing-prds`, `prd-quality-gate`, `github-label-sync` |

## Adding a skill

```bash
# 1. Put real files here
cp -r /path/to/my-skill .agents/skills/my-skill

# 2. No further setup needed — .claude/skills symlink covers it automatically
```

## What does NOT belong here

App-level skills (used by the ShipCode runtime during issue workflows) live in `skills/` at the repo root. See [`skills/README.md`](../skills/README.md).
