// @vitest-environment jsdom

import type { GitHubIssueCacheRecord, PlanRecord, Project, Thread } from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { toast } from '../stores/toast-store';

vi.mock('../stores/toast-store', () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock('@shipshitdev/ui', async () => {
  const actual = await vi.importActual<typeof import('@shipshitdev/ui')>('@shipshitdev/ui');
  return {
    ...actual,
    DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DropdownMenuItem: ({
      children,
      disabled,
      onClick,
    }: {
      children: ReactNode;
      disabled?: boolean;
      onClick?: () => void;
    }) => (
      <button type="button" disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
    DropdownMenuSeparator: () => <hr />,
  };
});

vi.mock('./issue-detail/IssueDetailActions', () => ({
  buildIssueDetailActions: ({
    onApprove,
    onCancel,
    onCreatePr,
    onEditPrd,
    onMarkAsDone,
    onReject,
    onRerun,
    onShowRawOutputChange,
    onStartPipeline,
    onSubmitClarification,
    createPrError,
    retryButtonLabel,
    retrySummary,
    thread,
  }: {
    onApprove: () => void;
    onCancel: () => void;
    onCreatePr?: () => void;
    onEditPrd: () => void;
    onMarkAsDone: () => void;
    onReject: (feedback: string) => void;
    onRerun: () => void;
    onShowRawOutputChange: (show: boolean) => void;
    onStartPipeline: () => void;
    onSubmitClarification: (answers: Array<{ questionId: string; freeformText: string }>) => void;
    createPrError: string | null;
    retryButtonLabel: string;
    retrySummary: string | null;
    thread?: Thread | null;
  }) => ({
    approvalSection: (
      <div>
        {thread?.clarificationRequest ? <span>action has clarification</span> : null}
        <button type="button" onClick={onApprove}>
          action approve
        </button>
        <button type="button" onClick={() => onReject('  revise scope  ')}>
          action reject
        </button>
        <button type="button" onClick={() => onReject('   ')}>
          action reject blank
        </button>
        <button type="button" onClick={onCancel}>
          action cancel
        </button>
        <button type="button" onClick={() => onShowRawOutputChange(true)}>
          action raw
        </button>
      </div>
    ),
    clarificationSection: null,
    completionSection: (
      <div>
        <button type="button" onClick={onEditPrd}>
          action edit prd
        </button>
        <button type="button" onClick={onMarkAsDone}>
          action mark done
        </button>
        <button type="button" onClick={onCreatePr}>
          action create pr
        </button>
        <span>create pr error {createPrError ?? 'none'}</span>
        <button
          type="button"
          onClick={() => onSubmitClarification([{ questionId: 'q1', freeformText: 'Ship it' }])}
        >
          action clarify
        </button>
      </div>
    ),
    pipelineStartCard: (
      <button type="button" onClick={onStartPipeline}>
        action start
      </button>
    ),
    rerunSection: (
      <div>
        <span>retry label {retryButtonLabel}</span>
        <span>retry summary {retrySummary ?? 'none'}</span>
        <button type="button" onClick={onRerun}>
          action rerun
        </button>
      </div>
    ),
  }),
}));

vi.mock('./issue-detail/IssueDetailDialogs', () => ({
  buildIssueDetailDialogs: ({
    fullScreenPlanId,
    state,
    onApprove,
    onArchiveConfirmed,
    onCloseArchiveConfirm,
    onCloseFullScreenPlan,
    onMarkAsDoneConfirmed,
    onCloseMarkAsDoneConfirm,
  }: {
    fullScreenPlanId: string | null;
    state: {
      showArchiveConfirm: boolean;
      showMarkAsDoneConfirm: boolean;
    };
    onApprove: () => void;
    onArchiveConfirmed: () => void;
    onCloseArchiveConfirm: () => void;
    onCloseFullScreenPlan: () => void;
    onMarkAsDoneConfirmed: () => void;
    onCloseMarkAsDoneConfirm: () => void;
  }) => (
    <div>
      <button type="button" onClick={onApprove}>
        dialog approve
      </button>
      {fullScreenPlanId ? (
        <div role="dialog" aria-label="full screen plan">
          <button type="button" onClick={onCloseFullScreenPlan}>
            close fullscreen
          </button>
        </div>
      ) : null}
      {state.showArchiveConfirm ? (
        <div role="dialog" aria-label="archive confirm">
          <button type="button" onClick={onArchiveConfirmed}>
            confirm archive
          </button>
          <button type="button" onClick={onCloseArchiveConfirm}>
            close archive
          </button>
        </div>
      ) : null}
      {state.showMarkAsDoneConfirm ? (
        <div role="dialog" aria-label="done confirm">
          <button type="button" onClick={onMarkAsDoneConfirmed}>
            confirm done
          </button>
          <button type="button" onClick={onCloseMarkAsDoneConfirm}>
            close done
          </button>
        </div>
      ) : null}
    </div>
  ),
}));

vi.mock('./issue-detail/IssueDetailTabs', () => ({
  IssueDetailTabs: ({
    activeTab,
    commentComposerRequestId,
    loadingPlanDetailIds,
    normalizedIssueActivity,
    onPlanHistoryCollapsedChange,
    onActiveTabChange,
    onEditPrd,
    onFullScreenPlan,
    onPhaseAgentChange,
    onPhaseEffortChange,
    onPhaseOpenRouterSlugBlur,
    onPlanExpandedChange,
    onRefreshFromGithub,
    onRequireApprovalChange,
    onRestoreCheckpoint,
    onRevisionCountChange,
    onShowAllPlanRunsChange,
    onStabilizePr,
  }: {
    activeTab: string;
    commentComposerRequestId: string | null;
    loadingPlanDetailIds: string[];
    normalizedIssueActivity: unknown[];
    onPlanHistoryCollapsedChange: (collapsed: boolean) => void;
    onActiveTabChange: (tab: string) => void;
    onEditPrd: () => void;
    onFullScreenPlan: (planId: string | null) => void;
    onPhaseAgentChange: (
      phase: 'planner' | 'reviewer' | 'executor' | 'verifier',
      value: string,
    ) => void;
    onPhaseEffortChange: (
      phase: 'planner' | 'reviewer' | 'executor' | 'verifier',
      value: string,
    ) => void;
    onPhaseOpenRouterSlugBlur: (
      phase: 'planner' | 'reviewer' | 'executor' | 'verifier',
      value: string,
    ) => void;
    onPlanExpandedChange: (planId: string | null) => void;
    onRefreshFromGithub: () => void;
    onRequireApprovalChange: (value: string) => void;
    onRestoreCheckpoint: (checkpoint: { id: string; label: string; commitSha: string }) => void;
    onRevisionCountChange: (value: string) => void;
    onShowAllPlanRunsChange: (show: boolean) => void;
    onStabilizePr: () => void;
  }) => (
    <div>
      <span>active tab {activeTab}</span>
      <span>composer request {commentComposerRequestId ?? 'none'}</span>
      <span>activity count {normalizedIssueActivity.length}</span>
      <span>loading plans {loadingPlanDetailIds.join(',') || 'none'}</span>
      <button type="button" onClick={() => onActiveTabChange('history')}>
        tab history
      </button>
      <button type="button" onClick={() => onActiveTabChange('activity')}>
        tab activity
      </button>
      <button type="button" onClick={onEditPrd}>
        tab edit prd
      </button>
      <button type="button" onClick={() => onFullScreenPlan('plan-1')}>
        tab fullscreen
      </button>
      <button type="button" onClick={() => onPlanExpandedChange('plan-1')}>
        tab expand plan
      </button>
      <button type="button" onClick={() => onPlanExpandedChange(null)}>
        tab collapse plan
      </button>
      <button type="button" onClick={() => onPlanHistoryCollapsedChange(true)}>
        tab collapse history
      </button>
      <button type="button" onClick={() => onShowAllPlanRunsChange(true)}>
        tab all runs
      </button>
      <button type="button" onClick={() => onShowAllPlanRunsChange(false)}>
        tab current run
      </button>
      <button type="button" onClick={() => onRefreshFromGithub()}>
        tab refresh github
      </button>
      <button type="button" onClick={() => onPhaseAgentChange('executor', '__inherit__')}>
        tab inherit agent
      </button>
      <button type="button" onClick={() => onPhaseAgentChange('planner', 'openrouter::model-a')}>
        tab set agent
      </button>
      <button type="button" onClick={() => onPhaseOpenRouterSlugBlur('planner', '')}>
        tab clear model slug
      </button>
      <button type="button" onClick={() => onPhaseOpenRouterSlugBlur('planner', 'model-b')}>
        tab set model slug
      </button>
      <button type="button" onClick={() => onPhaseEffortChange('planner', '__inherit__')}>
        tab inherit effort
      </button>
      <button type="button" onClick={() => onPhaseEffortChange('executor', 'high')}>
        tab set effort
      </button>
      <button type="button" onClick={() => onRevisionCountChange('3')}>
        tab revision count
      </button>
      <button type="button" onClick={() => onRequireApprovalChange('true')}>
        tab require approval
      </button>
      <button
        type="button"
        onClick={() =>
          onRestoreCheckpoint({
            id: 'checkpoint-1',
            label: 'Before execute',
            commitSha: 'abc123456789',
          })
        }
      >
        tab restore checkpoint
      </button>
      <button type="button" onClick={onStabilizePr}>
        tab stabilize
      </button>
    </div>
  ),
}));

vi.mock('./issue-detail/CostsTab', () => ({
  CostsTab: () => <div>costs tab</div>,
}));

vi.mock('./issue-detail/PipelineTab', () => ({
  PipelineTab: ({
    children,
    onPhaseAgentChange,
    onPhaseEffortChange,
    onPhaseOpenRouterSlugBlur,
    onRequireApprovalChange,
    onRestoreCheckpoint,
    onRevisionCountChange,
    onStabilizePr,
  }: {
    children?: ReactNode;
    onPhaseAgentChange: (
      phase: 'planner' | 'reviewer' | 'executor' | 'verifier',
      value: string,
    ) => void;
    onPhaseEffortChange: (
      phase: 'planner' | 'reviewer' | 'executor' | 'verifier',
      value: string,
    ) => void;
    onPhaseOpenRouterSlugBlur: (
      phase: 'planner' | 'reviewer' | 'executor' | 'verifier',
      value: string,
    ) => void;
    onRequireApprovalChange: (value: string) => void;
    onRestoreCheckpoint: (checkpoint: { id: string; label: string; commitSha: string }) => void;
    onRevisionCountChange: (value: string) => void;
    onStabilizePr: () => void;
  }) => (
    <div>
      pipeline tab {children}
      <button type="button" onClick={() => onPhaseAgentChange('reviewer', 'claude::__default__')}>
        pipeline set agent
      </button>
      <button type="button" onClick={() => onPhaseEffortChange('reviewer', 'medium')}>
        pipeline set effort
      </button>
      <button type="button" onClick={() => onPhaseOpenRouterSlugBlur('reviewer', 'model-c')}>
        pipeline set model slug
      </button>
      <button type="button" onClick={() => onRequireApprovalChange('__inherit__')}>
        pipeline inherit approval
      </button>
      <button type="button" onClick={() => onRevisionCountChange('__inherit__')}>
        pipeline inherit revisions
      </button>
      <button
        type="button"
        onClick={() =>
          onRestoreCheckpoint({
            id: 'checkpoint-1',
            label: 'Before execute',
            commitSha: 'abc123456789',
          })
        }
      >
        pipeline restore checkpoint
      </button>
      <button type="button" onClick={onStabilizePr}>
        pipeline stabilize
      </button>
    </div>
  ),
}));

import { IssueDetail } from './IssueDetail';

function makeIssue(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 42,
    title: 'Issue title',
    body: 'Body',
    labels: [],
    assignee: null,
    state: 'open',
    pipelineStatus: 'approval',
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
    requireApprovalOverride: null,
    linkedPrNumber: null,
    linkedPrUrl: null,
    linkedPrIsDraft: false,
    ciBlocked: false,
    failingChecks: [],
    unresolvedReviewComments: [],
    unresolvedReviewCommentCount: 0,
    prLastSyncAt: null,
    fetchedAt: '2026-05-09T00:00:00.000Z',
    priorityRank: null,
    priorityRaw: null,
    priorityFetchedAt: null,
    isQuickMode: false,
    ...overrides,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Thread title',
    prompt: 'Prompt',
    status: 'approval',
    kind: 'pipeline',
    worktreeBranch: 'shipcode/thread-1',
    worktreePath: '/tmp/worktree',
    plannerModel: 'claude',
    reviewerModel: 'claude',
    executorModel: 'claude',
    verifierModel: 'claude',
    reviewRound: 0,
    clarificationRound: 0,
    clarificationRequest: null,
    clarificationAnswers: [],
    answeredClarification: null,
    verificationStatus: null,
    verificationRetries: 0,
    autonomous: false,
    baseBranch: 'main',
    forkPointSha: null,
    githubIssueNumber: 42,
    githubPrNumber: null,
    githubRepo: 'acme/repo',
    automationId: null,
    lastError: null,
    failurePhase: null,
    failureCount: 0,
    pausedPhase: null,
    pausedAt: null,
    createdAt: '2026-05-09T00:00:00.000Z',
    updatedAt: '2026-05-09T00:00:00.000Z',
    plannerResolvedModel: null,
    reviewerResolvedModel: null,
    revisorResolvedModel: null,
    executorResolvedModel: null,
    verifierResolvedModel: null,
    totalTokensPrompt: 0,
    totalTokensCompletion: 0,
    totalCostUsd: 0,
    doneAt: null,
    ...overrides,
  };
}

function makeProject(): Project {
  return {
    id: 'project-1',
    name: 'Project',
    path: '/tmp/project',
    gitRemote: 'https://github.com/acme/repo.git',
    githubRepoId: null,
    githubRepoFullName: null,
    starterIssueNumber: null,
    starterIssueCreatedAt: null,
    githubProjectUrl: null,
    githubStatusMapping: null,
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
    requireApprovalOverride: null,
    discordRouting: 'inherit',
    discordWebhookUrlOverride: null,
    telegramRouting: 'inherit',
    telegramChatIdOverride: null,
    defaultBranch: 'main',
    pinned: false,
    archived: false,
    hidden: false,
    notifyGithubUser: null,
    createdAt: '2026-05-09T00:00:00.000Z',
    updatedAt: '2026-05-09T00:00:00.000Z',
  };
}

function makePlan(): PlanRecord {
  return {
    id: 'plan-1',
    threadId: 'thread-1',
    version: 1,
    rawOutput: 'raw plan',
    status: 'approval',
    createdAt: '2026-05-09T00:00:00.000Z',
    structured: {
      id: 'plan-1',
      threadId: 'thread-1',
      version: 1,
      objective: 'Plan objective',
      files: [],
      steps: [],
      acceptanceCriteria: [],
      outOfScope: [],
      estimatedComplexity: 'low',
      dependencies: [],
    },
  };
}

function makeVerification(overrides: Record<string, unknown> = {}) {
  return {
    id: 'verification-1',
    threadId: 'thread-1',
    planId: 'plan-1',
    result: 'failed',
    summary: 'Verifier summary',
    rawOutput: 'verification raw',
    structured: null,
    createdAt: '2026-05-09T00:00:00.000Z',
    ...overrides,
  };
}

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <IssueDetail />
    </QueryClientProvider>,
  );
}

describe('IssueDetail callback harness', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    cleanup();
    invokeMock.mockReset();
    vi.mocked(toast.error).mockReset();
    window.confirm = vi.fn(() => true);
    window.shipcode = {
      invoke: invokeMock as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      writable: true,
      configurable: true,
    });
    useAppStore.setState({
      activeProjectId: 'project-1',
      activeThreadId: 'thread-1',
      activeIssue: makeIssue(),
      githubIssues: [makeIssue()],
      pipelinePhase: 'approval',
      openEditPrdModal: vi.fn(),
    } as never);
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return makeProject();
      if (channel === 'thread:get') return makeThread();
      if (channel === 'plan:list') return [makePlan()];
      if (channel === 'plan:list-for-issue') return [makePlan()];
      if (channel === 'plan:get') return makePlan();
      if (channel === 'plan:get-by-id') return makePlan();
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'diff:list') return [];
      if (channel === 'feature-qa:list-by-thread') return [];
      if (channel === 'settings:get') return {};
      if (channel === 'integrations:check') return {};
      if (channel === 'github:list-issues') return [makeIssue()];
      if (channel === 'github:refresh-issues') return [makeIssue()];
      if (channel === 'checkpoint:list') {
        return [{ id: 'checkpoint-1', label: 'Before execute', commitSha: 'abc123456789' }];
      }
      if (channel === 'pipeline:create-pr') {
        return { prNumber: 7, prUrl: 'https://github.com/acme/repo/pull/7' };
      }
      if (channel === 'integrations:validate-openrouter-model') return { ok: true };
      return undefined;
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('routes child action callbacks through IssueDetail handlers', async () => {
    renderWithProviders();

    expect(await screen.findByText('Issue title')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'action start' }));
    fireEvent.click(screen.getByRole('button', { name: 'action approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'action reject' }));
    fireEvent.click(screen.getByRole('button', { name: 'action cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'action rerun' }));
    fireEvent.click(screen.getByRole('button', { name: 'action edit prd' }));
    fireEvent.click(screen.getByRole('button', { name: 'action create pr' }));
    fireEvent.click(screen.getByRole('button', { name: 'action raw' }));
    fireEvent.click(screen.getByRole('button', { name: 'action mark done' }));
    fireEvent.click(await screen.findByRole('button', { name: 'confirm done' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:start-issue', {
        projectId: 'project-1',
        issueNumber: 42,
      });
      expect(invokeMock).toHaveBeenCalledWith('pipeline:approve', { threadId: 'thread-1' });
      expect(invokeMock).toHaveBeenCalledWith('pipeline:reject', {
        threadId: 'thread-1',
        feedback: 'revise scope',
      });
      expect(invokeMock).toHaveBeenCalledWith('pipeline:cancel', { threadId: 'thread-1' });
      expect(invokeMock).toHaveBeenCalledWith('pipeline:retry', { threadId: 'thread-1' });
      expect(invokeMock).toHaveBeenCalledWith('pipeline:create-pr', { threadId: 'thread-1' });
      expect(invokeMock).toHaveBeenCalledWith('issue:mark-done', {
        projectId: 'project-1',
        issueId: 'issue-1',
        issueNumber: 42,
      });
    });
    expect(useAppStore.getState().openEditPrdModal).toHaveBeenCalledWith(42, 'Body', []);
  });

  it('routes dialog callbacks without confirming destructive actions', async () => {
    useAppStore.setState({
      activeIssue: makeIssue({ pipelineStatus: 'completed' }),
      githubIssues: [makeIssue({ pipelineStatus: 'completed' })],
    } as never);

    renderWithProviders();

    expect(await screen.findByText('Issue title')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'dialog approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'action mark done' }));
    fireEvent.click(await screen.findByRole('button', { name: 'close done' }));
    fireEvent.click(screen.getByText('Archive issue'));
    fireEvent.click(await screen.findByRole('button', { name: 'close archive' }));

    expect(invokeMock).not.toHaveBeenCalledWith('issue:mark-done', expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith('github:archive-issue', expect.anything());
  });

  it('submits clarification answers when the thread is waiting for planner input', async () => {
    const clarificationRequest = {
      id: 'clarify-1',
      threadId: 'test-thread',
      phase: 'plan' as const,
      summary: 'Need product input',
      questions: [
        {
          id: 'q1',
          title: 'Scope',
          prompt: 'What should ship?',
          description: null,
          freeformPlaceholder: null,
          choices: [],
          allowFreeform: true,
        },
      ],
    };
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return makeProject();
      if (channel === 'thread:get') return makeThread({ clarificationRequest });
      if (channel === 'plan:list') return [makePlan()];
      if (channel === 'plan:list-for-issue') return [makePlan()];
      if (channel === 'plan:get') return makePlan();
      if (channel === 'plan:get-by-id') return makePlan();
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'diff:list') return [];
      if (channel === 'feature-qa:list-by-thread') return [];
      if (channel === 'settings:get') return {};
      if (channel === 'integrations:check') return {};
      if (channel === 'github:list-issues') return [makeIssue()];
      if (channel === 'github:refresh-issues') return [makeIssue()];
      if (channel === 'checkpoint:list') return [];
      return undefined;
    });

    renderWithProviders();

    expect(await screen.findByText('action has clarification')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'action clarify' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('pipeline:answer-clarification', {
        threadId: 'thread-1',
        answers: [{ questionId: 'q1', freeformText: 'Ship it' }],
      });
    });
  });

  it('ignores guarded action callbacks when project or thread context is missing', async () => {
    useAppStore.setState({
      activeProjectId: null,
      activeThreadId: null,
      activeIssue: makeIssue({ pipelineStatus: 'todo', threadId: null }),
      githubIssues: [makeIssue({ pipelineStatus: 'todo', threadId: null })],
    } as never);

    renderWithProviders();

    expect(await screen.findByText('Issue title')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'action start' }));
    fireEvent.click(screen.getByRole('button', { name: 'action approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'action reject' }));
    fireEvent.click(screen.getByRole('button', { name: 'action reject blank' }));
    fireEvent.click(screen.getByRole('button', { name: 'action cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'action rerun' }));
    fireEvent.click(screen.getByRole('button', { name: 'action mark done' }));
    fireEvent.click(await screen.findByRole('button', { name: 'confirm done' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab refresh github' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab set agent' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab set model slug' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab set effort' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab revision count' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab require approval' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab restore checkpoint' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab stabilize' }));

    await waitFor(() => {
      expect(invokeMock).not.toHaveBeenCalledWith('github:start-issue', expect.anything());
      expect(invokeMock).not.toHaveBeenCalledWith('pipeline:approve', expect.anything());
      expect(invokeMock).not.toHaveBeenCalledWith('pipeline:reject', expect.anything());
      expect(invokeMock).not.toHaveBeenCalledWith('pipeline:cancel', expect.anything());
      expect(invokeMock).not.toHaveBeenCalledWith('pipeline:retry', expect.anything());
      expect(invokeMock).not.toHaveBeenCalledWith('issue:mark-done', expect.anything());
      expect(invokeMock).not.toHaveBeenCalledWith(
        'github:set-phase-model-override',
        expect.anything(),
      );
      expect(invokeMock).not.toHaveBeenCalledWith('pipeline:stabilize-pr', expect.anything());
    });
  });

  it('starts a fresh issue run when rerunning a failed issue without a thread', async () => {
    useAppStore.setState({
      activeThreadId: null,
      activeIssue: makeIssue({ pipelineStatus: 'failed', threadId: null }),
      githubIssues: [makeIssue({ pipelineStatus: 'failed', threadId: null })],
    } as never);

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'action rerun' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:start-issue', {
        projectId: 'project-1',
        issueNumber: 42,
      });
    });
  });

  it.each([
    {
      name: 'review when the latest structured plan has no worktree',
      thread: makeThread({ status: 'failed', worktreePath: null }),
      plan: makePlan(),
      verification: null,
      label: 'retry label Resume review',
      summary: 'Retry will resume from review using the latest structured plan.',
    },
    {
      name: 'verification when the failed verification is unstructured',
      thread: makeThread({ status: 'failed' }),
      plan: makePlan(),
      verification: makeVerification(),
      label: 'retry label Resume verification',
      summary: 'Retry will resume from verification using the current worktree.',
    },
    {
      name: 'execution when the failed verification has structured feedback',
      thread: makeThread({ status: 'failed' }),
      plan: makePlan(),
      verification: makeVerification({
        structured: {
          result: 'failed',
          summary: 'Needs fixes',
          findings: [],
        },
      }),
      label: 'retry label Resume execution',
      summary:
        'Retry will resume from execution using the current worktree and latest verification feedback.',
    },
    {
      name: 'shipping when verification passed',
      thread: makeThread({ status: 'completed' }),
      plan: makePlan(),
      verification: makeVerification({ result: 'passed' }),
      label: 'retry label Resume shipping',
      summary: 'Retry will resume from commit and push using the verified worktree.',
    },
    {
      name: 'planning when no structured plan exists',
      thread: makeThread({ status: 'failed' }),
      plan: { ...makePlan(), structured: null },
      verification: null,
      label: 'retry label Re-plan',
      summary:
        'Retry will start a fresh planning pass. This resumes the workflow, not the same live planner session.',
    },
  ])('describes retry as $name', async ({ thread, plan, verification, label, summary }) => {
    useAppStore.setState({
      activeIssue: makeIssue({ pipelineStatus: 'failed' }),
      githubIssues: [makeIssue({ pipelineStatus: 'failed' })],
      pipelinePhase: thread.status,
    } as never);
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return makeProject();
      if (channel === 'thread:get') return thread;
      if (channel === 'plan:list') return [plan];
      if (channel === 'verification:get') return verification;
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'diff:list') return [];
      if (channel === 'feature-qa:list-by-thread') return [];
      if (channel === 'settings:get') return {};
      if (channel === 'integrations:check') return {};
      if (channel === 'checkpoint:list') return [];
      return undefined;
    });

    renderWithProviders();

    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(await screen.findByText(new RegExp(summary.slice(0, 24)))).toBeInTheDocument();
  });

  it('shows create PR errors from failed mutations', async () => {
    useAppStore.setState({
      activeIssue: makeIssue({ pipelineStatus: 'completed' }),
      githubIssues: [makeIssue({ pipelineStatus: 'completed' })],
      pipelinePhase: 'completed',
    } as never);
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'pipeline:create-pr') throw new Error('push rejected');
      if (channel === 'project:get') return makeProject();
      if (channel === 'thread:get') return makeThread({ status: 'completed' });
      if (channel === 'plan:list') return [makePlan()];
      if (channel === 'verification:get') return makeVerification({ result: 'passed' });
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'diff:list') return [];
      if (channel === 'feature-qa:list-by-thread') return [];
      if (channel === 'settings:get') return {};
      if (channel === 'integrations:check') return {};
      if (channel === 'checkpoint:list') return [];
      return undefined;
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'action create pr' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('pipeline:create-pr', { threadId: 'thread-1' });
    });
    expect(await screen.findByText('create pr error push rejected')).toBeInTheDocument();
  });

  it('routes tab callbacks through IssueDetail handlers', async () => {
    renderWithProviders();

    expect(await screen.findByText('Issue title')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'tab edit prd' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab history' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab fullscreen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'close fullscreen' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab expand plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab collapse plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab collapse history' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab all runs' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab current run' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab refresh github' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab inherit agent' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab set agent' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab clear model slug' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab set model slug' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab inherit effort' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab set effort' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab revision count' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab require approval' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab restore checkpoint' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab stabilize' }));
    fireEvent.click(screen.getByRole('button', { name: 'pipeline set agent' }));
    fireEvent.click(screen.getByRole('button', { name: 'pipeline set effort' }));
    fireEvent.click(screen.getByRole('button', { name: 'pipeline set model slug' }));
    fireEvent.click(screen.getByRole('button', { name: 'pipeline inherit approval' }));
    fireEvent.click(screen.getByRole('button', { name: 'pipeline inherit revisions' }));
    fireEvent.click(screen.getByRole('button', { name: 'pipeline restore checkpoint' }));
    fireEvent.click(screen.getByRole('button', { name: 'pipeline stabilize' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:clear-phase-model-override', {
        projectId: 'project-1',
        issueNumber: 42,
        phase: 'executor',
      });
      expect(invokeMock).toHaveBeenCalledWith('github:set-phase-model-override', {
        projectId: 'project-1',
        issueNumber: 42,
        phase: 'planner',
        model: 'openrouter',
      });
      expect(invokeMock).toHaveBeenCalledWith('github:set-phase-reasoning-effort-override', {
        projectId: 'project-1',
        issueNumber: 42,
        phase: 'executor',
        effort: 'high',
      });
      expect(invokeMock).toHaveBeenCalledWith('github:set-revision-count-override', {
        projectId: 'project-1',
        issueNumber: 42,
        revisionCount: 3,
      });
      expect(invokeMock).toHaveBeenCalledWith('github:set-require-approval-override', {
        projectId: 'project-1',
        issueNumber: 42,
        requireApproval: true,
      });
      expect(invokeMock).toHaveBeenCalledWith('checkpoint:restore', {
        threadId: 'thread-1',
        checkpointId: 'checkpoint-1',
      });
      expect(invokeMock).toHaveBeenCalledWith('pipeline:stabilize-pr', { threadId: 'thread-1' });
    });
  });

  it('does not restore a checkpoint when confirmation is cancelled', async () => {
    window.confirm = vi.fn(() => false);

    renderWithProviders();

    expect(await screen.findByText('Issue title')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'tab restore checkpoint' }));

    expect(window.confirm).toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith('checkpoint:restore', expect.anything());
  });

  it('routes issue state dropdown actions through GitHub issue mutations', async () => {
    renderWithProviders();

    expect(await screen.findByText('Issue title')).toBeInTheDocument();

    fireEvent.click(await screen.findByText('Close issue'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:close-issue', {
        projectId: 'project-1',
        issueNumber: 42,
      });
    });

    cleanup();
    useAppStore.setState({
      activeIssue: makeIssue({ state: 'closed' }),
      githubIssues: [makeIssue({ state: 'closed' })],
    } as never);

    renderWithProviders();

    fireEvent.click(await screen.findByText('Reopen issue'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:reopen-issue', {
        projectId: 'project-1',
        issueNumber: 42,
      });
    });
  });

  it('routes header pause and resume controls through pipeline mutations', async () => {
    useAppStore.setState({
      pipelinePhase: 'executing',
      activeIssue: makeIssue({ pipelineStatus: 'executing' }),
      githubIssues: [makeIssue({ pipelineStatus: 'executing' })],
    } as never);
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return makeProject();
      if (channel === 'thread:get') return makeThread({ status: 'executing' });
      if (channel === 'plan:list') return [makePlan()];
      if (channel === 'plan:list-for-issue') return [makePlan()];
      if (channel === 'plan:get') return makePlan();
      if (channel === 'plan:get-by-id') return makePlan();
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'diff:list') return [];
      if (channel === 'feature-qa:list-by-thread') return [];
      if (channel === 'settings:get') return {};
      if (channel === 'integrations:check') return {};
      if (channel === 'github:list-issues') return [makeIssue({ pipelineStatus: 'executing' })];
      if (channel === 'github:refresh-issues') return [makeIssue({ pipelineStatus: 'executing' })];
      if (channel === 'checkpoint:list') return [];
      return undefined;
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Pause task' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('pipeline:pause', { threadId: 'thread-1' });
    });

    cleanup();
    invokeMock.mockClear();
    useAppStore.setState({
      pipelinePhase: 'paused',
      activeIssue: makeIssue({ pipelineStatus: 'paused' }),
      githubIssues: [makeIssue({ pipelineStatus: 'paused' })],
    } as never);
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return makeProject();
      if (channel === 'thread:get') return makeThread({ status: 'paused' });
      if (channel === 'plan:list') return [makePlan()];
      if (channel === 'plan:list-for-issue') return [makePlan()];
      if (channel === 'plan:get') return makePlan();
      if (channel === 'plan:get-by-id') return makePlan();
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'diff:list') return [];
      if (channel === 'feature-qa:list-by-thread') return [];
      if (channel === 'settings:get') return {};
      if (channel === 'integrations:check') return {};
      if (channel === 'github:list-issues') return [makeIssue({ pipelineStatus: 'paused' })];
      if (channel === 'github:refresh-issues') return [makeIssue({ pipelineStatus: 'paused' })];
      if (channel === 'checkpoint:list') return [];
      return undefined;
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Resume task' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('pipeline:resume', { threadId: 'thread-1' });
    });
  });

  it('opens GitHub issue and PR links, including thread-derived PR URLs', async () => {
    useAppStore.setState({
      activeIssue: makeIssue({
        linkedPrNumber: 9,
        linkedPrUrl: null,
      }),
      githubIssues: [
        makeIssue({
          linkedPrNumber: 9,
          linkedPrUrl: null,
        }),
      ],
    } as never);
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return makeProject();
      if (channel === 'thread:get') return makeThread({ githubPrNumber: 9 });
      if (channel === 'plan:list') return [makePlan()];
      if (channel === 'plan:list-for-issue') return [makePlan()];
      if (channel === 'plan:get') return makePlan();
      if (channel === 'plan:get-by-id') return makePlan();
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'diff:list') return [];
      if (channel === 'feature-qa:list-by-thread') return [];
      if (channel === 'settings:get') return {};
      if (channel === 'integrations:check') return {};
      if (channel === 'github:list-issues') return [];
      if (channel === 'github:refresh-issues') return [];
      if (channel === 'checkpoint:list') return [];
      return undefined;
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: '#42' }));
    fireEvent.click(await screen.findByRole('button', { name: 'PR #9' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('shell:open-external', {
        url: 'https://github.com/acme/repo/issues/42',
      });
      expect(invokeMock).toHaveBeenCalledWith('shell:open-external', {
        url: 'https://github.com/acme/repo/pull/9',
      });
    });
  });

  it('archives completed issues from the state dropdown and closes the detail view', async () => {
    useAppStore.setState({
      activeIssue: makeIssue({ pipelineStatus: 'completed' }),
      githubIssues: [makeIssue({ pipelineStatus: 'completed' })],
    } as never);

    renderWithProviders();

    fireEvent.click(await screen.findByText('Archive issue'));
    fireEvent.click(await screen.findByRole('button', { name: 'confirm archive' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:archive-issue', {
        projectId: 'project-1',
        issueId: 'issue-1',
        issueNumber: 42,
      });
    });
    await waitFor(() => {
      expect(useAppStore.getState().activeIssue).toBeNull();
    });
  });

  it('shows a toast when archive fails', async () => {
    useAppStore.setState({
      activeIssue: makeIssue({ pipelineStatus: 'completed' }),
      githubIssues: [makeIssue({ pipelineStatus: 'completed' })],
    } as never);
    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'github:archive-issue') throw new Error('archive denied');
      if (channel === 'project:get') return makeProject();
      if (channel === 'thread:get') return makeThread();
      if (channel === 'plan:list') return [makePlan()];
      if (channel === 'plan:list-for-issue') return [makePlan()];
      if (channel === 'plan:get') return makePlan();
      if (channel === 'plan:get-by-id') return makePlan();
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'diff:list') return [];
      if (channel === 'feature-qa:list-by-thread') return [];
      if (channel === 'settings:get') return {};
      if (channel === 'integrations:check') return {};
      if (channel === 'github:list-issues') return [makeIssue()];
      if (channel === 'github:refresh-issues') return [makeIssue()];
      if (channel === 'checkpoint:list') return [];
      return args ?? null;
    });

    renderWithProviders();

    fireEvent.click(await screen.findByText('Archive issue'));
    fireEvent.click(await screen.findByRole('button', { name: 'confirm archive' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to archive issue', 'archive denied');
    });
  });

  it('reports clipboard write failures on the branch copy control', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    renderWithProviders();

    const copyButton = await screen.findByTestId('copy-branch-name');
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(copyButton).toHaveAttribute('title', 'Clipboard write failed');
    });
  });

  it('copies branch names, clears the previous reset timer, and resets copied state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    renderWithProviders();

    const copyButton = await screen.findByTestId('copy-branch-name');
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(copyButton).toHaveAttribute('title', 'Copied!');
    });

    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(writeText).toHaveBeenCalledTimes(2);
    });

    vi.advanceTimersByTime(1500);

    await waitFor(() => {
      expect(copyButton).toHaveAttribute('title', expect.stringContaining('Copy branch name'));
    });
  });

  it('loads activity rows after switching to the activity tab', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return makeProject();
      if (channel === 'thread:get') return makeThread({ status: 'executing' });
      if (channel === 'plan:list') return [makePlan()];
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'diff:list') return [];
      if (channel === 'feature-qa:list-by-thread') return [];
      if (channel === 'settings:get') return {};
      if (channel === 'integrations:check') return {};
      if (channel === 'checkpoint:list') return [];
      if (channel === 'activity:list-for-issue') {
        return [
          {
            id: 'activity-1',
            threadId: 'thread-1',
            projectId: 'project-1',
            kind: 'phase_change',
            actor: 'codex',
            title: 'Activity loaded',
            subtitle: null,
            metadata: null,
            createdAt: '2026-05-09T00:00:00.000Z',
          },
        ];
      }
      return undefined;
    });

    renderWithProviders();

    expect(await screen.findByText('activity count 0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'tab activity' }));

    expect(await screen.findByText('activity count 1')).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith('activity:list-for-issue', {
      projectId: 'project-1',
      issueNumber: 42,
      limit: 200,
    });
  });

  it('normalizes valid task graphs from the sidebar query', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return makeProject();
      if (channel === 'thread:get') return makeThread();
      if (channel === 'plan:list') return [makePlan()];
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'diff:list') return [];
      if (channel === 'feature-qa:list-by-thread') return [];
      if (channel === 'settings:get') return {};
      if (channel === 'integrations:check') return {};
      if (channel === 'checkpoint:list') return [];
      if (channel === 'task-graph:get-latest') return { nodes: [], edges: [] };
      return undefined;
    });

    renderWithProviders();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('task-graph:get-latest', { threadId: 'thread-1' });
    });
  });

  it('falls back to built-in phase defaults when settings are unavailable', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return makeProject();
      if (channel === 'thread:get') return makeThread();
      if (channel === 'plan:list') return [makePlan()];
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'diff:list') return [];
      if (channel === 'feature-qa:list-by-thread') return [];
      if (channel === 'settings:get') return null;
      if (channel === 'integrations:check') return {};
      if (channel === 'checkpoint:list') return [];
      return undefined;
    });

    renderWithProviders();

    expect(await screen.findByText('Issue title')).toBeInTheDocument();
  });

  it('resolves issue-level model, revision, approval, and badge overrides', async () => {
    useAppStore.setState({
      activeIssue: makeIssue({
        assignee: 'vincent',
        labels: ['agent:ui'],
        linkedPrNumber: 12,
        linkedPrIsDraft: true,
        ciBlocked: true,
        unresolvedReviewCommentCount: 1,
        plannerModelOverride: 'openrouter',
        plannerModelIdOverride: 'anthropic/claude-sonnet-4',
        reviewerModelOverride: 'codex',
        executorModelOverride: 'claude',
        verifierModelOverride: 'openrouter',
        verifierModelIdOverride: 'openai/gpt-5.4',
        plannerReasoningEffortOverride: 'high',
        reviewerReasoningEffortOverride: 'medium',
        executorReasoningEffortOverride: 'low',
        verifierReasoningEffortOverride: 'none',
        revisionCountOverride: 2,
        requireApprovalOverride: false,
      }),
    } as never);

    renderWithProviders();

    expect(await screen.findByText('vincent')).toBeInTheDocument();
    expect(screen.getByText('Draft PR')).toBeInTheDocument();
    expect(screen.getByText('CI blocked')).toBeInTheDocument();
    expect(screen.getByText('1 review')).toBeInTheDocument();
  });

  it('fetches lightweight expanded and full-screen plan details on demand', async () => {
    const lightweightPlan = { ...makePlan(), structured: null, rawOutput: null };
    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'project:get') return makeProject();
      if (channel === 'thread:get') return makeThread();
      if (channel === 'plan:list') return [lightweightPlan];
      if (channel === 'plan:list-for-issue') return [lightweightPlan];
      if (channel === 'plan:get-by-id') return makePlan();
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'diff:list') return [];
      if (channel === 'feature-qa:list-by-thread') return [];
      if (channel === 'settings:get') return {};
      if (channel === 'integrations:check') return {};
      if (channel === 'checkpoint:list') return [];
      return args ?? undefined;
    });

    renderWithProviders();

    expect(await screen.findByText('Issue title')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'tab history' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab expand plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab fullscreen' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('plan:get-by-id', { planId: 'plan-1' });
    });
  });

  it('resizes the detail sidebar and clears drag state on mouseup', async () => {
    renderWithProviders();

    expect(await screen.findByText('Issue title')).toBeInTheDocument();

    const resizeHandle = screen.getByRole('button', { name: 'Resize detail sidebar' });
    const sidebar = resizeHandle.closest('[style]') as HTMLElement;
    fireEvent.mouseDown(resizeHandle, { clientX: 400 });
    fireEvent.mouseMove(document, { clientX: 250 });

    expect(sidebar).toHaveStyle({ width: '566px' });
    expect(document.body.classList.contains('cursor-col-resize')).toBe(true);

    fireEvent.mouseUp(document);
    fireEvent.mouseMove(document, { clientX: 800 });

    expect(sidebar).toHaveStyle({ width: '566px' });
    expect(document.body.classList.contains('cursor-col-resize')).toBe(false);
  });

  it('switches to comments only for the selected issue composer request', async () => {
    useAppStore.setState({
      commentComposerRequest: { issueId: 'other-issue', requestId: 'ignore-me' },
    } as never);

    const { rerender } = renderWithProviders();

    expect(await screen.findByText('active tab prd')).toBeInTheDocument();

    useAppStore.setState({
      commentComposerRequest: { issueId: 'issue-1', requestId: 'request-1' },
    } as never);
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <IssueDetail />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('active tab comments')).toBeInTheDocument();
    expect(screen.getByText('composer request request-1')).toBeInTheDocument();
  });

  it('closes the issue detail on Escape and renders nothing without an active issue', async () => {
    const { container, rerender } = renderWithProviders();

    expect(await screen.findByText('Issue title')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useAppStore.getState().activeIssue).toBeNull();

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <IssueDetail />
      </QueryClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
