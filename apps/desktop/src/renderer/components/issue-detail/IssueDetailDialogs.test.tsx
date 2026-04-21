// @vitest-environment jsdom

import type { PlanRecord } from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IssueDetailDialogs } from './IssueDetailDialogs';

const planRecord: PlanRecord = {
  id: 'plan-1',
  threadId: 'thread-1',
  version: 1,
  rawOutput: 'raw plan output',
  structured: null,
  status: 'awaiting_approval',
  createdAt: '2026-04-20T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
});

describe('IssueDetailDialogs', () => {
  it('runs approve-and-close on cmd-enter in the full-screen plan modal', () => {
    const onApprove = vi.fn();
    const onCloseFullScreenPlan = vi.fn();

    render(
      <IssueDetailDialogs
        activeIssueNumber={42}
        canApprove
        fullScreenPlan={planRecord}
        fullScreenPlanId="plan-1"
        fullScreenReview={undefined}
        isFullScreenPlanLoading={false}
        isSubmitting={false}
        latestPlanId="plan-1"
        onApprove={onApprove}
        onArchiveConfirmed={vi.fn()}
        onCloseArchiveConfirm={vi.fn()}
        onCloseFullScreenPlan={onCloseFullScreenPlan}
        onMarkAsDoneConfirmed={vi.fn()}
        onCloseMarkAsDoneConfirm={vi.fn()}
        showArchiveConfirm={false}
        showMarkAsDoneConfirm={false}
      />,
    );

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', metaKey: true });

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onCloseFullScreenPlan).toHaveBeenCalledTimes(1);
  });

  it('archives on cmd-enter in the archive confirmation modal', () => {
    const onArchiveConfirmed = vi.fn();

    render(
      <IssueDetailDialogs
        activeIssueNumber={42}
        canApprove={false}
        fullScreenPlan={null}
        fullScreenPlanId={null}
        fullScreenReview={undefined}
        isFullScreenPlanLoading={false}
        isSubmitting={false}
        latestPlanId={null}
        onApprove={vi.fn()}
        onArchiveConfirmed={onArchiveConfirmed}
        onCloseArchiveConfirm={vi.fn()}
        onCloseFullScreenPlan={vi.fn()}
        onMarkAsDoneConfirmed={vi.fn()}
        onCloseMarkAsDoneConfirm={vi.fn()}
        showArchiveConfirm
        showMarkAsDoneConfirm={false}
      />,
    );

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', metaKey: true });

    expect(onArchiveConfirmed).toHaveBeenCalledTimes(1);
  });

  it('marks as done on cmd-enter in the done confirmation modal', () => {
    const onMarkAsDoneConfirmed = vi.fn();

    render(
      <IssueDetailDialogs
        activeIssueNumber={42}
        canApprove={false}
        fullScreenPlan={null}
        fullScreenPlanId={null}
        fullScreenReview={undefined}
        isFullScreenPlanLoading={false}
        isSubmitting={false}
        latestPlanId={null}
        onApprove={vi.fn()}
        onArchiveConfirmed={vi.fn()}
        onCloseArchiveConfirm={vi.fn()}
        onCloseFullScreenPlan={vi.fn()}
        onMarkAsDoneConfirmed={onMarkAsDoneConfirmed}
        onCloseMarkAsDoneConfirm={vi.fn()}
        showArchiveConfirm={false}
        showMarkAsDoneConfirm
      />,
    );

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', metaKey: true });

    expect(onMarkAsDoneConfirmed).toHaveBeenCalledTimes(1);
  });
});
