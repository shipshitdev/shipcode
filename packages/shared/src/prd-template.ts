/**
 * PRD template scaffold used by the CreatePRDModal and referenced by the
 * `writing-prds` skill at `.agents/skills/writing-prds/SKILL.md`.
 *
 * The sections and order here are load-bearing: the planner agent translates
 * them directly into `PlanStructured` fields (see the mapping table in the
 * skill file). Do not reorder or rename sections without updating the skill.
 */
export const PRD_TEMPLATE = `---
name: <kebab-name>
description: <one-line summary>
status: backlog
estimated_complexity: medium
blast_radius: contained
---

# PRD: <name>

## Executive Summary
<2-4 sentences. What is this feature, why now, who wins.>

## Problem Statement
<The concrete pain. Reference real users / incidents / metrics where possible.>

## Goals
- <measurable, verifiable goal>

## Non-Goals
- <thing this explicitly does NOT do>

## User Stories
- As a <role>, I want <capability> so that <outcome>.
  **Acceptance:**
  - <concrete, verifiable check>

## Functional Requirements
1. <The system must do X. No implementation details.>

## Non-Functional Requirements
- <Only the ones that actually matter for this feature.>

## Success Criteria
- <Verifiable without judgement. Becomes plan.acceptanceCriteria.>

## Out of Scope
- <Be ruthless. Becomes plan.outOfScope.>

## Dependencies
- <Other PRDs, packages, external APIs.>

## Verification Plan
- tests: <test file paths or suite names>
- manual: <manual QA steps>

## Risks & Open Questions
- <Unknowns, edge cases, things that could kill the plan mid-execution.>
`

/**
 * Required section headings that must be present in a PRD body for it to be
 * submittable from the CreatePRDModal. Missing any of these hard-blocks submit.
 *
 * Kept narrow on purpose — these three are the load-bearing ones that the
 * pipeline's plan/review/verify phases actually consume. Other sections are
 * still required by the skill's quality gates but are checked at review time,
 * not at submit time.
 */
export const PRD_REQUIRED_HEADINGS = [
  '## Executive Summary',
  '## Success Criteria',
  '## Out of Scope',
] as const

/**
 * Lightweight client-side validator — checks that the required headings are
 * present in the body. Does NOT check that sections are filled with non-
 * placeholder content; that's a v2 concern.
 */
export function bodyHasRequiredPrdSections(body: string): boolean {
  return PRD_REQUIRED_HEADINGS.every((heading) => body.includes(heading))
}
