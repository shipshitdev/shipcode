---
name: feedback_claude_cli_prompts_via_stdin
description: Pipe claude -p prompts via stdin, never argv — argparser breaks on --- YAML frontmatter
type: feedback
status: active
last_verified: 2026-08-01
topics: [ipc, claude-cli, prd-generator, error-handling]
---

**Rule:** When spawning `claude -p` as a subprocess, **pipe the prompt via stdin**, never pass it as an argv argument.

**Why:** Claude CLI's argparser reads `---` (YAML frontmatter) as an unknown flag, and any `--foo` token inside a markdown code block in the prompt gets misparsed too. On non-zero exit Claude echoes the full command line to stderr, which used to land in the Create PRD modal as a wall of red text. Real incident, fixed 2026-04-10.

**The existing patterns:**
- `runCliWithStdin({ cli, args, input, cwd, timeoutMs, envKeyAllowlist })` in `packages/agents/src/cli-stdin-runner.ts` — the canonical one-shot helper. PRD generation reaches it via `enhancePrdDraft` → `runPrdCliWithStdin` → `runNoToolsTextGeneration` → `runCliWithStdin`. (`runClaudeWithStdin` in `prd-generator.ts` is gone — do not cite it.)
- `spawnWithStdin(command, args, input)` in `packages/agents/src/github/gh-cli.ts` (~line 814) — the same shape for `gh`.
- `ProcessManager.spawnWithStdin(...)` in `packages/agents/src/process-manager.ts` — for managed, long-running pipeline processes. `runCli` in `packages/agents/src/providers/cli-provider.ts` and `runStdinCli` in `providers/stdin-cli-runner.ts` both go through it, and both **fail loudly** when it is missing rather than moving the prompt to argv.

**How to apply:**
- Never do `execFile('claude', ['-p', prompt, ...])`. Never do `execa('claude', ['-p', prompt])`.
- Always use `spawn('claude', [...flags], { stdio: ['pipe', 'pipe', 'pipe'] })` + `proc.stdin.write(prompt); proc.stdin.end()`.
- When adding a new spawn site, reuse `runCliWithStdin` from `cli-stdin-runner.ts` (one-shot) or `ProcessManager.spawnWithStdin` (managed) — never copy a prompt into an arg list.
- No stdin fallback may re-inject the prompt into argv. If a stdin pipe is unavailable, return an actionable error instead of degrading to a corruptible command line.
- Wrap the spawn in a `setTimeout` for the timeout.
- On non-zero exit, build the error message from **stderr only**, clamped to first 3 lines / 300 chars. Never include stdout. Never include the prompt.
- See also: `.agents/memory/ipc-errors.md` — the renderer-side second layer of error clamping.
