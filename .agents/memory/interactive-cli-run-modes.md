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

**Security guard (independent of billing):** programmatic **Claude** `execute`/`terminalFix`/
`instant` would spawn `claude -p` with host `Edit/Write/Bash` and no *built-in* OS sandbox (the
Claude Code Bash sandbox only constrains Bash, not the Edit/Write file tools or MCP). Handling:
- **execute** → programmatic is allowed but ONLY wrapped in the `srt` OS sandbox
  (`@anthropic-ai/sandbox-runtime`, Seatbelt/bubblewrap), which contains the WHOLE claude process
  incl. file tools + MCP. The runtime sets `phaseHints.osSandbox` (from `claudeExecuteSandboxEnabled`)
  and `cli-provider` spawns `srt -s <policy> claude -p …`. If the hint is absent (sandbox off) or
  `srt` cannot be resolved, execute **fails closed** — it is never run unsandboxed. See `sandbox/srt.ts`.
- **terminalFix / instant** → no srt path on those surfaces; `register-instant-handlers.ts`
  `getRunMode` coerces claude programmatic → interactive. Codex is OS-sandboxed (`codex exec
  --sandbox`) so codex runs programmatic everywhere.
- Structured claude phases are safe because `buildClaudeCommand` passes `--disallowedTools` for
  *every* host tool (Edit/Write/Bash/Read/Glob/Grep/Task/Web*), i.e. pure prompt→JSON.
- The settings UI enables `programmatic` for the Claude **execute** row only when
  `claudeExecuteSandboxEnabled`; Claude terminalFix/instant rows stay disabled; Codex rows are
  fully selectable. A "Sandbox Claude execute" toggle + network-policy select live in the same panel.

**srt policy (per-run, `sandbox/srt.ts`):** written to a 0700 mkdtemp dir, full strict schema
(srt rejects partial configs and fail-closes). `allowWrite` = worktree + tmp + `~/.claude`(.json) +
extra paths; `denyRead` = `~/.ssh`/`~/.aws`/`~/.gnupg`/`~/.config/gh`/`~/.npmrc`/`~/.netrc`;
network deny-by-default with an `anthropic-only` | `anthropic-github` allowlist preset. Verified
empirically (v0.0.55): srt passes stdin through, propagates the exact child exit code, confines
writes, and blocks non-allowlisted domains. `srt` is bundled as a dep of `@shipcode/agents`,
resolved via `require.resolve` and registered as the one allowlisted sandbox binary in ProcessManager.

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
- Execute sandbox gate: `'requires the OS sandbox'` + `osSandbox` in `packages/agents/src/providers/cli-provider.ts`.
- srt wrapper: `buildSandboxedClaudeExecuteCommand` / `resolveSrt` / `buildSrtPolicy` in `packages/agents/src/sandbox/srt.ts`.
- Allowlist escape: `registerSandboxBinary` in `packages/agents/src/process-manager.ts`.
- Tool policy: `PHASE_TOOL_POLICIES` in `packages/agents/src/providers/types.ts`.
- Pipeline routing: `getAgentPhaseRunMode` + `osSandbox` hint in `packages/pipeline/src/pipeline/runtime.ts`.
- Instant routing: `getRunMode` in `apps/desktop/src/main/ipc/register-instant-handlers.ts`.
- UI: `RunModeSelect` / "Agent Output Mode" in `apps/desktop/src/renderer/components/settings-panel/PipelineSettingsSection.tsx`.
