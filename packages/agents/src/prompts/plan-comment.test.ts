import type { ShipCodePlan } from '@shipcode/shared';
import { describe, expect, it } from 'vitest';
import { formatPlanComment, PLAN_COMMENT_MARKER } from './plan-comment';

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
  it('starts with the plan comment marker as the literal first line', () => {
    const body = formatPlanComment(makePlan());

    expect(body.startsWith(PLAN_COMMENT_MARKER)).toBe(true);
    expect(body.split('\n')[0]).toBe(PLAN_COMMENT_MARKER);
  });

  it('renders files, steps, out-of-scope items, and dependencies', () => {
    const body = formatPlanComment(
      makePlan({
        files: [
          {
            path: 'src/index.ts',
            action: 'modify',
            description: 'Update entrypoint',
          },
        ],
        acceptanceCriteria: ['It works'],
        outOfScope: ['No redesign'],
        dependencies: ['API key'],
      }),
    );

    expect(body).toContain('## Files (1 file)');
    expect(body).toContain('| modify | src/index.ts | Update entrypoint |');
    expect(body).toContain('Files: `src/index.ts`');
    expect(body).toContain('<summary>Out of Scope</summary>');
    expect(body).toContain('- No redesign');
    expect(body).toContain('<summary>Dependencies</summary>');
    expect(body).toContain('- API key');
  });

  it('uses plural file labels for multi-file plans', () => {
    const body = formatPlanComment(
      makePlan({
        files: [
          { path: 'src/a.ts', action: 'modify', description: 'A' },
          { path: 'src/b.ts', action: 'create', description: 'B' },
        ],
      }),
    );

    expect(body).toContain('## Files (2 files)');
  });

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

  it('truncates oversized steps before acceptance criteria and dependencies', () => {
    const body = formatPlanComment(
      makePlan({
        steps: [
          {
            order: 1,
            description: 'Large step',
            files: [],
            rationale: 'x'.repeat(70_000),
          },
        ],
        acceptanceCriteria: ['Keep this visible'],
        dependencies: ['And this'],
      }),
    );

    expect(Buffer.byteLength(body, 'utf8')).toBeLessThan(65_000);
    expect(body).toContain('_(Truncated — 1 steps. View full plan in ShipCode UI.)_');
    expect(body).toContain('- [ ] Keep this visible');
    expect(body).toContain('- And this');
  });

  it('truncates oversized steps through the end when no later sections exist', () => {
    const body = formatPlanComment(
      makePlan({
        steps: [
          {
            order: 1,
            description: 'Large step',
            files: [],
            rationale: 'x'.repeat(70_000),
          },
        ],
      }),
    );

    expect(Buffer.byteLength(body, 'utf8')).toBeLessThan(65_000);
    expect(body).toContain('_(Truncated — 1 steps. View full plan in ShipCode UI.)_');
  });
});
