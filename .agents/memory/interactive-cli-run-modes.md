---
name: interactive_cli_run_modes
description: Interactive provider CLI mode streams raw terminal events; programmatic Claude JSON requires claude -p and is billing-sensitive
type: project
status: active
last_verified: 2026-05-17
topics: [claude-cli, codex-cli, pipeline, settings, terminal-events, billing]
---

**Rule:** For Claude billing-sensitive paths, prefer **interactive CLI mode** over `claude -p` / Agent SDK / headless mode. Interactive mode launches the real provider terminal and ShipCode wraps its PTY output in our own terminal events.

**Why:** Anthropic's 2026 Claude Agent SDK billing update separates non-interactive `claude -p`, Agent SDK, GitHub Actions, and third-party SDK app usage from normal Claude Code terminal/IDE subscription usage. Claude's official `stream-json` output is only for print/headless mode (`claude -p --output-format stream-json`), not the interactive terminal.

**How interactive mode works:**
- ShipCode starts the provider CLI as a managed process.
- Claude interactive args must **not** include `-p`.
- Codex interactive args must **not** include `exec`.
- Prompt content is written to `.shipcode/runs/<threadId>/<phase>-prompt.md`, and the interactive CLI receives a short instruction to read that artifact.
- ShipCode streams raw PTY chunks into canonical terminal events like `terminal:start`, `terminal:raw_output`, and `terminal:exit`.
- Completion is known from the process `exit` event and exit code, then the pipeline advances to verification or failure handling.

**What we do and do not get:**
- We do get the visible terminal transcript: provider messages, command output, edits/tests as printed by the CLI, and lifecycle exit status.
- We do not get Claude's official structured event stream (`tool_call`, `assistant_message_delta`, usage JSON, etc.) unless using `claude -p --output-format stream-json`.
- It is acceptable to display ShipCode lifecycle markers around the terminal stream, but do not pretend raw interactive output is provider-native JSON.

**Settings contract:**
- `AppSettings.agentRunModes` controls routing per provider/action.
- Current default is `interactive` for `issueTerminal`, `execute`, `terminalFix`, and `instant`.
- Programmatic mode remains a future/explicit path and should be disabled in UI while Claude non-interactive billing is unsettled.
- If stored settings request programmatic Claude for terminal-like actions, fail clearly instead of silently using `claude -p`.

**Grep-stable anchors:**
- Settings/defaults: `agentRunModes` in `packages/shared/src/constants.ts`.
- UI: `Agent Output Mode` in `apps/desktop/src/renderer/components/settings-panel/PipelineSettingsSection.tsx`.
- Instant terminal routing: `startInteractiveInstantSession` in `apps/desktop/src/main/ipc/register-instant-handlers.ts`.
- Pipeline execute routing: `runMode` phase hint in `packages/pipeline/src/pipeline/runtime.ts`.
- CLI provider interactive execute: `buildClaudeInteractiveExecuteCommand` and `buildCodexInteractiveExecuteCommand` in `packages/agents/src/providers/cli-provider.ts`.

