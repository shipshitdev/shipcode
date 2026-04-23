// @vitest-environment jsdom

import type {
  GitHubIssueCacheRecord,
  PlanReview,
  ShipCodePlan,
  VerificationResult,
} from '@shipcode/shared';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { IssueCard } from './IssueCard';
import { PipelineStatus } from './PipelineStatus';
import { PlanViewer } from './PlanViewer';
import { ReviewViewer } from './ReviewViewer';
import { VerificationViewer } from './VerificationViewer';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderIntoDom(element: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return {
    container,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function makeIssue(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 19,
    title: 'Add skill registry view',
    body: null,
    labels: ['agent:claude', 'priority:high'],
    assignee: null,
    state: 'open',
    pipelineStatus: 'executing',
    threadId: null,
    claimedAt: null,
    claimedBy: null,
    lastPhaseUpdate: null,
    lastStatusLabel: null,
    plannerModelOverride: null,
    reviewerModelOverride: null,
    executorModelOverride: null,
    verifierModelOverride: null,
    plannerModelIdOverride: null,
    reviewerModelIdOverride: null,
    executorModelIdOverride: null,
    verifierModelIdOverride: null,
    plannerReasoningEffortOverride: null,
    reviewerReasoningEffortOverride: null,
    executorReasoningEffortOverride: null,
    verifierReasoningEffortOverride: null,
    revisionCountOverride: null,
    linkedPrNumber: null,
    linkedPrUrl: null,
    linkedPrIsDraft: false,
    ciBlocked: false,
    failingChecks: [],
    unresolvedReviewComments: [],
    unresolvedReviewCommentCount: 0,
    prLastSyncAt: null,
    fetchedAt: new Date('2026-04-16T00:00:00.000Z').toISOString(),
    ...overrides,
  };
}

const plan: ShipCodePlan = {
  id: 'plan-1',
  threadId: 'thread-1',
  version: 3,
  objective: 'Render board coverage details',
  files: [
    {
      path: 'packages/ui/src/PlanViewer.tsx',
      action: 'modify',
      description: 'Show plan state',
    },
    {
      path: 'packages/ui/src/new-file.ts',
      action: 'create',
      description: 'Create a helper',
    },
  ],
  steps: [
    {
      order: 1,
      description: 'Render sections',
      files: ['packages/ui/src/PlanViewer.tsx'],
      rationale: 'Users need to inspect plans',
    },
  ],
  acceptanceCriteria: ['A plan section renders'],
  outOfScope: ['Shipping'],
  estimatedComplexity: 'medium',
  dependencies: ['@shipcode/shared'],
};

const review: PlanReview = {
  planId: 'plan-1',
  summary: 'One issue needs changes before execution.',
  decision: 'request_changes',
  confidence: 'high',
  findings: [
    {
      id: 'R1',
      severity: 'major',
      category: 'correctness',
      description: 'Coverage threshold is missing.',
      suggestion: 'Add repo-wide enforcement.',
      filePath: 'scripts/coverage-summary.mjs',
    },
  ],
  suggestedChanges: ['Add the threshold gate'],
};

const verification: VerificationResult = {
  threadId: 'thread-1',
  planId: 'plan-1',
  result: 'failed',
  summary: 'One acceptance criterion is still failing.',
  criteriaResults: [
    {
      criterion: 'Coverage threshold enforced',
      passed: false,
      evidence: 'No minimum threshold configured yet.',
    },
  ],
  issues: [
    {
      severity: 'warning',
      description: 'Coverage is below the floor in one package.',
      filePath: 'packages/ui/src/PipelineStatus.tsx',
    },
  ],
};

describe('root UI components', () => {
  it('renders issue state and agent labels in the issue card', () => {
    const onClick = vi.fn();
    const view = renderIntoDom(<IssueCard issue={makeIssue()} onClick={onClick} />);

    expect(view.container.textContent).toContain('#19');
    expect(view.container.textContent).toContain('Add skill registry view');
    expect(view.container.textContent).toContain('agent:claude');
    expect(view.container.querySelector('.animate-pulse')).toBeTruthy();

    const button = view.container.querySelector('button');
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Expected issue card button');
    }
    act(() => {
      button.click();
    });

    expect(onClick).toHaveBeenCalledTimes(1);
    view.cleanup();
  });

  it('renders active and completed phases and only emits clicks for enabled phases', () => {
    const onPhaseClick = vi.fn();
    const view = renderIntoDom(
      <PipelineStatus currentPhase="reviewing" onPhaseClick={onPhaseClick} />,
    );

    expect(view.container.textContent).toContain('Plan');
    expect(view.container.textContent).toContain('Review');
    expect(view.container.textContent).not.toContain('Execute');

    const buttons = Array.from(view.container.querySelectorAll('button'));
    const planButton = buttons.find((button) => button.textContent?.includes('Plan'));
    const clarifyButton = buttons.find((button) => button.textContent?.includes('Clarify'));
    const reviewButton = buttons.find((button) => button.textContent?.includes('Review'));
    const firstFutureButton = buttons.find((button) => button.disabled);

    if (
      !(planButton instanceof HTMLButtonElement) ||
      !(clarifyButton instanceof HTMLButtonElement) ||
      !(reviewButton instanceof HTMLButtonElement) ||
      !(firstFutureButton instanceof HTMLButtonElement)
    ) {
      throw new Error('Expected completed, active, and future pipeline phase buttons');
    }

    act(() => {
      planButton.click();
      clarifyButton.click();
      reviewButton.click();
      firstFutureButton.click();
    });

    expect(onPhaseClick).toHaveBeenCalledTimes(3);
    expect(onPhaseClick).toHaveBeenNthCalledWith(1, 'planning');
    expect(onPhaseClick).toHaveBeenNthCalledWith(2, 'clarifying');
    expect(onPhaseClick).toHaveBeenNthCalledWith(3, 'reviewing');
    view.cleanup();
  });

  it('uses noun labels for passive workflow stages', () => {
    const view = renderIntoDom(<PipelineStatus currentPhase="awaiting_approval" />);

    expect(view.container.textContent).toContain('Approval');
    expect(view.container.textContent).not.toContain('Approve');

    view.cleanup();
  });

  it('renders plan details and the waiting state', () => {
    const waitingView = renderIntoDom(<PlanViewer plan={null} />);
    expect(waitingView.container.textContent).toContain('Waiting for plan generation');
    waitingView.cleanup();

    const planView = renderIntoDom(<PlanViewer plan={plan} />);
    expect(planView.container.textContent).toContain('Render board coverage details');
    expect(planView.container.textContent).toContain('Implementation Steps');
    expect(planView.container.textContent).toContain('Acceptance Criteria');
    expect(planView.container.textContent).toContain('Out of Scope');
    expect(planView.container.textContent).toContain('@shipcode/shared');
    planView.cleanup();
  });

  it('renders review details and suggestions', () => {
    const waitingView = renderIntoDom(<ReviewViewer review={null} />);
    expect(waitingView.container.textContent).toContain('Waiting for review');
    waitingView.cleanup();

    const reviewView = renderIntoDom(<ReviewViewer review={review} />);
    expect(reviewView.container.textContent).toContain('request changes');
    expect(reviewView.container.textContent).toContain('Coverage threshold is missing');
    expect(reviewView.container.textContent).toContain('Add the threshold gate');
    expect(reviewView.container.textContent).toContain('scripts/coverage-summary.mjs');
    reviewView.cleanup();
  });

  it('renders verification results, evidence, and linked issues', () => {
    const view = renderIntoDom(<VerificationViewer verification={verification} />);

    expect(view.container.textContent).toContain('Failed');
    expect(view.container.textContent).toContain('Coverage threshold enforced');
    expect(view.container.textContent).toContain('No minimum threshold configured yet.');
    expect(view.container.textContent).toContain('Coverage is below the floor in one package.');
    expect(view.container.textContent).toContain('packages/ui/src/PipelineStatus.tsx');
    view.cleanup();
  });
});
