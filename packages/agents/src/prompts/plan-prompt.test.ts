import type { ShipCodePlan } from '@shipcode/shared';
import { describe, expect, it } from 'vitest';
import type { SkillsRowSource } from '../skills';
import { buildPlanPrompt, buildRevisionPrompt } from './plan-prompt';

// Minimal skills source that always falls back to defaults
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

describe('buildPlanPrompt', () => {
  it('produces output containing the user prompt', () => {
    const result = buildPlanPrompt(
      'Add a login button',
      'thread-1',
      { projectId: null },
      { skills: noOverrides },
    );
    expect(result).toContain('Add a login button');
  });

  it('produces output containing the thread ID', () => {
    const result = buildPlanPrompt(
      'Fix bug',
      'thread-xyz',
      { projectId: null },
      { skills: noOverrides },
    );
    expect(result).toContain('thread-xyz');
  });

  it('includes context files when provided', () => {
    const result = buildPlanPrompt(
      'Fix bug',
      'thread-1',
      { projectId: null },
      { skills: noOverrides },
      {
        contextFiles: 'src/auth.ts (modified)',
      },
    );
    expect(result).toContain('src/auth.ts');
  });

  it('matches snapshot (catches silent prompt regressions)', () => {
    const result = buildPlanPrompt(
      'Add keyboard shortcut support',
      'thread-snap',
      { projectId: null },
      { skills: noOverrides },
      { contextFiles: 'src/shortcuts.ts (new file)' },
    );
    expect(result).toMatchSnapshot();
  });
});

describe('buildRevisionPrompt', () => {
  it('produces output containing review feedback', () => {
    const result = buildRevisionPrompt(
      minimalPlan,
      'Missing error handling',
      'thread-1',
      { projectId: null },
      { skills: noOverrides },
    );
    expect(result).toContain('Missing error handling');
  });

  it('produces output containing incremented version number', () => {
    const result = buildRevisionPrompt(
      minimalPlan,
      'feedback',
      'thread-1',
      { projectId: null },
      { skills: noOverrides },
    );
    expect(result).toContain(String(minimalPlan.version + 1));
  });

  it('matches snapshot', () => {
    const result = buildRevisionPrompt(
      minimalPlan,
      'Add tests',
      'thread-snap',
      { projectId: null },
      { skills: noOverrides },
    );
    expect(result).toMatchSnapshot();
  });
});
