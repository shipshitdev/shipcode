---
name: pr-generation
description: Template for generating pull request body content
phase: ship
schemaVersion: 1
requiredSlots:
  - PLAN_OBJECTIVE
  - PLAN_STEPS
  - ACCEPTANCE_CRITERIA
  - ISSUE_NUMBER
---

## Summary

{{PLAN_OBJECTIVE}}

<details>
<summary>Implementation Plan</summary>

**Steps:**
{{PLAN_STEPS}}

**Acceptance Criteria:**
{{ACCEPTANCE_CRITERIA}}
</details>

Closes #{{ISSUE_NUMBER}}

---
*Autonomous implementation by ShipCode*
