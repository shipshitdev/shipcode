// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IssueHoverCard } from '@/kanban-board/IssueHoverCard';
import type { IssuePhaseChip, PlanStepSummary } from '@/kanban-board/types';
import { makeIssue, renderIntoDom } from './test-helpers';

function makeStep(overrides: Partial<PlanStepSummary>): PlanStepSummary {
  return {
    id: 'step-1',
    order: 1,
    title: 'Step',
    status: 'ready',
    agentRole: 'general',
    ...overrides,
  };
}

async function hover(container: HTMLElement) {
  const trigger = container.querySelector('[data-testid="hover-target"]');
  if (!(trigger instanceof HTMLElement)) {
    throw new Error('Expected hover target');
  }

  act(() => {
    trigger.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 360));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('IssueHoverCard rendering', () => {
  it('renders non-active issue metadata, badges, and body snippets on hover', async () => {
    const view = renderIntoDom(
      <IssueHoverCard
        issue={makeIssue({
          issueNumber: 17,
          title: 'Review compact hover details',
          body: 'Show the [hover card](https://example.com) details with `badges`.',
          assignee: 'decod3rs',
          labels: ['agent:ui-dev'],
          lastPhaseUpdate: '2026-05-09T10:00:00.000Z',
          linkedPrNumber: 44,
          linkedPrIsDraft: true,
          ciBlocked: true,
          unresolvedReviewCommentCount: 2,
          priorityRank: 'p0',
          priorityRaw: 'P0',
        })}
      >
        <button type="button" data-testid="hover-target">
          Hover
        </button>
      </IssueHoverCard>,
    );

    await hover(view.container);

    expect(document.body.textContent).toContain('#17');
    expect(document.body.textContent).toContain('Review compact hover details');
    expect(document.body.textContent).toContain('Show the hover card details with badges.');
    expect(document.body.textContent).toContain('P0');
    expect(document.body.textContent).toContain('Draft PR #44');
    expect(document.body.textContent).toContain('CI blocked');
    expect(document.body.textContent).toContain('2 reviews');
    expect(document.body.textContent).toContain('ui-dev');
    expect(document.body.textContent).toContain('@decod3rs');
    expect(document.body.textContent).toContain('Last activity');

    view.cleanup();
  });

  it('loads, sorts, and truncates plan steps for active issues', async () => {
    const steps: PlanStepSummary[] = [
      makeStep({ id: 'step-3', order: 3, title: 'Third step', status: 'failed' }),
      makeStep({ id: 'step-1', order: 1, title: 'First step', status: 'running' }),
      makeStep({ id: 'step-2', order: 2, title: 'Second step', status: 'completed' }),
      makeStep({ id: 'step-4', order: 4, title: 'Fourth step', status: 'ready' }),
      makeStep({ id: 'step-5', order: 5, title: 'Fifth step', status: 'pending' }),
      makeStep({ id: 'step-6', order: 6, title: 'Sixth step', status: 'blocked' }),
      makeStep({ id: 'step-7', order: 7, title: 'Seventh step', status: 'ready' }),
      makeStep({ id: 'step-8', order: 8, title: 'Eighth step', status: 'pending' }),
      makeStep({ id: 'step-9', order: 9, title: 'Hidden step', status: 'ready' }),
    ];
    let resolveSteps: (value: PlanStepSummary[]) => void = () => {};
    const onFetchPlanSteps = vi.fn<() => Promise<PlanStepSummary[] | null>>(
      () =>
        new Promise((resolve) => {
          resolveSteps = resolve;
        }),
    );
    const phaseChip: IssuePhaseChip = {
      phase: 'executor',
      provider: 'openrouter',
      model: 'gpt-5.4',
      effort: 'high',
    };

    const view = renderIntoDom(
      <IssueHoverCard
        issue={makeIssue({
          issueNumber: 21,
          title: 'Executing hover issue',
          pipelineStatus: 'executing',
          threadId: 'thread-21',
          lastPhaseUpdate: '2026-05-09T10:00:00.000Z',
        })}
        phaseChip={phaseChip}
        onFetchPlanSteps={onFetchPlanSteps}
      >
        <button type="button" data-testid="hover-target">
          Hover
        </button>
      </IssueHoverCard>,
    );

    await hover(view.container);

    expect(onFetchPlanSteps).toHaveBeenCalledWith('thread-21');
    expect(document.body.textContent).toContain('Loading plan');

    await act(async () => {
      resolveSteps(steps);
      await Promise.resolve();
    });

    const text = document.body.textContent ?? '';
    expect(text.indexOf('First step')).toBeLessThan(text.indexOf('Second step'));
    expect(text).toContain('Third step');
    expect(text).toContain('+ 1 more');
    expect(text).not.toContain('Hidden step');
    expect(text).toContain('GPT-5.4 · high');
    expect(text).toContain('72%');
    expect(text).toContain('Running');

    view.cleanup();
  });

  it('shows planning progress while active planning steps are not ready', async () => {
    const onFetchPlanSteps = vi.fn<() => Promise<PlanStepSummary[] | null>>(async () => null);
    const view = renderIntoDom(
      <IssueHoverCard
        issue={makeIssue({
          title: 'Planning hover issue',
          body: 'Planning body should be hidden behind progress copy.',
          pipelineStatus: 'planning',
          threadId: 'thread-planning',
        })}
        onFetchPlanSteps={onFetchPlanSteps}
      >
        <button type="button" data-testid="hover-target">
          Hover
        </button>
      </IssueHoverCard>,
    );

    await hover(view.container);
    await act(async () => {
      await Promise.resolve();
    });

    expect(onFetchPlanSteps).toHaveBeenCalledWith('thread-planning');
    expect(document.body.textContent).toContain('Planning in progress');
    expect(document.body.textContent).not.toContain('Planning body should be hidden');

    view.cleanup();
  });

  it('renders active issue details without fetching plan steps when no loader is supplied', async () => {
    const view = renderIntoDom(
      <IssueHoverCard
        issue={makeIssue({
          title: 'Active issue without loader',
          body: 'Fallback body is still available.',
          pipelineStatus: 'executing',
          threadId: 'thread-no-loader',
        })}
      >
        <button type="button" data-testid="hover-target">
          Hover
        </button>
      </IssueHoverCard>,
    );

    await hover(view.container);

    expect(document.body.textContent).toContain('Active issue without loader');
    expect(document.body.textContent).toContain('Fallback body is still available.');
    view.cleanup();
  });

  it('falls back to the body snippet when active plan steps resolve empty', async () => {
    const onFetchPlanSteps = vi.fn<() => Promise<PlanStepSummary[] | null>>(async () => []);
    const view = renderIntoDom(
      <IssueHoverCard
        issue={makeIssue({
          title: 'Executing fallback issue',
          body: 'Use the issue body when no graph steps exist.',
          pipelineStatus: 'executing',
          threadId: 'thread-empty',
        })}
        onFetchPlanSteps={onFetchPlanSteps}
      >
        <button type="button" data-testid="hover-target">
          Hover
        </button>
      </IssueHoverCard>,
    );

    await hover(view.container);
    await act(async () => {
      await Promise.resolve();
    });

    expect(onFetchPlanSteps).toHaveBeenCalledWith('thread-empty');
    expect(document.body.textContent).toContain('Use the issue body when no graph steps exist.');

    view.cleanup();
  });

  it('ignores plan-step resolution after unmount', async () => {
    let resolveSteps: (value: PlanStepSummary[]) => void = () => {};
    const onFetchPlanSteps = vi.fn<() => Promise<PlanStepSummary[] | null>>(
      () =>
        new Promise((resolve) => {
          resolveSteps = resolve;
        }),
    );
    const view = renderIntoDom(
      <IssueHoverCard
        issue={makeIssue({
          title: 'Unmounted plan steps',
          pipelineStatus: 'executing',
          threadId: 'thread-unmount',
        })}
        onFetchPlanSteps={onFetchPlanSteps}
      >
        <button type="button" data-testid="hover-target">
          Hover
        </button>
      </IssueHoverCard>,
    );

    await hover(view.container);
    expect(onFetchPlanSteps).toHaveBeenCalledWith('thread-unmount');

    view.cleanup();
    await act(async () => {
      resolveSteps([makeStep({ title: 'Late step' })]);
      await Promise.resolve();
    });

    expect(document.body.textContent).not.toContain('Late step');
  });

  it('ignores plan-step failures after unmount', async () => {
    let rejectSteps: (error: Error) => void = () => {};
    const onFetchPlanSteps = vi.fn<() => Promise<PlanStepSummary[] | null>>(
      () =>
        new Promise((_resolve, reject) => {
          rejectSteps = reject;
        }),
    );
    const view = renderIntoDom(
      <IssueHoverCard
        issue={makeIssue({
          title: 'Unmounted failed plan steps',
          pipelineStatus: 'executing',
          threadId: 'thread-unmount-fail',
        })}
        onFetchPlanSteps={onFetchPlanSteps}
      >
        <button type="button" data-testid="hover-target">
          Hover
        </button>
      </IssueHoverCard>,
    );

    await hover(view.container);
    expect(onFetchPlanSteps).toHaveBeenCalledWith('thread-unmount-fail');

    view.cleanup();
    await act(async () => {
      rejectSteps(new Error('late failure'));
      await Promise.resolve();
    });

    expect(document.body.textContent).not.toContain('Unmounted failed plan steps');
  });

  it('keeps disabled hover cards closed and avoids plan-step fetches', async () => {
    const onFetchPlanSteps = vi.fn<() => Promise<PlanStepSummary[] | null>>();
    const view = renderIntoDom(
      <IssueHoverCard
        disabled
        issue={makeIssue({
          title: 'Disabled hover issue',
          pipelineStatus: 'planning',
          threadId: 'thread-disabled',
        })}
        onFetchPlanSteps={onFetchPlanSteps}
      >
        <button type="button" data-testid="hover-target">
          Hover
        </button>
      </IssueHoverCard>,
    );

    await hover(view.container);

    expect(document.body.textContent).not.toContain('Disabled hover issue');
    expect(onFetchPlanSteps).not.toHaveBeenCalled();

    view.cleanup();
  });

  it('cancels delayed opening on pointer leave before fetching plan steps', async () => {
    const onFetchPlanSteps = vi.fn<() => Promise<PlanStepSummary[] | null>>(async () => []);
    const view = renderIntoDom(
      <IssueHoverCard
        issue={makeIssue({
          title: 'Pointer leave issue',
          pipelineStatus: 'executing',
          threadId: 'thread-leave',
        })}
        onFetchPlanSteps={onFetchPlanSteps}
      >
        <button type="button" data-testid="hover-target">
          Hover
        </button>
      </IssueHoverCard>,
    );

    const trigger = view.container.querySelector('[data-testid="hover-target"]');
    if (!(trigger instanceof HTMLElement)) throw new Error('Expected hover target');

    act(() => {
      trigger.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
      trigger.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 360));
    });

    expect(document.body.textContent).not.toContain('Pointer leave issue');
    expect(onFetchPlanSteps).not.toHaveBeenCalled();
    view.cleanup();
  });

  it('handles pointer leave before any delayed open is scheduled', () => {
    const view = renderIntoDom(
      <IssueHoverCard issue={makeIssue({ title: 'Leave without enter' })}>
        <button type="button" data-testid="hover-target">
          Hover
        </button>
      </IssueHoverCard>,
    );

    const trigger = view.container.querySelector('[data-testid="hover-target"]');
    if (!(trigger instanceof HTMLElement)) throw new Error('Expected hover target');

    act(() => {
      trigger.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }));
    });

    expect(document.body.textContent).not.toContain('Leave without enter');
    view.cleanup();
  });

  it('clears loading state when plan-step loading fails', async () => {
    const onFetchPlanSteps = vi.fn<() => Promise<PlanStepSummary[] | null>>(async () => {
      throw new Error('steps unavailable');
    });
    const view = renderIntoDom(
      <IssueHoverCard
        issue={makeIssue({
          title: 'Failing plan steps',
          pipelineStatus: 'executing',
          threadId: 'thread-fail',
        })}
        onFetchPlanSteps={onFetchPlanSteps}
      >
        <button type="button" data-testid="hover-target">
          Hover
        </button>
      </IssueHoverCard>,
    );

    await hover(view.container);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onFetchPlanSteps).toHaveBeenCalledWith('thread-fail');
    expect(document.body.textContent).toContain('Failing plan steps');
    expect(document.body.textContent).not.toContain('Loading plan');
    view.cleanup();
  });

  it('renders non-element children without hover handlers', async () => {
    const view = renderIntoDom(
      <IssueHoverCard issue={makeIssue({ title: 'Plain child issue' })}>
        Plain text child
      </IssueHoverCard>,
    );

    expect(document.body.textContent).not.toContain('Plain child issue');
    view.cleanup();
  });

  it('renders singular review copy', async () => {
    const view = renderIntoDom(
      <IssueHoverCard
        issue={makeIssue({
          title: 'One review issue',
          unresolvedReviewCommentCount: 1,
        })}
      >
        <button type="button" data-testid="hover-target">
          Hover
        </button>
      </IssueHoverCard>,
    );

    await hover(view.container);

    expect(document.body.textContent).toContain('1 review');
    expect(document.body.textContent).not.toContain('1 reviews');
    view.cleanup();
  });
});
