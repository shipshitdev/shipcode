---
name: feedback_claude_cli_prompts_via_stdin
description: Pipe claude -p prompts via stdin, never argv — argparser breaks on --- YAML frontmatter
type: feedback
status: active
last_verified: 2026-04-10
topics: [ipc, claude-cli, prd-generator, error-handling]
---

**Rule:** When spawning `claude -p` as a subprocess, **pipe the prompt via stdin**, never pass it as an argv argument.

**Why:** Claude CLI's argparser reads `---` (YAML frontmatter) as an unknown flag, and any `--foo` token inside a markdown code block in the prompt gets misparsed too. On non-zero exit Claude echoes the full command line to stderr, which used to land in the Create PRD modal as a wall of red text. Real incident, fixed 2026-04-10.

**The existing pattern:** `spawnWithStdin(command, args, input)` in `packages/agents/src/github/gh-cli.ts`; `runClaudeWithStdin(prompt, cwd, timeoutMs)` in `packages/agents/src/prd-generator.ts` implements the same shape for Claude.

**How to apply:**
- Never do `execFile('claude', ['-p', prompt, ...])`. Never do `execa('claude', ['-p', prompt])`.
- Always use `spawn('claude', [...flags], { stdio: ['pipe', 'pipe', 'pipe'] })` + `proc.stdin.write(prompt); proc.stdin.end()`.
- When adding a new spawn site, reuse `runClaudeWithStdin` from `prd-generator.ts` or copy its shape.
- Wrap the spawn in a `setTimeout` for the timeout.
- On non-zero exit, build the error message from **stderr only**, clamped to first 3 lines / 300 chars. Never include stdout. Never include the prompt.
- See also: `.agents/memory/ipc-errors.md` — the renderer-side second layer of error clamping.
