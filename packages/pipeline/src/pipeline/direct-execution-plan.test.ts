import { describe, expect, it } from 'vitest';
import { synthesizeDirectExecutionPlan } from './direct-execution-plan';

describe('synthesizeDirectExecutionPlan', () => {
  it('builds the quick-task plan contract', () => {
    const plan = synthesizeDirectExecutionPlan({
      source: 'quick-task',
      threadId: 'thread-1',
      title: 'Tighten validation',
      text: 'Reject empty project names before persistence.',
    });

    expect(plan).toMatchObject({
      threadId: 'thread-1',
      version: 1,
      objective: 'Quick: Tighten validation',
      files: [],
      steps: [
        {
          order: 1,
          description:
            'Quick task: Tighten validation\n\nReject empty project names before persistence.',
          files: [],
          rationale: 'Quick task — executed directly without plan/review.',
        },
      ],
      acceptanceCriteria: [
        'Implements: Tighten validation',
        'Satisfies instructions: Reject empty project names before persistence.',
      ],
      outOfScope: [],
      estimatedComplexity: 'low',
      dependencies: [],
    });
    expect(plan.id).toEqual(expect.any(String));
  });

  it('builds the automation plan contract', () => {
    const plan = synthesizeDirectExecutionPlan({
      source: 'automation',
      threadId: 'thread-2',
      name: 'Nightly cleanup',
      prompt: 'Remove stale temporary branches and report the result.',
    });

    expect(plan).toMatchObject({
      threadId: 'thread-2',
      version: 1,
      objective: 'Automation: Nightly cleanup',
      steps: [
        {
          order: 1,
          description: 'Remove stale temporary branches and report the result.',
          rationale: 'Automation prompt — executed directly without plan/review.',
        },
      ],
      acceptanceCriteria: [
        'Implements automation: Nightly cleanup',
        'Satisfies prompt: Remove stale temporary branches and report the result.',
      ],
      estimatedComplexity: 'medium',
    });
  });

  it('omits the instruction criterion for short direct-execution input', () => {
    const plan = synthesizeDirectExecutionPlan({
      source: 'quick-task',
      threadId: 'thread-3',
      title: 'Small task',
      text: 'Keep it small.',
    });

    expect(plan.acceptanceCriteria).toEqual(['Implements: Small task']);
  });

  it('trims and bounds the generated instruction criterion', () => {
    const prompt = `  ${'x'.repeat(240)}  `;
    const plan = synthesizeDirectExecutionPlan({
      source: 'automation',
      threadId: 'thread-4',
      name: 'Bound prompt',
      prompt,
    });

    expect(plan.steps[0]?.description).toBe(prompt);
    expect(plan.acceptanceCriteria).toEqual([
      'Implements automation: Bound prompt',
      `Satisfies prompt: ${'x'.repeat(200)}`,
    ]);
  });
});
