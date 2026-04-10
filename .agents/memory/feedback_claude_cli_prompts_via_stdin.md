---
name: feedback_claude_cli_prompts_via_stdin
description: Pipe claude -p prompts via stdin, never argv — argparser breaks on --- YAML frontmatter
type: feedback
status: active
last_verified: 2026-04-10
topics: [ipc, claude-cli, prd-generator, error-handling]
---

**Rule:** When spawning `claude -p` as a subprocess, **pipe the prompt via stdin**, never pass it as an argv argument.

**Why:** Claude CLI's argparser reads `---` as an unknown flag. Any prompt that starts with YAML frontmatter — like the `writing-prds` SKILL.md we pass to the PRD generator — fails with `error: unknown option '---'`. And any `--foo` token inside a markdown code block in the prompt (e.g. `--body-file`, `--output-format`) also gets misparsed. When Claude exits non-zero, it echoes the full command line to stderr, and that stderr used to end up in the Create PRD modal as a giant wall of red text. Real incident, fixed in session 2026-04-10.

**The existing pattern:** `packages/agents/src/github/gh-cli.ts` has `spawnWithStdin(command, args, input)` (grep for the identifier). The PRD generator has a private `runClaudeWithStdin(prompt, cwd, timeoutMs)` in `packages/agents/src/prd-generator.ts` that implements the same pattern for Claude.

**How to apply:**
- Never do `execFile('claude', ['-p', prompt, ...])`. Never do `execa('claude', ['-p', prompt])`.
- Always use `spawn('claude', [...flags], { stdio: ['pipe', 'pipe', 'pipe'] })` + `proc.stdin.write(prompt); proc.stdin.end()`.
- When adding a new spawn site, reuse `runClaudeWithStdin` from `prd-generator.ts` or copy its shape.
- Wrap the spawn in a `setTimeout` for the timeout.
- On non-zero exit, build the error message from **stderr only**, clamped to first 3 lines / 300 chars. Never include stdout. Never include the prompt.
- See also: `.agents/memory/feedback_clamp_ipc_error_messages.md` (when it's promoted to batch 1) — the renderer-side second layer of error clamping.
