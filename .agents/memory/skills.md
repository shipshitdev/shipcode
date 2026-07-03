---
name: project_skills_memory_layout
description: Skills/memory folder layout — .agents/ is source of truth; .claude/skills and .codex/skills are relative within-repo symlinks; app-runtime skills live in top-level skills/
type: project
status: active
priority: low
last_verified: 2026-04-21
topics: [skills, memory, symlinks, layout]
---

# Skills and Memory Architecture — shipcode

## Pattern (applies to skills AND memory — never repeat this)

`.agents/` is the source of truth for everything. Tool-specific dirs are always relative within-repo symlinks into `.agents/`. Works for every contributor on clone, open-source safe.

| Source (committed) | Claude Code | Codex |
|--------------------|-------------|-------|
| `.agents/skills/` | `.claude/skills → ../.agents/skills` | `.codex/skills → ../.agents/skills` |
| `.agents/memory/` | `.claude/memory → ../.agents/memory` | `.codex/memory → ../.agents/memory` |

**Never** point outside the repo.

---

## Skills rule (never repeat this)

**Source of truth:** `.agents/skills/<skill-name>/` — committed to repo, open-source safe.

**Claude Code discovery:** `.claude/skills/<skill-name>` — relative symlink within the repo pointing to `../../.agents/skills/<skill-name>`. Contributors get working skills on clone, no external deps.

**Never:** symlinks that point outside the repo (e.g. `~/www/shipshitdev/public/skills/...`). Breaks for every contributor.

## Three buckets — never mix them

| Dir | Who uses it | Contents |
|-----|------------|----------|
| `skills/` | ShipCode app at runtime | Pipeline phase prompts + `writing-prds` + `github-label-sync` |
| `.agents/skills/` | Claude Code (devs building ShipCode) | 34 dev workflow skills (React, TS, Tailwind, etc.) |
| `.claude/skills` | → symlink to `../.agents/skills` | Discovery shim only |

`writing-prds` path: `skills/writing-prds/SKILL.md` — read by `register-github-handlers.ts` and `register-skills-handlers.ts`. Was `.agents/skills/` — moved 2026-04-21.

`github-label-sync` path: `skills/github-label-sync/SKILL.md` — read by ShipCode skill loader.

## Adding a new skill

```bash
# 1. Copy/create real files in .agents/skills/
cp -r ~/source/my-skill .agents/skills/my-skill

# 2. Add within-repo symlink for Claude Code discovery
cd .claude/skills && ln -sf ../../.agents/skills/my-skill my-skill
```

## What `.claude/skills/` must never contain

- Absolute symlinks (break on other machines)
- Symlinks pointing outside the repo root
- Real directories (defeats the single-source-of-truth in `.agents/skills/`)

## GitHub / open-source

`.agents/skills/` is committed. `.claude/skills/` symlinks are committed (git tracks symlinks). Any contributor who clones the repo gets all skills working immediately.
