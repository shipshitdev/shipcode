---
name: prd-quality-gate
description: PRD completeness validation — required sections for pipeline entry
---

<prd_quality_gate>
A well-formed PRD (GitHub issue body) must contain ALL of the following sections
as markdown headings (## or ###). Missing sections reduce plan quality and risk
hallucinated scope.

Required sections:
- Executive Summary
- Problem Statement
- Goals
- Non-Goals
- User Stories
- System Specification
- Functional Requirements
- Non-Functional Requirements
- Feature Phase Breakdown
- Success Criteria
- Out of Scope
- Dependencies
- Verification Plan
- Risks & Open Questions

Additional quality rules:
- Feature Phase Breakdown must describe exactly three ordered phases.
- Success Criteria and Out of Scope must each contain at least one concrete
  bullet.
- System Specification must cover observable behavior and boundaries, not
  implementation file names.

When the quality gate is ENABLED (blocking):
- Missing any required section → pipeline fails immediately with an actionable message
  listing the missing sections.
- The user must update the issue body and re-trigger the pipeline.

When the quality gate is DISABLED (default, warning-only):
- Missing sections → a warning is logged to the terminal lifecycle stream.
- Planning proceeds. The planner should still note gaps in its output.

Section matching is case-insensitive against ## and ### headings. Exact heading
text must appear (e.g. "## Executive Summary" or "### Goals"). Headings nested
inside code fences are ignored by convention (they are examples, not structure).
</prd_quality_gate>
