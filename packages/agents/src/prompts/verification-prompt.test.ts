import type { FeatureQaState, ShipCodePlan } from '@shipcode/shared';
import { describe, expect, it } from 'vitest';
import type { SkillsRowSource } from '../skills';
import { buildVerificationPrompt } from './verification-prompt';

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

const qaState: FeatureQaState = {
  featureId: 'issue-42',
  routes: ['/settings', '/settings/pipeline'],
  criticalFlows: [
    {
      name: 'toggle approval',
      steps: ['Open settings', 'Toggle approval'],
      successCriteria: 'Approval setting persists.',
    },
  ],
  expectedStates: ['approval enabled'],
  testDataAssumptions: ['settings exist'],
  selectorReadiness: 'ready',
};

describe('buildVerificationPrompt', () => {
  it('produces output containing the diff', () => {
    const result = buildVerificationPrompt(
      minimalPlan,
      sampleDiff,
      minimalPlan.acceptanceCriteria,
      { projectId: null },
      { skills: noOverrides },
    );
    expect(result).toContain('src/foo.ts');
  });

  it('produces output containing numbered acceptance criteria', () => {
    const result = buildVerificationPrompt(
      minimalPlan,
      sampleDiff,
      ['Tests pass', 'No regressions'],
      { projectId: null },
      { skills: noOverrides },
    );
    expect(result).toContain('1. Tests pass');
    expect(result).toContain('2. No regressions');
  });

  it('includes the plan JSON in output', () => {
    const result = buildVerificationPrompt(
      minimalPlan,
      sampleDiff,
      minimalPlan.acceptanceCriteria,
      { projectId: null },
      { skills: noOverrides },
    );
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

  it('reports fallback skill resolution and includes QA contracts', () => {
    const fallbackEvents: string[] = [];
    const resolvedSources: string[] = [];
    const skills: SkillsRowSource = {
      get: (projectId) =>
        projectId === 'project-1'
          ? {
              content: 'missing frontmatter',
              baseVersion: 'bad',
              schemaVersion: 1,
              status: 'ok',
            }
          : null,
      markQuarantined: (_projectId, phase, reason) => {
        fallbackEvents.push(`${phase}:${reason}`);
      },
    };

    const result = buildVerificationPrompt(
      minimalPlan,
      sampleDiff,
      minimalPlan.acceptanceCriteria,
      { projectId: 'project-1' },
      {
        skills,
        onFallback: (phase, error) => fallbackEvents.push(`${phase}:${error?.code}`),
        onResolved: (phase, resolution) =>
          resolvedSources.push(`${phase}:${resolution.skill.source}`),
      },
      null,
      { qaState },
    );

    expect(fallbackEvents).toContain(
      'plan-verification:Skill must start with a YAML frontmatter block delimited by ---',
    );
    expect(fallbackEvents).toContain('plan-verification:no_frontmatter');
    expect(resolvedSources).toEqual(['plan-verification:default']);
    expect(result).toContain('<qa_contract>');
    expect(result).toContain('Feature: issue-42');
    expect(result).toContain('Routes: /settings, /settings/pipeline');
    expect(result).toContain('- toggle approval: Approval setting persists.');
    expect(result).toContain('<qa_results>');
  });
});
