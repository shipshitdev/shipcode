---
name: interactive_cli_run_modes
description: Run-mode routing — programmatic (claude -p / codex exec) is the default for structured phases; interactive CLI streams raw terminal events; Claude execute/instant/terminalFix stay interactive for host-sandbox safety
type: project
status: active
last_verified: 2026-06-16
topics: [claude-cli, codex-cli, pipeline, settings, terminal-events, billing, security]
---

**Rule:** `programmatic` (`claude -p` / `codex exec --json`) is the **default** transport
for the structured reasoning phases. Anthropic reverted the 2026 Agent-SDK billing change
(May→June 2026: "we're not making this change today"), so `claude -p` draws from the normal
subscription seat again. Programmatic is preferred for automation: structured stream-json,
token/cost telemetry, and it composes with skills.

**Two transports per agent/phase (`AppSettings.agentRunModes[agent][phase]`):**
- `programmatic` — `claude -p --output-format stream-json` / `codex exec - --json`.
- `interactive` — launches the real provider terminal CLI; ShipCode wraps raw PTY output in
  its own terminal events (`terminal:start`, `terminal:raw_output`, `terminal:exit`) and
  completes on process `exit`. Claude interactive args must **not** include `-p`; codex
  interactive args must **not** include `exec`. Prompt content goes to
  `.shipcode/runs/<threadId>/<phase>-prompt.md`; the CLI gets a short "read that artifact"
  instruction.

**Defaults (DEFAULT_SETTINGS.agentRunModes):**
- `plan / review / revision / verify` → **programmatic** for both claude and codex.
- `execute` → **programmatic for codex** (sandboxed via `codex exec --sandbox`),
  **interactive for claude** (see security guard below).
- `terminalFix / instant` → **interactive** for both (watched terminal-pane surfaces).
- `issueTerminal` → always interactive.
- Default executor/planner/reviewer/verifier are all `codex`, so the out-of-box pipeline
  runs fully programmatic.

**Security guard (independent of billing):** programmatic **Claude** `execute`, `terminalFix`,
and `instant` would spawn `claude -p` with host `Edit/Write/Bash` and **no OS sandbox**.
These stay on the interactive CLI regardless of settings:
- `cli-provider.ts` hard-rejects `req.phase === 'execute' && runMode !== 'interactive'` for
  claude with a clear error.
- Structured claude phases are safe because `buildClaudeCommand` passes `--disallowedTools`
  for *every* host tool (Edit/Write/Bash/Read/Glob/Grep/Task/Web*), i.e. pure prompt→JSON.
- `register-instant-handlers.ts` `getRunMode` coerces claude programmatic → interactive for
  instant/terminalFix. Codex is OS-sandboxed (`codex exec --sandbox`) so it runs programmatic.
- The settings UI keeps the `programmatic` option disabled for the Claude execute/terminalFix/
  instant rows (tooltip cites the sandbox reason); Codex rows are fully selectable.

**Safety net retained:** if Anthropic ever re-rations the Agent-SDK pool, `markPoolExhausted`/
`isPoolExhausted` (`agent-sdk-pool-state.ts`) still flips programmatic claude → interactive at
runtime, and `AppSettings.forceInteractiveClaude` forces interactive globally. Pool exhaustion
is inferred from `claude -p` failure output (no balance API).

**What programmatic gives vs interactive:** programmatic yields the official structured event
stream (`tool_call`, usage JSON, cost). Interactive yields only the visible PTY transcript
plus ShipCode lifecycle markers — do not pass raw interactive output off as provider-native JSON.

**Grep-stable anchors:**
- Defaults: `agentRunModes` in `packages/shared/src/constants.ts`.
- Types/docs: `AgentRunModeConfig` in `packages/shared/src/types/pipeline-core.ts`.
- Security guard: `'Programmatic Claude execute is disabled'` in `packages/agents/src/providers/cli-provider.ts`.
- Tool policy: `PHASE_TOOL_POLICIES` in `packages/agents/src/providers/types.ts`.
- Pipeline routing: `getAgentPhaseRunMode` + `effectiveRunMode` in `packages/pipeline/src/pipeline/runtime.ts`.
- Instant routing: `getRunMode` in `apps/desktop/src/main/ipc/register-instant-handlers.ts`.
- UI: `RunModeSelect` / "Agent Output Mode" in `apps/desktop/src/renderer/components/settings-panel/PipelineSettingsSection.tsx`.
