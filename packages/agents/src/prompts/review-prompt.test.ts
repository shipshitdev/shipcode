import { describe, it, expect } from 'vitest';
import { buildReviewPrompt } from './review-prompt';
import type { SkillsRowSource } from '../skills';
import type { ShipCodePlan } from '@shipcode/shared';

const noOverrides: SkillsRowSource = {
  get: () => null,
  markQuarantined: () => {},
};

const minimalPlan: ShipCodePlan = {
  id: 'plan-test',
  threadId: 'thread-test',
  version: 1,
  objective: 'Add a feature',
  files: [{ path: 'src/foo.ts', action: 'modify', description: 'Update foo' }],
  steps: [{ order: 1, description: 'Do the thing', files: ['src/foo.ts'], rationale: 'Because' }],
  acceptanceCriteria: ['It works'],
  outOfScope: ['Nothing'],
  estimatedComplexity: 'low',
  dependencies: [],
};

describe('buildReviewPrompt', () => {
  it('produces output containing the plan JSON', () => {
    const result = buildReviewPrompt(minimalPlan, { projectId: null }, { skills: noOverrides });
    expect(result).toContain(minimalPlan.id);
    expect(result).toContain(minimalPlan.objective);
  });

  it('includes autonomous flag in output', () => {
    const autonomous = buildReviewPrompt(minimalPlan, { projectId: null }, { skills: noOverrides }, { autonomous: true });
    expect(autonomous).toContain('yes');

    const manual = buildReviewPrompt(minimalPlan, { projectId: null }, { skills: noOverrides }, { autonomous: false });
    expect(manual).toContain('no');
  });

  it('includes context files when provided', () => {
    const result = buildReviewPrompt(minimalPlan, { projectId: null }, { skills: noOverrides }, {
      contextFiles: 'src/auth.ts (modified)',
    });
    expect(result).toContain('src/auth.ts');
  });

  it('matches snapshot (catches silent prompt regressions)', () => {
    const result = buildReviewPrompt(
      minimalPlan,
      { projectId: null },
      { skills: noOverrides },
      { autonomous: false, contextFiles: 'src/shortcuts.ts (new file)' },
    );
    expect(result).toMatchSnapshot();
  });
});
