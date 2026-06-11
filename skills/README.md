# ShipCode App Skills

All skills in this folder are **used by the ShipCode app itself** at runtime — during GitHub issue workflows and pipeline execution. They are not developer workflow tools.

## Pipeline phase skills

The five default prompts that drive every pipeline run:

| Phase | Skill | Role |
|---|---|---|
| 1. Plan | [`plan-generation/SKILL.md`](./plan-generation/SKILL.md) | Turn a user task into a ShipCodePlan |
| 2. Review | [`adversarial-review/SKILL.md`](./adversarial-review/SKILL.md) | Break confidence in the plan before it ships |
| 3. Revise | [`plan-revision/SKILL.md`](./plan-revision/SKILL.md) | Rewrite the plan to address review findings |
| 4. Execute | [`plan-execution/SKILL.md`](./plan-execution/SKILL.md) | Apply the approved plan inside a git worktree |
| 5. Verify | [`plan-verification/SKILL.md`](./plan-verification/SKILL.md) | Confirm the diff matches the plan |

## Repo-level app skills

Skills that ShipCode reads directly from each target repo at runtime:

| Skill | Read by | Role |
|-------|---------|------|
| [`writing-prds/SKILL.md`](./writing-prds/SKILL.md) | `register-github-handlers.ts` via `ai:enhance-prd` IPC | Style guide for enhancing GitHub issue bodies |
| [`github-label-sync/SKILL.md`](./github-label-sync/SKILL.md) | ShipCode skill loader | Ensures required ShipCode labels exist on the repo |
| [`skill-security-auditor/SKILL.md`](./skill-security-auditor/SKILL.md) | ShipCode skill loader / future import gate | Audits third-party skills before users install, import, or trust them |

The pipeline loops through review → revise up to the configured `revisionCount` before either entering `approval` (manual mode) or proceeding to execute (autonomous mode). Approved plans must contain exactly three ordered execution phases: foundation/spec plumbing, primary feature behavior, and hardening/verification. That shape lets the task graph execute feature work one phase at a time instead of handing one large ambiguous blob to the executor.

## Format

Each skill is a markdown file with YAML frontmatter and an XML-tag body, modeled on the [`/codex:adversarial-review`](https://github.com/openai/codex) plugin prompt.

```markdown
---
name: <slug>
description: <one-line summary>
phase: plan | review | revision | execute | verify
schemaVersion: 1
requiredSlots:
  - SLOT_ONE
  - SLOT_TWO
---

<role>...</role>
<task>...</task>
<operating_stance>...</operating_stance>
...
```

### Frontmatter fields

- **`name`** — kebab-case slug, must match the folder name.
- **`description`** — one-line summary shown in the `/skills` view.
- **`phase`** — one of `plan | review | revision | execute | verify`. Maps to the pipeline phase.
- **`schemaVersion`** — bump when the slot vocabulary changes. Existing user overrides with a stale `schemaVersion` are quarantined on app startup.
- **`requiredSlots`** — array of `{{SLOT}}` names that the body MUST reference. The skill loader rejects any user override that drops a required slot.

### Body

The body uses XML-style tag sections (`<role>`, `<task>`, `<operating_stance>`, `<attack_surface>`, etc.) to keep the prompt structured and easy to scan. Mustache-style slots (`{{SLOT_NAME}}`) get replaced at runtime by the pipeline with concrete values.

The frontmatter is **stripped** before the prompt is sent to the provider — frontmatter is metadata for the editor and the loader, not for the LLM.

## Slot vocabulary

Each phase has its own set of slots. The pipeline guarantees these are present at runtime; if your override forgets one, the loader rejects the save (or quarantines the row at load time and falls back to the bundled default).

| Phase | Slots |
|---|---|
| plan-generation | `USER_PROMPT`, `THREAD_ID`, `CONTEXT_FILES`, `OUTPUT_SCHEMA` |
| adversarial-review | `PLAN_JSON`, `TARGET_LABEL`, `AUTONOMOUS`, `CONTEXT_FILES`, `OUTPUT_SCHEMA` |
| plan-revision | `ORIGINAL_PLAN`, `REVIEW_FEEDBACK`, `THREAD_ID`, `NEW_VERSION`, `OUTPUT_SCHEMA` |
| plan-execution | `APPROVED_PLAN` |
| plan-verification | `PLAN_JSON`, `DIFF`, `ACCEPTANCE_CRITERIA`, `OUTPUT_SCHEMA` |

`OUTPUT_SCHEMA` is a special slot — its value is the full fenced JSON schema block (e.g. `` ```shipcode-plan\n{ ... }\n``` ``). It exists so the parser contract stays in TypeScript constants where it cannot be accidentally edited away.

## How they get loaded at runtime

```
<shipcode>/skills/<phase>/SKILL.md          ← source of truth, GitHub-visible
        │
        │ scripts/build-skill-defaults.ts
        ▼
packages/agents/src/skills/defaults.generated.ts   ← committed, runtime-safe
        │
        │ resolveSkill(phase, projectId)
        ▼
skills table in SQLite (project_id|null, phase) → user overrides
        │
        │ validateSkill — required slots present?
        │
        │ ✅                              ❌
        ▼                                 ▼
runtime prompt sent to provider     auto-fallback to bundled default
                                    + notification + status='quarantined'
```

The runtime resolver walks **project override → global override → bundled default**, validating each tier. If a tier fails validation, it is skipped (quarantined) and the next tier is consulted. The bundled default is the last resort and is guaranteed by CI to be valid.

## Editing skills

Two ways:

1. **Edit a SKILL.md file in this folder** — these are the bundled defaults shipped with ShipCode. Run `bun run build:skills` to regenerate `defaults.generated.ts`. CI fails if the generated file is stale or if any skill is missing required frontmatter fields.

2. **Use the `/skills` page in the desktop app** — for per-user customization. Edits are stored in the SQLite DB at `(project_id|null, phase)`. Pick "Global" to apply to every project, or pick a specific project for that one only. Project overrides beat global overrides beat bundled defaults.

## Dogfooding

The shipcode repo itself runs through the same pipeline (`bun run dev` → kanban → new PRD → plan → review → revise → execute → verify). The bundled defaults in this folder are what the shipcode repo uses on itself. If a default produces a bad plan or review, fix the markdown here and `bun run build:skills`.
