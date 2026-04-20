# Live Shell Sessions Spec

## Purpose
Run real interactive `claude` and `codex` CLI sessions inside the desktop Sessions view using the existing PTY-backed `ProcessManager`, instead of only showing one-shot non-interactive runs.

## Non-Goals
- Replacing the pipeline terminal drawer.
- Removing the existing `instant:run` one-shot flow used by PR review and comment-addressing actions.
- Full session persistence across app restarts.
- Adding a generic shell beyond `claude` and `codex`.

## Interfaces
- New IPC invokes for interactive sessions:
  - `instant:shell-start`
  - `instant:shell-input`
  - `instant:shell-resize`
- Existing `instant:cancel` remains the stop path.
- Sessions renderer panes must support two modes:
  - `replay`: canonical event replay from one-shot runs
  - `live`: PTY-backed interactive shell with stdin + resize

## Key Decisions
- Reuse `Thread` rows with `kind = 'instant'` for live shells.
- Keep one-shot `instant:run` intact for automation flows.
- Mark PTY processes with an output mode so support handlers know whether to normalize output or pass raw terminal data through.
- Reuse existing `terminal:event` streaming for live sessions by emitting raw chunks and lifecycle events.

## Edge Cases and Failure Modes
- Closing a live shell pane while the process is still running must stop the PTY, not just hide the pane.
- One-shot sessions opened from PR actions must still render correctly in the Sessions tab.
- Live shell sessions may start before the pane mounts; output must still appear via the existing event store.
- Resizes during teardown must not throw.

## Acceptance Criteria
- Starting a new terminal session from the Sessions tab launches a real interactive `claude` or `codex` CLI in the selected project directory.
- Typing into the embedded terminal sends input to the live PTY.
- Resizing the pane updates the PTY dimensions.
- Existing one-shot sessions from `instant:run` still render in the Sessions tab.
- Closing a running live shell pane stops the process and removes the pane.

## Test Plan
- Unit test the new store metadata/state handling for session panes.
- Unit test IPC hook behavior for agent state transitions affecting live session state.
- Typecheck `@shipcode/shared` and `@shipcode/desktop`.
- Run focused desktop vitest suites covering touched store/hooks/components where practical.
