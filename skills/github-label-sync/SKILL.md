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
| `enhancement` | `#a2eeef` | Feature or product improvement. |
| `bug` | `#d73a4a` | Something is broken. |
| `deferred` | `#6e7781` | Intentionally postponed work. |

### Agent Routing Labels

| Name | Color | Description |
|------|-------|-------------|
| `agent:claude` | `#1f6feb` | Route this issue to Claude Code. |
| `agent:codex` | `#2da44e` | Route this issue to Codex. |
| `agent:openrouter` | `#d97706` | Route this issue to the default OpenRouter executor. |
| `agent:openrouter/auto` | `#0ea5e9` | Route this issue to OpenRouter auto routing. |
| `agent:openrouter/free` | `#65a30d` | Route this issue to OpenRouter free-tier routing. |

### Workflow State

Workflow state is not represented as GitHub labels. Use the typed GitHub
Projects v2 `Status` single-select field instead (`Todo`, `In Progress`,
`Done`, `On hold`).

### Metadata Labels

| Name | Color | Description |
|------|-------|-------------|
| `complexity:low` | `#1a7f37` | Low-complexity task. |
| `complexity:medium` | `#bf8700` | Medium-complexity task. |
| `complexity:high` | `#cf222e` | High-complexity task. |
| `blast:contained` | `#1a7f37` | Changes stay within a contained surface area. |
| `blast:cross-package` | `#1f6feb` | Changes cross package boundaries. |
| `blast:cross-app` | `#d97706` | Changes cross app boundaries. |
| `blast:infra` | `#cf222e` | Changes touch infrastructure or platform concerns. |
| `blocked:ci` | `#cf222e` | Linked PR has failing CI checks and needs follow-up. |

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
