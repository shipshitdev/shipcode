---
name: feedback_verification_failures_retry_execution
description: Structured verification failures should retry execution, not verification; preserve test output and verifier feedback
type: feedback
status: active
last_verified: 2026-04-23
topics: [pipeline, verification, retry, execution]
---

**Rule:** When the latest verification for the current plan failed **with structured findings**, resume from **execution**, not `verify`.

**Why:** Re-running verification on the same worktree does not address the verifier's findings. This bug showed up in the desktop retry flow on 2026-04-23: the UI offered `Resume verification`, the IPC retry path called `startVerification(...)`, and the verifier could also complain about missing test evidence because `context.testOutput` had been cleared before prompt construction.

**How to apply:**
- Manual retry routing (`IssueDetail`, IPC retry helpers) should map failed structured verification on the latest plan to `execute`.
- Reserve `verify` retries for failed **unstructured** verification records (malformed/unparsable verifier output).
- The next execute prompt should include a concise verifier-feedback block derived from the latest structured failed verification.
- Do **not** clear `context.testOutput` before building the verification prompt; the verifier needs actual test output as evidence.
