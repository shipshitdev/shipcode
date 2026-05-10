import type {
  FeatureQaResult,
  PlanReview,
  ShipCodePlan,
  VerificationResult,
} from '@shipcode/shared';
import { describe, expect, it } from 'vitest';
import { buildPRBody } from './shipping-prompt';

const PLAN: ShipCodePlan = {
  id: 'plan-1',
  threadId: 'thread-1',
  version: 1,
  objective: 'Move create button',
  files: [{ path: 'src/page.tsx', action: 'modify', description: 'Move button' }],
  steps: [
    {
      order: 1,
      description: 'Add stable selector',
      files: ['src/page.tsx'],
      rationale: 'Visual QA needs a target',
    },
  ],
  acceptanceCriteria: ['Create button is top-left'],
  outOfScope: [],
  estimatedComplexity: 'low',
  dependencies: [],
};

const QA_RESULT: FeatureQaResult = {
  featureId: 'issue-42',
  status: 'failed',
  summary: '1/1 visual QA assertion(s) failed.',
  runAt: new Date().toISOString(),
  evidencePaths: ['/tmp/qa/create-button.png'],
  flowResults: [
    {
      flowName: 'Create button is pinned top left',
      passed: false,
      failureReason: 'Button rendered bottom right.',
      assertions: [
        {
          name: 'Create button is pinned top left',
          passed: false,
          expected: 'target left/top within 24px of container left/top',
          actual: 'target x=900, y=700, w=80, h=32',
          evidencePath: '/tmp/qa/create-button.png',
        },
      ],
    },
  ],
};

describe('buildPRBody', () => {
  it('uses a project skill override and appends review and passed verification details', () => {
    const review: PlanReview = {
      planId: 'plan-1',
      decision: 'request_changes',
      confidence: 'medium',
      summary: 'Needs one guard before approval.',
      findings: [
        {
          id: 'finding-1',
          severity: 'major',
          category: 'correctness',
          description: 'Missing empty-state handling.',
        },
      ],
      suggestedChanges: [],
    };
    const verification: VerificationResult = {
      threadId: 'thread-1',
      planId: 'plan-1',
      result: 'passed',
      summary: 'Tests passed.',
      criteriaResults: [],
      issues: [],
    };
    const body = buildPRBody(PLAN, [review], verification, 42, {
      projectId: 'project-1',
      skills: {
        get: (projectId, phase) =>
          projectId === 'project-1' && phase === 'pr-generation'
            ? {
                content: `---
name: custom-pr-generation
description: Custom PR body
phase: ship
schemaVersion: 1
requiredSlots:
  - PLAN_OBJECTIVE
  - PLAN_STEPS
  - ACCEPTANCE_CRITERIA
  - ISSUE_NUMBER
---
Objective: {{PLAN_OBJECTIVE}}
Steps:
{{PLAN_STEPS}}
Acceptance:
{{ACCEPTANCE_CRITERIA}}
Issue: #{{ISSUE_NUMBER}}
`,
                baseVersion: 'custom',
                schemaVersion: 1,
                status: 'ok',
              }
            : null,
        markQuarantined: () => {},
      },
    });

    expect(body).toContain('Objective: Move create button');
    expect(body).toContain('1. Add stable selector');
    expect(body).toContain('Files: src/page.tsx');
    expect(body).toContain('- [ ] Create button is top-left');
    expect(body).toContain('Issue: #42');
    expect(body).toContain('<summary>Review Log (1 round)</summary>');
    expect(body).toContain('**Decision:** request_changes (medium confidence)');
    expect(body).toContain('**Findings:** 1');
    expect(body).toContain('- [major] Missing empty-state handling.');
    expect(body).toContain('## Verification: Passed');
    expect(body).toContain('Tests passed.');
  });

  it('pluralizes review logs and appends failed verification summaries', () => {
    const reviews: PlanReview[] = [
      {
        planId: 'plan-1',
        decision: 'approve',
        confidence: 'high',
        summary: 'Looks good.',
        findings: [],
        suggestedChanges: [],
      },
      {
        planId: 'plan-1',
        decision: 'reject',
        confidence: 'low',
        summary: 'Regression found.',
        findings: [],
        suggestedChanges: [],
      },
    ];
    const verification: VerificationResult = {
      threadId: 'thread-1',
      planId: 'plan-1',
      result: 'failed',
      summary: 'Lint failed.',
      criteriaResults: [],
      issues: [],
    };

    const body = buildPRBody(PLAN, reviews, verification, 43);

    expect(body).toContain('<summary>Review Log (2 rounds)</summary>');
    expect(body).toContain('**Decision:** approve (high confidence)');
    expect(body).toContain('**Decision:** reject (low confidence)');
    expect(body).not.toContain('**Findings:** 0');
    expect(body).toContain('## Verification: Failed');
    expect(body).toContain('Lint failed.');
  });

  it('includes feature QA evidence summaries and artifact paths', () => {
    const body = buildPRBody(PLAN, [], null, 42, {
      featureQaResults: [QA_RESULT],
    });

    expect(body).toContain('## QA Evidence');
    expect(body).toContain('issue-42');
    expect(body).toContain('Create button is pinned top left');
    expect(body).toContain('target left/top within 24px of container left/top');
    expect(body).toContain('/tmp/qa/create-button.png');
  });

  it('handles QA flows without optional assertions or artifact paths', () => {
    const body = buildPRBody(PLAN, [], null, 42, {
      featureQaResults: [
        {
          featureId: 'issue-43',
          status: 'passed',
          summary: 'Smoke flow passed.',
          runAt: '2026-05-09T00:00:00.000Z',
          flowResults: [
            {
              flowName: 'Smoke flow',
              passed: true,
              assertions: [
                {
                  name: 'Smoke assertion',
                  passed: true,
                  expected: 'visible',
                  actual: 'visible',
                },
              ],
            },
            {
              flowName: 'No assertion metadata',
              passed: true,
            },
          ],
        },
      ],
    });

    expect(body).toContain('Passed: Smoke flow');
    expect(body).not.toContain('Local artifacts');
  });

  it('caps feature QA evidence to the first five results, flows, assertions, and artifact paths', () => {
    const qaResults: FeatureQaResult[] = Array.from({ length: 6 }, (_, resultIndex) => ({
      featureId: `feature-${resultIndex}`,
      status: resultIndex === 0 ? 'passed' : 'partial',
      summary: `summary-${resultIndex}`,
      runAt: '2026-05-09T00:00:00.000Z',
      evidencePaths: Array.from(
        { length: 6 },
        (_, pathIndex) => `/tmp/root-${resultIndex}-${pathIndex}.png`,
      ),
      flowResults: Array.from({ length: 6 }, (_, flowIndex) => ({
        flowName: `flow-${resultIndex}-${flowIndex}`,
        passed: flowIndex === 0,
        evidencePaths: [`/tmp/flow-${resultIndex}-${flowIndex}.png`],
        assertions: Array.from({ length: 4 }, (_, assertionIndex) => ({
          name: `assertion-${resultIndex}-${flowIndex}-${assertionIndex}`,
          passed: assertionIndex === 0,
          expected: 'expected',
          actual: 'actual',
          evidencePath: `/tmp/assertion-${resultIndex}-${flowIndex}-${assertionIndex}.png`,
        })),
      })),
    }));

    const body = buildPRBody(PLAN, [], null, 42, {
      featureQaResults: qaResults,
    });

    expect(body).toContain('feature-0');
    expect(body).toContain('feature-4');
    expect(body).not.toContain('feature-5');
    expect(body).toContain('flow-0-4');
    expect(body).not.toContain('flow-0-5');
    expect(body).toContain('assertion-0-0-2');
    expect(body).not.toContain('assertion-0-0-3');
    expect(body).toContain('/tmp/root-0-4.png');
    expect(body).not.toContain('/tmp/root-0-5.png');
  });
});
