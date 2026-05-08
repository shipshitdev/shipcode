---
name: github-label-sync
description: Ensure ShipCode-required GitHub labels exist on the current repository using the gh CLI and the canonical definitions in packages/shared/src/github-labels.ts.
---

# GitHub Label Sync

Ensure all ShipCode-required GitHub labels exist on the current repository.

## When to Use

- After setting up a new project in ShipCode
- When a repo is missing labels needed for pipeline routing or status tracking
- As a pre-flight check before running the pipeline on a new repo

## Steps

1. **List existing labels:**

```bash
gh label list --limit 200 --json name
```

2. **Compare against the required set** (defined in `packages/shared/src/github-labels.ts`):

### Classification Labels

| Name | Color | Description |
|------|-------|-------------|
| `shipcode:bug` | `#d73a4a` | Something is broken. |
| `shipcode:deferred` | `#6e7781` | Intentionally postponed work. |

### Agent Routing Labels

| Name | Color | Description |
|------|-------|-------------|
| `shipcode:agent:claude` | `#1f6feb` | Route this issue to Claude Code. |
| `shipcode:agent:codex` | `#2da44e` | Route this issue to Codex. |
| `shipcode:agent:openrouter` | `#d97706` | Route this issue to the default OpenRouter executor. |
| `shipcode:agent:openrouter/auto` | `#0ea5e9` | Route this issue to OpenRouter auto routing. |
| `shipcode:agent:openrouter/free` | `#65a30d` | Route this issue to OpenRouter free-tier routing. |

### Workflow State

Workflow state is represented in the typed GitHub Projects v2 `Status`
single-select field (`Todo`, `In Progress`, `Done`, `On hold`). ShipCode also
uses namespaced `shipcode:pipeline:*` labels for transient agent-loop sub-states
and debugging.

| Name | Color | Description |
|------|-------|-------------|
| `shipcode:pipeline:queued` | `#6e7781` | Issue is queued for agent loop. |
| `shipcode:pipeline:planning` | `#0075ca` | Agent is generating a plan. |
| `shipcode:pipeline:reviewing` | `#0075ca` | Agent is reviewing the plan. |
| `shipcode:pipeline:revising` | `#0075ca` | Agent is revising the plan. |
| `shipcode:pipeline:clarifying` | `#e4e669` | Agent is requesting clarification. |
| `shipcode:pipeline:executing` | `#d93f0b` | Agent is executing changes. |
| `shipcode:pipeline:testing` | `#d93f0b` | Agent is running tests. |
| `shipcode:pipeline:verifying` | `#d93f0b` | Agent is verifying the result. |
| `shipcode:pipeline:shipping` | `#0e8a16` | Agent is opening or merging a PR. |
| `shipcode:pipeline:failed` | `#b60205` | Pipeline encountered an error. |

### System Labels

| Name | Color | Description |
|------|-------|-------------|
| `shipcode:blocked:ci` | `#cf222e` | Linked PR has failing CI checks and needs follow-up. |

Type, priority, status, complexity, and blast radius belong in native GitHub issue type or project fields when those fields are available. Do not recreate them as labels.

3. **Create missing labels:**

For each label not present in the repo, run:

```bash
gh label create "<name>" --color "<color>" --description "<description>"
```

The `gh label create` command is idempotent -- if the label already exists, it prints an "already exists" message to stderr. Catch and ignore that case.

4. **Report results:**

Print a summary: how many created, how many already present, how many failed.

## Notes

- This skill requires `gh` CLI authenticated with repo access.
- Label operations use standard repo permissions -- no special OAuth scopes needed.
- Safe to run multiple times (idempotent).
- The canonical label definitions live in `packages/shared/src/github-labels.ts` -- update that file if labels change, then re-run this skill.
