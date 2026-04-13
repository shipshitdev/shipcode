import type { ShipCodePlan } from '@shipcode/shared';
import { describe, expect, it } from 'vitest';
import { formatPlanComment } from './plan-comment';

function makePlan(overrides: Partial<ShipCodePlan> = {}): ShipCodePlan {
  return {
    id: 'plan-1',
    threadId: 'thread-1',
    version: 1,
    objective: 'Ship the thing',
    files: [],
    steps: [
      {
        order: 1,
        description: 'Do the work',
        files: ['src/index.ts'],
        rationale: 'Required for the feature',
      },
    ],
    acceptanceCriteria: [],
    outOfScope: [],
    estimatedComplexity: 'medium',
    dependencies: [],
    ...overrides,
  };
}

describe('formatPlanComment', () => {
  it('preserves acceptance criteria when the body is under the byte limit', () => {
    const body = formatPlanComment(
      makePlan({
        acceptanceCriteria: ['It works'],
      }),
    );

    expect(body).toContain('## Acceptance Criteria');
    expect(body).toContain('- [ ] It works');
  });

  it('truncates oversized steps even when acceptance criteria are absent', () => {
    const largeRationale = 'x'.repeat(40_000);
    const body = formatPlanComment(
      makePlan({
        steps: [
          {
            order: 1,
            description: 'First step',
            files: ['src/one.ts'],
            rationale: largeRationale,
          },
          {
            order: 2,
            description: 'Second step',
            files: ['src/two.ts'],
            rationale: largeRationale,
          },
        ],
        outOfScope: ['Skip the optional bits'],
      }),
    );

    expect(Buffer.byteLength(body, 'utf8')).toBeLessThan(65_000);
    expect(body).toContain('## Steps');
    expect(body).toContain('_(Truncated');
    expect(body).toContain('<summary>Out of Scope</summary>');
  });
});
