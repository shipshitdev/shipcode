# Vincent's working agreement — shipcode

@~/.agents/memory/MEMORY.md
@.agents/memory/MEMORY.md

## Working directory

Primary: `/Users/decod3rs/www/shipshitdev/public/shipcode`

## Session ritual

- **Start:** skim `.agents/SESSIONS/<today>.md` if it exists before asking what was already done.
- **End:** run the `session-documenter` skill before `/clear`, so context survives the reset.
- **Memory review:** if any memory file's `last_verified:` date is >30 days old, verify before citing. Files with `status: temporary` — always check if still valid.

## Quick pointers

- Session logs: `.agents/SESSIONS/YYYY-MM-DD.md` (committed)
- Repo memory detail: `.agents/memory/` (committed)
- Global memory detail: `~/.agents/memory/` (uncommitted, cross-project)
- PRD style guide: `.agents/skills/writing-prds/SKILL.md`
- Plans: `~/.claude-genfeedai/plans/<slug>.md`
