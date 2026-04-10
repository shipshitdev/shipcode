---
name: project_pipeline_flow
description: GitHub issue → plan → review → execute → verify state machine in packages/pipeline
type: project
status: active
last_verified: 2026-04-10
topics: [pipeline, architecture, state-machine]
---

The core ShipCode pipeline turns a GitHub issue into a shipped PR.

**Phases:**
1. **Plan** — LLM reads the issue body as a prompt, produces a `ShipCodePlan` with tasks.
2. **Review** — reviewer LLM critiques the plan; plan can be revised (tracked via `reviewRound`).
3. **Execute** — executor LLM writes code in a git worktree.
4. **Verify** — runs tests/build/typecheck, can retry (tracked via `verificationRetries`).

**State machine:** `packages/pipeline/src/pipeline.ts` owns the `Pipeline` object and `PipelineContext`. Keyed by `threadId`. Each context holds `projectPath`, `worktreePath`, retry counters, `githubIssueNumber`, `verifiedSha`, etc.

**Executor models:** `PipelineExecutorModel` supports `claude | codex | openrouter` (the `openrouter` arm is in progress on `feat/openrouter-tier1`). Each maps to a provider in `packages/agents/src/providers/`.

**Planner prompt from issues:** when starting from a GitHub issue, the planner prompt is built by concatenating title + body. **Grep-stable anchor:** search for `GitHub Issue #` in `packages/pipeline/src/pipeline.ts`. Because PRDs, issue bodies, and plan prompts are literally the same text, any improvement to one helps all three.

**How to apply:**
- When touching pipeline state, add fields to `PipelineContext` in `packages/pipeline/src/types.ts` AND initialize them in every context-creation site, or TypeScript will flag missing properties.
- When adding a new executor model, update: `PipelineExecutorModel` type, provider module under `packages/agents/src/providers/`, any `executorModel` switch statements, and the settings UI default options.
- Reviewer and verifier models are configurable separately (`reviewerModel`, `verifierModel` in `AppSettings`).
