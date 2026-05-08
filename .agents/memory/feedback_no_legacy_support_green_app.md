---
name: feedback_no_legacy_support_green_app
description: Green app rule — no legacy compatibility shims or dead-code fallbacks
type: feedback
status: active
last_verified: 2026-05-08
topics: [code-quality, workflow, state-management]
---

**Rule:** The app is green. Do not add legacy support, compatibility shims, or UI fallbacks for stale/impossible states. Cut dry.

**Why:** Vincent explicitly does not want dead code or legacy support. If state is invalid, fix it at the source or via an explicit user-triggered cleanup path. Do not hide it with renderer guards.

**How to apply:**
- Prefer deleting stale branches and fixing producers over adding defensive presentation mapping.
- Do not translate impossible DB/state-machine combinations into nicer UI states.
- If cleanup is needed, make it explicit and user-triggered, not silent startup work.
- Tests should assert the desired source-of-truth behavior, not preserve compatibility for invalid legacy states.
