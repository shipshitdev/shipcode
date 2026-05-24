import type { ShipCodePlan } from '@shipcode/shared';
import { describe, expect, it, vi } from 'vitest';
import type { SkillsRowSource } from '../skills';
import {
  buildPlanPrompt,
  buildPreviousAttemptContext,
  buildRevisionPrompt,
  formatClarificationContext,
} from './plan-prompt';

// Minimal skills source that always falls back to defaults
const noOverrides: SkillsRowSource = {
  get: () => null,
  markQuarantined: () => {},
};

function invalidOverride(): SkillsRowSource {
  return {
    get: () => ({
      content: 'not frontmatter',
      baseVersion: 'bad',
      schemaVersion: 1,
      status: 'ok',
    }),
    markQuarantined: vi.fn(),
  };
}

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

  it('injects test commands, clarification answers, and resolution callbacks', () => {
    const onResolved = vi.fn();
    const onFallback = vi.fn();
    const result = buildPlanPrompt(
      'Fix bug',
      'thread-1',
      { projectId: null },
      { skills: noOverrides, onResolved, onFallback },
      {
        clarificationContext: 'Selected option: keep local data',
      },
      'bun test',
    );

    expect(result).toContain('Test suite passes (`bun test`).');
    expect(result).toContain('<clarification_context>');
    expect(result).toContain('Selected option: keep local data');
    expect(result).toContain('Return exactly one fenced JSON block and nothing else.');
    expect(onResolved).toHaveBeenCalledWith('plan-generation', expect.any(Object));
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('reports fallback when a plan skill override is invalid', () => {
    const onFallback = vi.fn();
    const skills = invalidOverride();

    const result = buildPlanPrompt(
      'Fix bug',
      'thread-1',
      { projectId: 'project-1' },
      { skills, onFallback },
    );

    expect(result).toContain('Fix bug');
    expect(onFallback).toHaveBeenCalledWith(
      'plan-generation',
      expect.objectContaining({ code: 'no_frontmatter' }),
    );
    expect(skills.markQuarantined).toHaveBeenCalled();
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

  it('injects revision test commands and records skill resolution', () => {
    const onResolved = vi.fn();
    const result = buildRevisionPrompt(
      minimalPlan,
      'feedback',
      'thread-1',
      { projectId: null },
      { skills: noOverrides, onResolved },
      'bun test',
      { contextFiles: 'ignored broad context' },
    );

    expect(result).toContain('Test suite passes (`bun test`).');
    expect(result).not.toContain('ignored broad context');
    expect(onResolved).toHaveBeenCalledWith('plan-revision', expect.any(Object));
  });

  it('reports fallback when a revision skill override is invalid', () => {
    const onFallback = vi.fn();
    const skills = invalidOverride();

    const result = buildRevisionPrompt(
      minimalPlan,
      'feedback',
      'thread-1',
      { projectId: 'project-1' },
      { skills, onFallback },
    );

    expect(result).toContain('feedback');
    expect(onFallback).toHaveBeenCalledWith(
      'plan-revision',
      expect.objectContaining({ code: 'no_frontmatter' }),
    );
    expect(skills.markQuarantined).toHaveBeenCalled();
  });
});

describe('buildPreviousAttemptContext', () => {
  it('keeps short previous output verbatim and truncates long output from the front', () => {
    expect(buildPreviousAttemptContext('short failed output')).toContain('short failed output');

    const long = `${'x'.repeat(2100)}tail`;
    const context = buildPreviousAttemptContext(long);
    expect(context).toContain('[…truncated…]');
    expect(context).toContain('tail');
    expect(context).not.toContain('x'.repeat(2100));
  });
});

describe('formatClarificationContext', () => {
  it('formats selected choices and freeform notes while skipping unanswered questions', () => {
    const result = formatClarificationContext(
      {
        id: 'clarify-1',
        threadId: 'thread-1',
        phase: 'plan',
        summary: 'Need product direction',
        questions: [
          {
            id: 'q1',
            title: 'Storage',
            prompt: 'Where should data live?',
            description: null,
            choices: [
              {
                id: 'local',
                label: 'Local',
                description: 'Store data locally',
                recommended: true,
              },
            ],
            allowFreeform: true,
            freeformPlaceholder: null,
          },
          {
            id: 'q2',
            title: 'Skipped',
            prompt: 'No answer',
            description: null,
            choices: [],
            allowFreeform: false,
            freeformPlaceholder: null,
          },
        ],
      },
      [{ questionId: 'q1', selectedChoiceId: 'local', freeformText: ' Keep exports fast. ' }],
    );

    expect(result).toContain('Clarification request: Need product direction');
    expect(result).toContain('Storage: Where should data live?');
    expect(result).toContain('Selected option: Local');
    expect(result).toContain('Option detail: Store data locally');
    expect(result).toContain('Extra note: Keep exports fast.');
    expect(result).not.toContain('Skipped');
  });

  it('formats answered questions without selected choices or freeform notes', () => {
    const result = formatClarificationContext(
      {
        id: 'clarify-1',
        threadId: 'thread-1',
        phase: 'plan',
        summary: 'Need product direction',
        questions: [
          {
            id: 'q1',
            title: 'Storage',
            prompt: 'Where should data live?',
            description: null,
            choices: [{ id: 'local', label: 'Local', description: 'Store data locally' }],
            allowFreeform: true,
            freeformPlaceholder: null,
          },
        ],
      },
      [{ questionId: 'q1', selectedChoiceId: 'missing-choice', freeformText: '   ' }],
    );

    expect(result).toContain('Storage: Where should data live?');
    expect(result).not.toContain('Selected option:');
    expect(result).not.toContain('Extra note:');
  });

  it('returns null without a request or without answers', () => {
    expect(formatClarificationContext(null, [])).toBeNull();
    expect(
      formatClarificationContext(
        {
          id: 'clarify-1',
          threadId: 'thread-1',
          phase: 'plan',
          summary: 'Need direction',
          questions: [],
        },
        [],
      ),
    ).toBeNull();
  });
});
