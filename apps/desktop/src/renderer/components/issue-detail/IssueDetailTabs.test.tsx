// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IssueDetailTabs } from './IssueDetailTabs';

vi.mock('./CommentsTab', () => ({ CommentsTab: () => <div>comments tab</div> }));
vi.mock('./ConsoleTab', () => ({ ConsoleTab: () => <div>console tab</div> }));
vi.mock('./ConversationsTab', () => ({ ConversationsTab: () => <div>conversations tab</div> }));
vi.mock('./DiffTab', () => ({ DiffTab: () => <div>diff tab</div> }));
vi.mock('./FindingsTab', () => ({ FindingsTab: () => <div>findings tab</div> }));
vi.mock('./IssueHistoryTab', () => ({ IssueHistoryTab: () => <div>activity tab</div> }));
vi.mock('./IssueChatTab', () => ({
  IssueChatTab: ({ threadId }: { threadId: string }) => <div>chat tab {threadId}</div>,
}));
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

function renderTabs(activeThreadId: string | null = 'thread-1') {
  return render(
    <IssueDetailTabs
      activeIssue={makeIssue({ threadId: activeThreadId })}
      activeTab={activeThreadId ? 'chat' : 'prd'}
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
      reviewFindings={[]}
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
  it('shows the issue Chat tab only when the issue has an active thread', () => {
    const { unmount } = renderTabs('thread-1');

    expect(screen.getByRole('tab', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByText('chat tab thread-1')).toBeInTheDocument();

    unmount();
    renderTabs(null);

    expect(screen.queryByRole('tab', { name: 'Chat' })).not.toBeInTheDocument();
  });
});
