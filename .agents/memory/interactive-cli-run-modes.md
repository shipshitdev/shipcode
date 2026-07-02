---
name: interactive_cli_run_modes
description: Run-mode routing — programmatic (claude -p / codex exec) is the default for structured phases; interactive CLI streams raw terminal events; Claude execute/instant/terminalFix stay guarded for host-sandbox safety
type: project
status: active
last_verified: 2026-06-16
topics: [claude-cli, codex-cli, pipeline, settings, terminal-events, billing, security]
---

**Rule:** `programmatic` (`claude -p --output-format stream-json` / `codex exec - --json`) is the **default** transport for structured reasoning phases — structured events, token/cost telemetry, composes with skills. (Anthropic reverted the 2026 Agent-SDK billing split, so `claude -p` draws from the normal subscription seat.)

**Two transports per agent/phase (`AppSettings.agentRunModes[agent][phase]`):**
- `programmatic` — headless CLI, structured JSON stream.
- `interactive` — launches the real provider terminal CLI; ShipCode wraps raw PTY output in its own terminal events (`terminal:start`, `terminal:raw_output`, `terminal:exit`) and completes on process `exit`. Claude interactive args must **not** include `-p`; codex interactive args must **not** include `exec`. Prompt content goes to `.shipcode/runs/<threadId>/<phase>-prompt.md`; the CLI gets a short "read that artifact" instruction. Never pass raw interactive output off as provider-native JSON.

**Defaults (`agentRunModes` in `packages/shared/src/constants.ts`):** `plan/review/revision/verify` → programmatic for both; `execute` → programmatic for codex (sandboxed via `codex exec --sandbox`), interactive for claude; `terminalFix/instant` → interactive for both; `issueTerminal` → always interactive. Default executor/planner/reviewer/verifier are all `codex`, so out-of-box runs fully programmatic.

**Security guard:** programmatic **Claude** `execute`/`terminalFix`/`instant` would spawn `claude -p` with host Edit/Write/Bash and no built-in OS sandbox (the Claude Code Bash sandbox doesn't constrain file tools or MCP). Handling:
- **execute** → programmatic allowed ONLY wrapped in the `srt` OS sandbox (`@anthropic-ai/sandbox-runtime`, Seatbelt/bubblewrap — contains the whole claude process). Runtime sets `phaseHints.osSandbox` (from `claudeExecuteSandboxEnabled`); `cli-provider` spawns `srt -s <policy> claude -p …`. Hint absent or `srt` unresolvable → execute **fails closed**, never runs unsandboxed. Policy (`sandbox/srt.ts`): allowWrite = worktree/tmp/`~/.claude`; denyRead = `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gh`, `~/.npmrc`, `~/.netrc`; network deny-by-default with `anthropic-only`|`anthropic-github` presets.
- **terminalFix / instant** → no srt path; `getRunMode` in `register-instant-handlers.ts` coerces claude programmatic → interactive. Codex runs programmatic everywhere (own sandbox).
- Structured claude phases are safe: `buildClaudeCommand` passes `--disallowedTools` for every host tool — pure prompt→JSON.
- Settings UI enables the Claude execute programmatic row only when `claudeExecuteSandboxEnabled`; Claude terminalFix/instant rows stay disabled.

**Safety net:** `markPoolExhausted`/`isPoolExhausted` (`agent-sdk-pool-state.ts`) flips programmatic claude → interactive at runtime if the Agent-SDK pool is ever re-rationed; `AppSettings.forceInteractiveClaude` forces interactive globally.

**Grep-stable anchors:** `agentRunModes` (constants), `AgentRunModeConfig` (`packages/shared/src/types/pipeline-core.ts`), `osSandbox` in `packages/agents/src/providers/cli-provider.ts`, `buildSrtPolicy` in `packages/agents/src/sandbox/srt.ts`, `PHASE_TOOL_POLICIES` in `packages/agents/src/providers/types.ts`, `getAgentPhaseRunMode` in `packages/pipeline/src/pipeline/runtime.ts`, `RunModeSelect` in `PipelineSettingsSection.tsx`.
