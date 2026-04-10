# Batch 2 — repo memory candidates (not yet seeded)

Files to add to `<repo>/.agents/memory/` after the batch-1 seed proves cross-agent recall works. **Uncommitted file — add to `.gitignore` or just leave untracked.**

## Sources
- Session logs: `.agents/SESSIONS/2026-04-07.md`, `2026-04-08.md`, `2026-04-10.md`
- Current code in `packages/agents/src/`, `packages/pipeline/src/`, `apps/desktop/src/main/ipc.ts`

## Candidate files

- `project_prd_flow.md` — PRDs = issue bodies = plan prompts (same text). `.agents/skills/writing-prds/SKILL.md` read from target repo, not ShipCode install. `CreateIssueModal` single-step with ✨ Enhance button. Grep-stable anchor: `enhancePrdDraft` in `packages/agents/src/prd-generator.ts`.
- `project_legacy_claude_dirs.md` — Shipcode memory used to live under `~/.claude-genfeedai/projects/.../memory/`. Since the modular-gathering-kahn plan, it lives here. If you see references to the old path, they're historical.
- `feedback_clamp_ipc_error_messages.md` — Clamp IPC errors to first-line + ~280 chars; log full trace to main-process console. Real incident: red wall of text in CreatePRDModal from unclamped stderr. Double-clamp at main + renderer.
- `ref_session_logs.md` — Work history at `.agents/SESSIONS/YYYY-MM-DD.md`. Check here before re-scanning the codebase for "what did we decide about X".
- `ref_plans_dir.md` — Plan files at `~/.claude-genfeedai/plans/<slug>.md` (will move after `.claude-*` consolidation).
- `ref_writing_prds_skill.md` — PRD style guide at `.agents/skills/writing-prds/SKILL.md` in this repo, loaded by the `ai:enhance-prd` IPC handler.

## Promotion criteria

Add a candidate to batch 1 when:
1. You notice yourself wanting to cite it and it's not already in a batch-1 memory.
2. OR: a session incident surfaces the rule/fact again (user correction or confirmation).
3. AND: it's specific to shipcode (not generalizable — those go to the global `~/.agents/memory/` batch 2 list).

When promoting: create the real `*.md` file with full frontmatter + commit it alongside the promotion commit. Remove the bullet from this list. Re-run `scripts/sync-agent-memory.sh` to refresh `AGENTS.md`.
