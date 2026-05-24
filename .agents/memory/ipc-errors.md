---
name: ipc-errors
description: Clamp IPC error messages to first-line + ~280 chars; log full trace to main-process console
type: feedback
status: active
last_verified: 2026-04-21
topics: [ipc, errors, ux]
---

**Rule:** Clamp all IPC error messages to first-line + ~280 chars before sending to renderer. Log the full stack trace to the main-process console only.

**Why:** Unclamped stderr from agent processes produces red walls of text in the renderer (e.g. CreatePRDModal incident). The renderer has no scrollable error surface — it renders inline. A 5000-char stack trace in a modal is unusable.

**How to apply:**
- At the main-process IPC boundary, extract `error.message.split('\n')[0]` and truncate to ~280 chars.
- Log the full `error.stack` or raw stderr to `console.error` in the main process for debugging.
- Apply double-clamp: clamp at the main-process handler AND at the renderer display layer as a safety net.
- Never forward raw subprocess stderr directly to the renderer.
