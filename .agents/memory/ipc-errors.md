---
name: ipc-errors
description: Clamp IPC error messages to first-line + ~280 chars; log full trace to main-process console
type: feedback
status: active
last_verified: 2026-08-01
topics: [ipc, errors, ux]
---

## One guarded path from main to renderer (hard rule)

**Rule:** no `webContents.send` outside `apps/desktop/src/main/safe-send.ts`. Main-process events go through `safeSend(window, channel, payload)`, which returns a boolean and never throws.

**Why:** a raw send throws once the window or its `webContents` is destroyed, and that throw escapes the IPC handler that produced it — so a GitHub write that already succeeded is reported to the caller as a failure while the remote state has in fact changed. Renderer notification is best-effort: if nobody is listening, dropping it is correct, not an error.

**How to apply:**
- Both the `isDestroyed` guard and the `try/catch` are required. The guard can never be atomic with the send, and dev-mode HMR leaves disposed render frames behind.
- Use the exported `canSendToRenderer` type predicate only to skip work that exists purely to build a payload (a DB read, a git call) — not before a plain send, which `safeSend` already guards.
- A guard that protects more than the send (window `restore`/`focus`, feeding a normalizer) stays as an early return, with a comment saying what else it covers.
- Test window mocks must stub `webContents.isDestroyed`, not just `webContents.send`.

**Rule:** Clamp all IPC error messages to first-line + ~280 chars before sending to renderer. Log the full stack trace to the main-process console only.

**Why:** Unclamped stderr from agent processes produces red walls of text in the renderer (e.g. CreatePRDModal incident). The renderer has no scrollable error surface — it renders inline. A 5000-char stack trace in a modal is unusable.

**How to apply:**
- At the main-process IPC boundary, extract `error.message.split('\n')[0]` and truncate to ~280 chars.
- Log the full `error.stack` or raw stderr to `console.error` in the main process for debugging.
- Apply double-clamp: clamp at the main-process handler AND at the renderer display layer as a safety net.
- Never forward raw subprocess stderr directly to the renderer.
