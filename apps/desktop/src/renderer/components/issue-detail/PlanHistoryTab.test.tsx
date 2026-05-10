// @vitest-environment jsdom

import type { PlanRecord, ReviewRecord } from '@shipcode/shared';
import { PIPELINE_PHASE } from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanHistoryTab } from './PlanHistoryTab';
import type { PlanRunGroup } from './tab-types';

vi.mock('@shipcode/ui', () => ({
  PhaseChip: ({ label }: { label: string }) => <span data-testid="phase-chip">{label}</span>,
  PlanViewer: ({ plan }: { plan: { objective?: string } }) => (
    <div data-testid="plan-viewer">{plan.objective}</div>
  ),
  ReviewViewer: ({ review }: { review: { summary?: string } }) => (
    <div data-testid="review-viewer">{review.summary}</div>
  ),
}));

vi.mock('./PlanWaiting', () => ({
  PlanWaiting: ({ threadId }: { threadId: string }) => (
    <div data-testid="plan-waiting">waiting {threadId}</div>
  ),
}));

const structuredPlan = {
  id: 'plan-1',
  threadId: 'thread-1',
  version: 1,
  objective: 'Structured objective',
  files: [],
  steps: [],
  acceptanceCriteria: [],
};

function makePlan(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: 'plan-1',
    threadId: 'thread-1',
    version: 1,
    rawOutput: '',
    status: 'pending_review',
    structured: structuredPlan,
    createdAt: '2026-05-09T00:00:00.000Z',
    ...overrides,
  } as PlanRecord;
}

function makeReview(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: 'review-1',
    planId: 'plan-1',
    threadId: 'thread-1',
    verdict: 'approved',
    rawOutput: '',
    structured: {
      verdict: 'approved',
      summary: 'Looks good',
      findings: [],
    },
    createdAt: '2026-05-09T00:00:00.000Z',
    ...overrides,
  } as ReviewRecord;
}

function baseProps(overrides: Partial<Parameters<typeof PlanHistoryTab>[0]> = {}) {
  const plan = makePlan();
  const planRunGroups: PlanRunGroup[] = [
    {
      threadId: 'thread-1',
      runNumber: 2,
      isCurrentRun: true,
      plans: [plan],
    },
  ];

  return {
    activeThreadId: 'thread-1',
    effectiveExpanded: null,
    isPlanHistoryLoading: false,
    isShowingAllPlanRuns: false,
    loadingPlanDetailIds: [],
    normalizedPlanHistory: [plan],
    normalizedReviewsByPlanId: {},
    normalizedThreadPlanHistory: [plan],
    planHistoryCollapsed: false,
    planRunCount: 1,
    planRunGroups,
    threadPhase: PIPELINE_PHASE.planning,
    onFullScreenPlan: vi.fn(),
    onPlanExpandedChange: vi.fn(),
    onPlanHistoryCollapsedChange: vi.fn(),
    onShowAllPlanRunsChange: vi.fn(),
    ...overrides,
  };
}

function renderTab(props: ReturnType<typeof baseProps>) {
  render(<PlanHistoryTab {...props} />);
}

afterEach(() => {
  cleanup();
});

describe('PlanHistoryTab', () => {
  it('routes collapse, scope, fullscreen, and expand callbacks', () => {
    const props = baseProps({ planRunCount: 2 });

    renderTab(props);

    fireEvent.click(screen.getAllByRole('button', { name: 'Collapse plans' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'View all runs' }));
    fireEvent.click(screen.getByRole('button', { name: 'View plan full screen' }));
    fireEvent.click(screen.getByRole('button', { name: /v1/ }));

    expect(props.onPlanHistoryCollapsedChange).toHaveBeenCalledWith(true);
    expect(props.onShowAllPlanRunsChange).toHaveBeenCalledWith(true);
    expect(props.onFullScreenPlan).toHaveBeenCalledWith('plan-1');
    expect(props.onPlanExpandedChange).toHaveBeenCalledWith('plan-1');
    expect(screen.getByText('Plans (1 version across 2 runs)')).toBeInTheDocument();
  });

  it('renders expanded structured plan and review, and collapses an already-expanded plan', () => {
    const plan = makePlan({ status: 'superseded' });
    const props = baseProps({
      effectiveExpanded: 'plan-1',
      normalizedPlanHistory: [plan],
      normalizedReviewsByPlanId: { 'plan-1': makeReview() },
      normalizedThreadPlanHistory: [plan],
      planRunGroups: [{ threadId: 'thread-1', runNumber: 1, isCurrentRun: false, plans: [plan] }],
    });

    renderTab(props);

    expect(screen.getByTestId('plan-viewer')).toHaveTextContent('Structured objective');
    expect(screen.getByTestId('review-viewer')).toHaveTextContent('Looks good');

    fireEvent.click(screen.getByRole('button', { name: /v1/ }));

    expect(props.onPlanExpandedChange).toHaveBeenCalledWith(null);
  });

  it('renders loading and unavailable expanded detail states', () => {
    const emptyPlan = makePlan({
      id: 'plan-empty',
      rawOutput: '',
      structured: null,
      status: 'failed',
    });

    renderTab(
      baseProps({
        effectiveExpanded: 'plan-empty',
        loadingPlanDetailIds: ['plan-empty'],
        normalizedPlanHistory: [emptyPlan],
        normalizedThreadPlanHistory: [emptyPlan],
        planRunGroups: [
          { threadId: 'thread-1', runNumber: 1, isCurrentRun: true, plans: [emptyPlan] },
        ],
      }),
    );

    expect(screen.getByText('Loading plan details…')).toBeInTheDocument();
    cleanup();

    renderTab(
      baseProps({
        effectiveExpanded: 'plan-empty',
        normalizedPlanHistory: [emptyPlan],
        normalizedThreadPlanHistory: [emptyPlan],
        planRunGroups: [
          { threadId: 'thread-1', runNumber: 1, isCurrentRun: true, plans: [emptyPlan] },
        ],
      }),
    );

    expect(screen.getByText('Structured plan unavailable')).toBeInTheDocument();
    expect(
      screen.getByText('Structured plan data is unavailable for this version.'),
    ).toBeInTheDocument();
  });

  it('renders loading, waiting, failed, and no-thread empty states', () => {
    const noPlans = {
      normalizedPlanHistory: [],
      normalizedThreadPlanHistory: [],
      planRunGroups: [],
    };

    renderTab(baseProps({ ...noPlans, isPlanHistoryLoading: true }));
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    cleanup();

    renderTab(baseProps({ ...noPlans, activeThreadId: 'thread-2' }));
    expect(screen.getByTestId('plan-waiting')).toHaveTextContent('waiting thread-2');
    cleanup();

    renderTab(
      baseProps({
        ...noPlans,
        activeThreadId: 'thread-2',
        threadPhase: PIPELINE_PHASE.failed,
      }),
    );
    expect(
      screen.getByText('No plan was produced before the pipeline failed.'),
    ).toBeInTheDocument();
    cleanup();

    renderTab(baseProps({ ...noPlans, activeThreadId: null }));
    expect(
      screen.getByText('No plans generated yet. Start a pipeline to generate a plan.'),
    ).toBeInTheDocument();
  });

  it('hides run scope controls when no active thread and renders collapsed header state', () => {
    const props = baseProps({
      activeThreadId: null,
      isShowingAllPlanRuns: true,
      planHistoryCollapsed: true,
    });

    render(<PlanHistoryTab {...props} />);

    expect(screen.getAllByRole('button', { name: 'Expand plans' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Latest run only' })).not.toBeInTheDocument();
    expect(screen.queryByText('Run 2')).not.toBeInTheDocument();
  });
});
