import type { FeatureQaResult, ShipCodePlan } from '@shipcode/shared';
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
});
