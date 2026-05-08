import { REQUIRED_PRD_SECTIONS } from './constants';

/**
 * PRD template scaffold used by the CreatePRDModal and referenced by the
 * `writing-prds` skill at `skills/writing-prds/SKILL.md`.
 *
 * The sections and order here are load-bearing: the planner agent translates
 * them directly into `PlanStructured` fields (see the mapping table in the
 * skill file). Do not reorder or rename sections without updating the skill.
 */
export const PRD_TEMPLATE = `# PRD: <name>

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

## System Specification
- <Observable system behavior, data contracts, permissions, states, and boundaries. No file names.>

## Functional Requirements
1. <The system must do X. No implementation details.>

## Non-Functional Requirements
- <Only the ones that actually matter for this feature.>

## Feature Phase Breakdown
1. <Phase 1: foundation/spec plumbing. Include purpose, scope, and completion signal.>
2. <Phase 2: primary feature behavior. Include purpose, scope, and completion signal.>
3. <Phase 3: hardening/verification/shipping polish. Include purpose, scope, and completion signal.>

## Success Criteria
- <Verifiable without judgement. Becomes plan.acceptanceCriteria.>

## Out of Scope
- <Be ruthless. Becomes plan.outOfScope.>

## Dependencies
- <Other PRDs, packages, external APIs.>

## Verification Plan
- tests: <test file paths or suite names>
- manual: <manual QA steps>

## QA State
\`\`\`json
{
  "featureId": "<issue-or-feature-slug>",
  "routes": ["/path-under-test"],
  "criticalFlows": [
    {
      "name": "<flow name>",
      "steps": ["<ordered user or system action>"],
      "successCriteria": "<machine-checkable success condition>"
    }
  ],
  "expectedStates": ["<state the feature must reach>"],
  "testDataAssumptions": ["<seed/auth/data assumptions>"],
  "selectorReadiness": "ready",
  "visualAssertions": [
    {
      "name": "<assertion name>",
      "route": "/path-under-test",
      "targetSelector": "[data-testid=\\"target\\"]",
      "assertion": "top-left-of-container",
      "containerSelector": "[data-testid=\\"container\\"]",
      "tolerancePx": 24,
      "viewport": { "width": 1440, "height": 900 }
    }
  ],
  "evidencePolicy": {
    "screenshot": "always",
    "trace": "on-failure",
    "video": "on-failure"
  }
}
\`\`\`

## Risks & Open Questions
- <Unknowns, edge cases, things that could kill the plan mid-execution.>
`;

/**
 * Required section headings that must be present in a PRD body for it to be
 * submittable from the CreatePRDModal. Missing any of these hard-blocks submit.
 */
export const PRD_REQUIRED_HEADINGS = REQUIRED_PRD_SECTIONS.map((section) => `## ${section}`);

function stripFencedCodeBlocks(markdown: string): string {
  return markdown.replace(/^```[\s\S]*?^```/gm, '');
}

function getPrdSectionBody(body: string, section: string): string {
  const lines = body.split(/\r?\n/);
  const target = section.toLowerCase();
  let start = -1;

  for (let index = 0; index < lines.length; index++) {
    const match = /^#{2,3}\s+(.+)$/.exec(lines[index]);
    if (match?.[1]?.trim().toLowerCase() === target) {
      start = index + 1;
      break;
    }
  }

  if (start === -1) return '';

  const sectionLines: string[] = [];
  for (let index = start; index < lines.length; index++) {
    if (/^#{2,3}\s+/.test(lines[index])) break;
    sectionLines.push(lines[index]);
  }

  return sectionLines.join('\n').trim();
}

function hasNonPlaceholderContent(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !/(^|[\s<])(?:todo|tbd|fill this in|placeholder)(?:[\s>]|$)/i.test(trimmed);
}

function countNumberedPhaseItems(value: string): number {
  return (value.match(/^\s*\d+\.\s+\S+/gm) ?? []).length;
}

function hasBulletItem(value: string): boolean {
  return /^\s*[-*]\s+\S+/m.test(value);
}

export function getMissingRequiredPrdSections(body: string): string[] {
  const scanTarget = stripFencedCodeBlocks(body);
  const found = new Set<string>();
  const headingPattern = /^#{2,3}\s+(.+)$/gim;
  while (true) {
    const match = headingPattern.exec(scanTarget);
    if (!match) break;
    found.add(match[1].trim().toLowerCase());
  }

  return REQUIRED_PRD_SECTIONS.filter((section) => !found.has(section.toLowerCase()));
}

export function getPrdQualityIssues(body: string): string[] {
  const scanTarget = stripFencedCodeBlocks(body);
  const missingSections = getMissingRequiredPrdSections(scanTarget);
  const issues = missingSections.map((section) => `missing section: ${section}`);

  if (issues.length > 0) return issues;

  const systemSpec = getPrdSectionBody(scanTarget, 'System Specification');
  if (!hasNonPlaceholderContent(systemSpec)) {
    issues.push('System Specification must contain concrete non-placeholder content');
  }

  const phaseBreakdown = getPrdSectionBody(scanTarget, 'Feature Phase Breakdown');
  if (countNumberedPhaseItems(phaseBreakdown) !== 3) {
    issues.push('Feature Phase Breakdown must contain exactly three numbered phases');
  }

  const successCriteria = getPrdSectionBody(scanTarget, 'Success Criteria');
  if (!hasBulletItem(successCriteria) || !hasNonPlaceholderContent(successCriteria)) {
    issues.push('Success Criteria must contain at least one concrete bullet');
  }

  const outOfScope = getPrdSectionBody(scanTarget, 'Out of Scope');
  if (!hasBulletItem(outOfScope) || !hasNonPlaceholderContent(outOfScope)) {
    issues.push('Out of Scope must contain at least one concrete bullet');
  }

  return issues;
}

/**
 * Lightweight client-side validator — checks that the required headings are
 * present in the body. Does NOT check that sections are filled with non-
 * placeholder content; that's a v2 concern.
 */
export function bodyHasRequiredPrdSections(body: string): boolean {
  return getMissingRequiredPrdSections(body).length === 0;
}
