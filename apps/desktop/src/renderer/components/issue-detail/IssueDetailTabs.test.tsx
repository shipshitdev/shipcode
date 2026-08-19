// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type { GitHubIssueCacheRecord, ReviewFindingRecord } from '@shipcode/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IssueDetailTabs } from './IssueDetailTabs';

vi.mock('./CommentsTab', () => ({ CommentsTab: () => <div>comments tab</div> }));
vi.mock('./ConsoleTab', () => ({ ConsoleTab: () => <div>console tab</div> }));
vi.mock('./ConversationsTab', () => ({ ConversationsTab: () => <div>conversations tab</div> }));
vi.mock('./DiffTab', () => ({ DiffTab: () => <div>diff tab</div> }));
vi.mock('./FindingsTab', () => ({ FindingsTab: () => <div>findings tab</div> }));
vi.mock('./IssueHistoryTab', () => ({ IssueHistoryTab: () => <div>activity tab</div> }));
vi.mock('./PlanHistoryTab', () => ({ PlanHistoryTab: () => <div>history tab</div> }));
vi.mock('./PrdTab', () => ({ PrdTab: () => <div>issue tab</div> }));
vi.mock('./RunsTab', () => ({ RunsTab: () => <div>runs tab</div> }));

afterEach(() => {
  cleanup();
});

function makeIssue(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return {
    id: 'issue-196',
    projectId: 'project-1',
    issueNumber: 196,
    title: 'Add issue Chat tab',
    body: 'Issue body',
    labels: ['enhancement'],
    assignee: null,
    state: 'open',
    pipelineStatus: 'todo',
    threadId: 'thread-1',
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
    fetchedAt: '2026-06-01T00:00:00.000Z',
    priorityRank: null,
    priorityRaw: null,
    priorityFetchedAt: null,
    isQuickMode: false,
    ...overrides,
  };
}

function makeFinding(overrides: Partial<ReviewFindingRecord> = {}): ReviewFindingRecord {
  return {
    id: 'finding-1',
    projectId: 'project-1',
    threadId: 'thread-1',
    planId: 'plan-1',
    reviewId: 'review-1',
    verificationId: null,
    runId: null,
    phase: 'review',
    source: 'review',
    severity: 'major',
    status: 'open',
    title: 'Missing regression test',
    description: 'Add coverage for the retry path.',
    suggestion: null,
    filePath: null,
    fingerprint: 'finding-1',
    sourceModel: 'claude',
    commitSha: null,
    prNumber: null,
    worktreePath: null,
    branch: null,
    metadata: null,
    resolvedByRunId: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

function renderTabs(
  activeThreadId: string | null = 'thread-1',
  reviewFindings: ReviewFindingRecord[] = [],
) {
  return render(
    <IssueDetailTabs
      activeIssue={makeIssue({ threadId: activeThreadId })}
      activeTab="chat"
      activeThreadId={activeThreadId}
      approvedAwaitingExecution={false}
      checkpoints={[]}
      currentPhaseSelections={{} as never}
      diffs={[]}
      effectiveExpanded={null}
      executorEditable={false}
      hasPrFeedbackBlockers={false}
      isRefreshingFromGithub={false}
      isSubmitting={false}
      isShowingAllPlanRuns={false}
      effectiveRequireApproval={false}
      effectiveRevisionCount={0}
      inheritedRequireApproval={false}
      inheritedRevisionCount={0}
      loadingPlanDetailIds={[]}
      normalizedIssueActivity={[]}
      normalizedPlanHistory={[]}
      reviewFindings={reviewFindings}
      normalizedReviewsByPlanId={{}}
      normalizedThreadPlanHistory={[]}
      isPlanHistoryLoading={false}
      currentPhaseReasoningEfforts={{} as never}
      inheritedPhaseReasoningEfforts={{} as never}
      phaseEffortSelectValues={{} as never}
      phaseModelValidation={{}}
      phaseSelectValues={{} as never}
      requireApprovalSelectValue="false"
      revisionCountSelectValue="0"
      planHistoryCollapsed={false}
      planRunCount={0}
      planRunGroups={[]}
      projectDefaultPhaseSelections={{} as never}
      qaResults={[]}
      runNumberByThreadId={{}}
      taskGraph={null}
      thread={null}
      threadPhase="idle"
      githubIssueUrl={null}
      projectId="project-1"
      onEditPrd={() => undefined}
      onActiveTabChange={() => undefined}
      onFullScreenPlan={() => undefined}
      onPhaseAgentChange={() => undefined}
      onPhaseEffortChange={() => undefined}
      onRequireApprovalChange={() => undefined}
      onRevisionCountChange={() => undefined}
      onPhaseOpenRouterSlugBlur={() => undefined}
      onPlanExpandedChange={() => undefined}
      onPlanHistoryCollapsedChange={() => undefined}
      onShowAllPlanRunsChange={() => undefined}
      onRefreshFromGithub={() => undefined}
      onRestoreCheckpoint={() => undefined}
      onStabilizePr={() => undefined}
    />,
  );
}

describe('IssueDetailTabs', () => {
  it('renders issue context cards without a conversation tab', () => {
    const { unmount } = renderTabs('thread-1');

    expect(screen.getByTestId('issue-context-cards')).toBeInTheDocument();
    expect(screen.getByTestId('issue-context-prd')).toBeInTheDocument();
    expect(screen.getByText('issue tab')).toBeInTheDocument();
    expect(screen.queryByTestId('conversation-surface')).not.toBeInTheDocument();

    unmount();
    renderTabs(null);

    expect(screen.getByTestId('issue-context-prd')).toBeInTheDocument();
    expect(screen.queryByTestId('issue-context-findings')).not.toBeInTheDocument();
  });

  it('shows the open review finding count on the Findings card', () => {
    renderTabs('thread-1', [
      makeFinding(),
      makeFinding({ id: 'finding-2', fingerprint: 'finding-2', status: 'fixed' }),
    ]);

    expect(within(screen.getByTestId('issue-context-findings')).getByText('1')).toBeInTheDocument();
  });
});
