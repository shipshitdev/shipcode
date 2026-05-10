import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineContext } from '../types';
import {
  buildClarificationContext,
  clearRetryTimer,
  formatPlanParseFailure,
} from './planning-phases';

function clarificationRequest(id: string, questionId: string, title: string) {
  return {
    id,
    threadId: 'thread-1',
    phase: 'plan' as const,
    summary: `Need ${title}`,
    questions: [
      {
        id: questionId,
        title,
        prompt: `Choose ${title}`,
        description: null,
        choices: [
          {
            id: 'a',
            label: `${title} A`,
            description: `Use ${title} A`,
          },
        ],
        allowFreeform: true,
        freeformPlaceholder: null,
      },
    ],
  };
}

describe('planning phase helpers', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('clears retry timers when present and no-ops without one', () => {
    vi.useFakeTimers();
    const timer = setTimeout(() => {}, 1000);
    const context = { retryTimer: timer } as PipelineContext;

    clearRetryTimer(context);
    expect(context.retryTimer).toBeNull();

    clearRetryTimer(context);
    expect(context.retryTimer).toBeNull();
  });

  it('formats plan parse failures with default and clamped diagnostics', () => {
    expect(formatPlanParseFailure()).toBe(
      'Plan generation failed — no valid shipcode-plan block was produced.',
    );
    expect(formatPlanParseFailure(`bad json\n${'x'.repeat(400)}`)).toBe(
      'Plan output could not be parsed — bad json',
    );
    expect(formatPlanParseFailure('x'.repeat(400))).toHaveLength(
      'Plan output could not be parsed — '.length + 280,
    );
  });

  it('builds clarification context from history before current request', () => {
    const context = {
      clarificationHistory: [
        {
          request: clarificationRequest('clarify-1', 'brand', 'Brand'),
          answers: [{ questionId: 'brand', selectedChoiceId: 'a', freeformText: 'Fast.' }],
        },
      ],
      clarificationRequest: clarificationRequest('clarify-2', 'tone', 'Tone'),
      clarificationAnswers: [{ questionId: 'tone', selectedChoiceId: 'a', freeformText: 'Quiet.' }],
    } as PipelineContext;

    const result = buildClarificationContext(context);

    expect(result).toContain('Clarification round 1');
    expect(result).toContain('Need Brand');
    expect(result).toContain('Extra note: Fast.');
    expect(result).not.toContain('Need Tone');
  });

  it('skips unanswered clarification history and tolerates missing history arrays', () => {
    const fromMissingHistory = buildClarificationContext({
      clarificationRequest: clarificationRequest('clarify-1', 'storage', 'Storage'),
      clarificationAnswers: [
        { questionId: 'storage', selectedChoiceId: null, freeformText: 'SQLite.' },
      ],
    } as PipelineContext);

    expect(fromMissingHistory).toContain('Need Storage');
    expect(fromMissingHistory).toContain('SQLite.');

    const fromEmptyHistoryEntry = buildClarificationContext({
      clarificationHistory: [
        {
          request: clarificationRequest('clarify-2', 'tone', 'Tone'),
          answers: [],
        },
      ],
      clarificationRequest: null,
      clarificationAnswers: [],
    } as unknown as PipelineContext);

    expect(fromEmptyHistoryEntry).toBeNull();
  });

  it('falls back to current clarification answers and returns null without answers', () => {
    const current = buildClarificationContext({
      clarificationHistory: [],
      clarificationRequest: clarificationRequest('clarify-1', 'storage', 'Storage'),
      clarificationAnswers: [
        { questionId: 'storage', selectedChoiceId: 'a', freeformText: 'Local first.' },
      ],
    } as PipelineContext);

    expect(current).toContain('Need Storage');
    expect(current).toContain('Local first.');

    expect(
      buildClarificationContext({
        clarificationHistory: [],
        clarificationRequest: null,
        clarificationAnswers: [],
      } as PipelineContext),
    ).toBeNull();
  });
});
