# Session Quick Start — shipcode

Neutral orientation for anyone (human or AI) opening this repo fresh. Read in 30 seconds. This file is open-source safe: no personal preferences, no credentials, no per-contributor paths.

## What this repo is

ShipCode is an Electron + Bun monorepo for running a planner → reviewer → executor AI pipeline against GitHub issues in a local git worktree. The desktop app is the control plane; the `packages/` directory holds the pipeline, agents, and shared primitives.

## First commands

```sh
bun install            # install deps across the monorepo
bun run dev            # launch the Electron desktop app (default entry)
bun run dev:docs       # Nextra docs site on port 3101
bun run typecheck      # tsc --noEmit across all 14 packages
bun run test           # vitest across all packages
```

Package-scoped tests: `bun run test --filter @shipcode/desktop` (or `@shipcode/pipeline`, etc.)

## Monorepo layout

```
apps/
  cli/        # headless bun CLI (provider registry, onboarding checks)
  desktop/    # Electron app — main/, renderer/, preload/
  docs/       # Nextra 4 docs site (shipcode.shipshit.dev/docs)
  web/        # marketing + embedded docs site (Vercel)
packages/
  agents/     # provider registry, PRD generator, GitHub CLI wrapper
  db/         # SQLite schema + queries (node:sqlite)
  git/        # worktree manager, git service
  pipeline/   # planner → reviewer → executor state machine
  shared/     # types, constants, IPC channel definitions
  ui/         # shared React primitives (Tailwind + Radix)
```

## Where things live

- **Session logs:** `.agents/SESSIONS/YYYY-MM-DD.md` — one file per day, committed, human-readable work diary
- **Repo memory:** `.agents/memory/` — committed facts about the project (architecture notes, decisions, gotchas)
- **PRD style guide:** `.agents/skills/writing-prds/SKILL.md` — the prompt that the AI PRD generator reads
- **Per-contributor preferences, plans, and skills:** live OUTSIDE this repo in the contributor's personal Claude/Codex config directory (typically `~/.claude/` or equivalent). They are intentionally NOT committed.

## Session ritual

- **Start:** skim `.agents/SESSIONS/<today>.md` if it exists — tells you what was already done today before you ask.
- **End:** run the `session-documenter` skill before `/clear`, so the day's work survives the context reset.
- **Memory review:** if any `.agents/memory/*.md` file's `last_verified:` date is >30 days old, verify before citing.

## No USER-PREFERENCES.md here

Personal preferences (tone, verbosity, tool-use style, favorite editors, etc.) do NOT belong in this repo. They live in the contributor's own Claude Code config (typically `~/.claude/` or equivalent). If your session-start tooling expects `.agents/SYSTEM/USER-PREFERENCES.md`, treat the missing file as "use repo defaults" — not an error.

## Cross-links

- `CLAUDE.md` (repo root) — Vincent's working agreement, imports personal memory files
- `AGENTS.md` (if present) — Codex-equivalent working agreement
- `/docs` site: https://shipcode.shipshit.dev/docs
- Project README: `README.md`

---

## Open manual QA checklist

Items below require a running desktop app (`bun run dev`) and human eyes. They cannot be exercised via jsdom / vitest. Check off when verified; leave a note in the session log.

### QA #1 — Nested Edit PRD modal stacking (from Session 2026-04-10 #8)

```
1. bun run dev
2. Click any issue on the Kanban board → IssueDetail overlay opens
3. Click "Edit PRD" in the IssueDetail header
   → CreateIssueModal should stack on top of IssueDetail
4. Verify:
   a. Background IssueDetail content is visibly dimmed
   b. Press Esc → top modal (CreateIssueModal) closes, IssueDetail stays open
   c. Press Esc again → IssueDetail closes
   d. Focus returns to the Kanban card that was clicked in step 2
   e. Cannot scroll the IssueDetail body while CreateIssueModal is open
   f. No console warnings about focus traps or missing DialogTitle
```

### QA #5 — Generate with AI → Create & Plan end-to-end (from Session 2026-04-10 #8)

```
1. bun run dev
2. Click "+ New PRD" button in the Kanban header
3. Type a one-line idea in the body textarea, e.g.
   "Add a keyboard shortcut to toggle the terminal drawer"
4. Click "Generate with AI"
   → Button disables + shows spinner
   → Body textarea populates with a full PRD (# heading, sections) in 10-60s
   → No red error banner; if error, it clamps to one line with
     "(full trace in devtools console)" hint
5. Review the generated PRD; optionally edit
6. Click "Create & Plan"
   → Modal closes
   → IssueDetail overlay opens with the new issue
   → Terminal drawer shows planner subprocess output
   → Pipeline phase advances queued → planning within ~15s
   → GitHub web UI shows the new issue at the project's repo
```
