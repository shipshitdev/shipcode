# Live Shell Sessions Decisions

## Chosen approach
Add a parallel interactive-shell path beside `instant:run`, then teach the Sessions UI to render either replay-only output or a live PTY.

## Why this approach
- It preserves existing automation flows that depend on `instant:run`.
- It reuses the already-shipped `ProcessManager` PTY path instead of adding another terminal abstraction.
- It keeps the renderer change local to the Sessions view and avoids touching the pipeline terminal drawer.

## Rejected options
- Replacing `instant:run` entirely with interactive shells.
  - Rejected because PR review/comment flows need non-interactive execution.
- Building a separate terminal subsystem just for Sessions.
  - Rejected because `ProcessManager` already provides spawn/write/resize/kill.
- Persisting full PTY transcripts in a new table first.
  - Rejected for this pass because the in-memory/store-backed event stream is enough to prove the feature.

## Assumptions
- `claude` and `codex` interactive modes work correctly when attached to `node-pty`.
- Existing `terminal:event` batching is sufficient for live-session rendering.
- The Sessions view only needs to keep live-shell state for the current app session.
