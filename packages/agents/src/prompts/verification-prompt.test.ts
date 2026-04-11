import { describe, it, expect } from 'vitest';
import { buildVerificationPrompt } from './verification-prompt';
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
  acceptanceCriteria: ['Tests pass', 'No regressions'],
  outOfScope: ['Nothing'],
  estimatedComplexity: 'low',
  dependencies: [],
};

const sampleDiff = `--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,3 +1,5 @@\n+// new line\n export function foo() {}`;

describe('buildVerificationPrompt', () => {
  it('produces output containing the diff', () => {
    const result = buildVerificationPrompt(minimalPlan, sampleDiff, minimalPlan.acceptanceCriteria, { projectId: null }, { skills: noOverrides });
    expect(result).toContain('src/foo.ts');
  });

  it('produces output containing numbered acceptance criteria', () => {
    const result = buildVerificationPrompt(minimalPlan, sampleDiff, ['Tests pass', 'No regressions'], { projectId: null }, { skills: noOverrides });
    expect(result).toContain('1. Tests pass');
    expect(result).toContain('2. No regressions');
  });

  it('includes the plan JSON in output', () => {
    const result = buildVerificationPrompt(minimalPlan, sampleDiff, minimalPlan.acceptanceCriteria, { projectId: null }, { skills: noOverrides });
    expect(result).toContain(minimalPlan.id);
    expect(result).toContain(minimalPlan.objective);
  });

  it('matches snapshot (catches silent prompt regressions)', () => {
    const result = buildVerificationPrompt(
      minimalPlan,
      sampleDiff,
      minimalPlan.acceptanceCriteria,
      { projectId: null },
      { skills: noOverrides },
    );
    expect(result).toMatchSnapshot();
  });
});
