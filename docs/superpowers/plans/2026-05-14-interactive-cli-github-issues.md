# GitHub Issue Set: Interactive CLI Modes for Claude and Codex

## Epic: Support AFK and interactive Claude/Codex run modes

Labels: `epic`, `agents`, `provider-runtime`, `terminal`, `settings`, `cost-control`

ShipCode needs two provider run modes side by side:

- AFK mode: machine protocol mode for autonomous runs.
  - Claude: `claude -p --output-format stream-json`
  - Codex: `codex exec --json`
- Interactive mode: official CLI/TUI mode for supervised sessions.
  - Claude: `claude` without `-p`
  - Codex: `codex` without `exec`

The core rule: AFK mode owns structured pipeline output. Interactive mode owns supervised human control and produces structured pipeline artifacts through files, not terminal stdout.

Acceptance criteria:

- Users can choose AFK or interactive behavior for supported provider actions.
- Plan/review/verify autonomous pipeline phases remain AFK and parseable by default.
- Plan revision can be guided in the UI or handled through interactive artifact import.
- Execute can run AFK or interactive depending on provider/action settings.
- Interactive TUI stdout is never parsed as a `ShipCodePlan`, review, or verification result.
- Claude Agent SDK/non-interactive cost exposure is clearly separated from interactive Claude CLI usage in the UI copy.

## Issue 1: Add provider run mode settings

Labels: `settings`, `agents`, `provider-runtime`

Add persisted settings for provider run mode by action.

Proposed model:

```ts
type ProviderRunMode = 'afk' | 'interactive';
type PlanRevisionMode = 'guided' | 'interactive';

type AgentRunModeSettings = {
  claude: {
    execute: ProviderRunMode;
    planRevision: PlanRevisionMode;
    instant: ProviderRunMode;
    terminalFix: ProviderRunMode;
    allowAfkAutonomy: boolean;
  };
  codex: {
    execute: ProviderRunMode;
    planRevision: PlanRevisionMode;
    instant: ProviderRunMode;
    terminalFix: ProviderRunMode;
    allowAfkAutonomy: boolean;
  };
};
```

Default behavior:

- Preserve existing AFK behavior for autonomous pipelines.
- Default terminal fixes to interactive.
- Default instant assistant sessions to interactive.
- Default plan revision to guided.

Acceptance criteria:

- Settings persist in app settings.
- Existing settings migrations/tests cover defaults.
- Renderer settings UI exposes clear labels:
  - `AFK automation (-p)` for Claude
  - `AFK automation (exec)` for Codex
  - `Interactive Claude Code`
  - `Interactive Codex CLI`
- Current pipelines continue to run with existing behavior when settings are absent.

## Issue 2: Implement an interactive provider runner abstraction

Labels: `provider-runtime`, `terminal`, `agents`

Create a shared runner path for official CLI/TUI sessions.

Acceptance criteria:

- Runner uses `ProcessManager.spawn()` PTY, not `spawnWithStdin()`.
- Runner supports:
  - provider: Claude or Codex
  - cwd/worktree path
  - model id
  - reasoning/effort where applicable
  - approval/permission mode
  - prompt artifact path
- Runner streams raw terminal output to existing terminal panes.
- Runner supports cancellation through existing process manager kill path.
- Runner does not return structured provider output.

## Issue 3: Implement interactive Claude Code sessions

Labels: `claude`, `terminal`, `provider-runtime`

Add official Claude CLI/TUI launch support.

Expected command shape:

```bash
claude \
  --model <model> \
  --permission-mode acceptEdits \
  --tools Edit,Write,Bash,Glob,Grep,Read \
  --name shipcode-<threadId> \
  "<short prompt>"
```

Acceptance criteria:

- Claude interactive sessions launch without `-p`.
- Long prompts are passed via prompt artifact files instead of argv.
- The session starts in the intended project/worktree cwd.
- Tool permissions match the action:
  - plan revision: read/write only ShipCode run artifacts, no source edits
  - execute/fix: source editing allowed
- Terminal input is routed directly to the PTY.

## Issue 4: Implement interactive Codex CLI sessions

Labels: `codex`, `terminal`, `provider-runtime`

Add official Codex CLI/TUI launch support.

Expected command shape:

```bash
codex \
  -m <model> \
  -s workspace-write \
  -a on-request \
  --no-alt-screen \
  "<short prompt>"
```

Acceptance criteria:

- Codex interactive sessions launch without `exec`.
- Long prompts are passed via prompt artifact files instead of argv.
- The session starts in the intended project/worktree cwd.
- Sandbox and approval policy are action-aware.
- Terminal input is routed directly to the PTY.

## Issue 5: Add ShipCode run artifact layout

Labels: `shipcode-plan`, `pipeline`, `provider-runtime`

Add a stable per-thread artifact directory for interactive planning and supervised execution context.

Proposed layout:

```text
.shipcode/runs/<threadId>/plan-input.md
.shipcode/runs/<threadId>/plan.current.json
.shipcode/runs/<threadId>/revision-notes.md
.shipcode/runs/<threadId>/plan.revised.json
.shipcode/runs/<threadId>/execution-prompt.md
.shipcode/runs/<threadId>/terminal-fix-prompt.md
```

Acceptance criteria:

- Artifact paths are deterministic from thread id.
- Artifacts are written inside the project/worktree, not a global temp dir.
- Plan JSON files are validated with `shipCodePlanSchema` before import.
- Invalid artifacts produce readable validation errors in the renderer.
- Artifact cleanup policy is explicit.

## Issue 6: Add guided plan revision from Issue Detail

Labels: `planning`, `issue-detail`, `ux`

Allow the user to steer a completed plan from the Issue Detail page without opening a TUI.

Acceptance criteria:

- User can enter revision instructions after a plan is generated.
- Guided revision calls the existing AFK structured plan revision path.
- The result is stored as a normal plan revision/version.
- Existing approve/reject plan workflow remains intact.
- The UI makes clear that guided revision is still AFK/structured.

## Issue 7: Add interactive plan revision actions

Labels: `planning`, `terminal`, `issue-detail`, `shipcode-plan`

Add explicit Issue Detail actions:

- `Revise in Claude`
- `Revise in Codex`

Acceptance criteria:

- ShipCode writes `plan-input.md`, `plan.current.json`, and `revision-notes.md`.
- Interactive CLI prompt instructs the agent to write `plan.revised.json`.
- Interactive plan revision sessions are not allowed to edit source files.
- User can import the revised plan after the session.
- Import validates `ShipCodePlan`; invalid JSON/schema errors are shown.

## Issue 8: Route execute phase by provider run mode

Labels: `pipeline`, `execute`, `provider-runtime`

Support AFK or interactive execution based on provider/action settings.

Acceptance criteria:

- AFK execute keeps current provider behavior.
- Interactive execute opens the official CLI/TUI in the thread worktree.
- Pipeline status reflects supervised execution, not autonomous completion.
- User can continue to AFK verification after interactive execution completes.
- Verification remains AFK and parseable.
- Cancel/cleanup behavior works for interactive execute sessions.

## Issue 9: Make terminal fixes interactive by default

Labels: `terminal`, `debug`, `ux`

Change `Fix in terminal` to prefer official interactive CLI sessions.

Acceptance criteria:

- Claude terminal fix launches Claude Code TUI by default.
- Codex terminal fix launches Codex CLI TUI by default.
- AFK fix remains available as an explicit option.
- Existing failure context is preserved through `terminal-fix-prompt.md`.
- Terminal fix sessions run in the source thread worktree when available.

## Issue 10: Update instant assistant modes

Labels: `assistant`, `terminal`, `provider-runtime`

Split instant assistant actions into interactive and AFK variants.

Acceptance criteria:

- Default instant assistant opens interactive official CLI mode.
- `Run AFK` remains available for prompt-and-exit automation.
- UI labels distinguish:
  - `Interactive Claude Code`
  - `Interactive Codex CLI`
  - `AFK Claude automation`
  - `AFK Codex automation`
- Existing transcript/terminal pane behavior continues to work.

## Issue 11: Add cost and usage warnings for AFK vs interactive mode

Labels: `cost-control`, `usage`, `settings`

Clarify the cost difference between non-interactive automation and official interactive CLI usage.

Acceptance criteria:

- Claude AFK mode copy warns that `claude -p` may use Agent SDK/non-interactive credits.
- Claude interactive mode copy identifies it as official Claude Code CLI usage.
- Codex AFK mode copy identifies it as `codex exec`.
- Codex interactive mode copy identifies it as official Codex CLI/TUI usage.
- Existing provider usage indicators remain accurate and do not imply unsupported quota details.

## Issue 12: Add tests for run mode routing and artifact import

Labels: `tests`, `pipeline`, `provider-runtime`

Add focused tests for the new behavior.

Acceptance criteria:

- Settings default tests cover missing run mode settings.
- Provider runner tests assert Claude interactive does not include `-p`.
- Provider runner tests assert Codex interactive does not include `exec`.
- Plan artifact import validates good `ShipCodePlan` JSON.
- Plan artifact import rejects invalid JSON/schema.
- Execute routing tests cover AFK and interactive branches.
- Terminal fix routing tests cover default interactive behavior.

## Issue 13: Update docs and onboarding

Labels: `docs`, `onboarding`

Document the two-mode model.

Acceptance criteria:

- Docs explain AFK vs interactive.
- Docs explain why plan/review/verify stay AFK by default.
- Docs explain artifact-based `ShipCodePlan` import from TUI sessions.
- Docs include Claude pricing migration guidance for `claude -p` users.
- Onboarding copy tells users they can use official CLIs interactively without giving up AFK automation.
