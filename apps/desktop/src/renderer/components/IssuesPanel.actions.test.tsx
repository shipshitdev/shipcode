// @vitest-environment jsdom

import {
  DEFAULT_SETTINGS,
  type GitHubIssueCacheRecord,
  type Project,
  type TaskGraphWithNodes,
  type Thread,
  type ThreadPanelData,
} from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';

type MockBoardProps = {
  issues: GitHubIssueCacheRecord[];
  triageCandidateCount?: number;
  refreshingBranches?: boolean;
  branches?: string[];
  autoRunCount?: number;
  flashingIssueIds?: ReadonlySet<string>;
  graphContent?: ReactNode;
  onRefresh?: () => void;
  onIssueClick?: (issue: GitHubIssueCacheRecord) => void;
  onCommentIssue?: (issue: GitHubIssueCacheRecord) => void;
  onOpenExternal?: (url: string) => void | Promise<void>;
  onOpenPullRequest?: (url: string) => void | Promise<void>;
  onTriageIssues?: () => void;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
  onArchiveAllDone?: () => void;
  onRefreshBranches?: () => void;
  onBaseBranchChange?: (branch: string) => void;
  onStartPipeline?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onRetry?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onRerun?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onPause?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onResume?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onCancel?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onCreatePr?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onMarkDone?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onAutoRunPrioritiesChange?: (priorities: Array<'p0' | 'p1' | 'p2' | 'p3'>) => void;
  onAutoRun?: () => void;
  onFetchPlanSteps?: (threadId: string) => Promise<Array<{ id: string; title: string }> | null>;
};

vi.mock('electron-log/renderer', () => ({
  default: {
    error: vi.fn(),
  },
}));

vi.mock('./ThreadPanelArchiveDialog', () => ({
  ThreadPanelArchiveDialog: ({
    open,
    issueNumber,
    count,
    onClose,
    onConfirm,
  }: {
    open: boolean;
    issueNumber?: number;
    count?: number;
    onClose: () => void;
    onConfirm: () => void;
  }) =>
    open ? (
      <dialog open aria-label="Archive issues">
        <span>{issueNumber ? `Archive #${issueNumber}` : `Archive ${count}`}</span>
        <button type="button" onClick={onClose}>
          Close archive
        </button>
        <button type="button" onClick={onConfirm}>
          Confirm archive
        </button>
      </dialog>
    ) : null,
}));

vi.mock('./ThreadPanelBoardReviewDialog', () => ({
  ThreadPanelBoardReviewDialog: ({
    open,
    count,
    onClose,
    onConfirm,
  }: {
    open: boolean;
    count: number;
    onClose: () => void;
    onConfirm: () => void;
  }) =>
    open ? (
      <dialog open aria-label="Review board">
        <span>Reviewing {count}</span>
        <button type="button" onClick={onClose}>
          Close triage
        </button>
        <button type="button" onClick={onConfirm}>
          Confirm triage
        </button>
      </dialog>
    ) : null,
}));

vi.mock('@shipcode/ui', () => ({
  AUTOMATION_ISSUE_NUMBER_BASE: -1_000_000,
  isAutomationIssue: (issue: { isQuickMode?: boolean; issueNumber: number }) =>
    !issue.isQuickMode && issue.issueNumber <= -1_000_000,
  KanbanBoard: ({
    issues,
    triageCandidateCount,
    refreshingBranches,
    branches,
    autoRunCount,
    flashingIssueIds,
    graphContent,
    onRefresh,
    onIssueClick,
    onCommentIssue,
    onOpenExternal,
    onOpenPullRequest,
    onTriageIssues,
    onArchiveIssue,
    onArchiveAllDone,
    onRefreshBranches,
    onBaseBranchChange,
    onStartPipeline,
    onRetry,
    onRerun,
    onPause,
    onResume,
    onCancel,
    onCreatePr,
    onMarkDone,
    onAutoRunPrioritiesChange,
    onAutoRun,
    onFetchPlanSteps,
  }: MockBoardProps) => {
    const first = issues[0];
    return (
      <div>
        <div data-testid="issue-count">{issues.length}</div>
        <div data-testid="triage-count">{triageCandidateCount ?? 0}</div>
        <div data-testid="refreshing-branches">{String(refreshingBranches ?? false)}</div>
        <div data-testid="branches">{branches?.join(',') ?? ''}</div>
        <div data-testid="auto-run-count">{autoRunCount ?? 0}</div>
        <div data-testid="flashing-issues">{[...(flashingIssueIds ?? [])].join(',')}</div>
        {first ? <div>{first.title}</div> : null}
        <div data-testid="first-status">{first?.pipelineStatus ?? 'none'}</div>
        <div data-testid="graph-content">{graphContent}</div>
        <button type="button" onClick={() => first && onIssueClick?.(first)}>
          Open first
        </button>
        <button type="button" onClick={() => onRefresh?.()}>
          Refresh board
        </button>
        <button type="button" onClick={() => first && onCommentIssue?.(first)}>
          Comment first
        </button>
        <button type="button" onClick={() => onOpenExternal?.('https://github.com/acme/repo')}>
          Open repo
        </button>
        <button
          type="button"
          onClick={() => onOpenPullRequest?.('https://github.com/acme/repo/pull/42')}
        >
          Open pull request
        </button>
        <button type="button" onClick={() => onTriageIssues?.()}>
          Trigger triage
        </button>
        <button type="button" onClick={() => first && onArchiveIssue?.(first)}>
          Archive first
        </button>
        <button type="button" onClick={() => onArchiveAllDone?.()}>
          Archive all done
        </button>
        <button type="button" onClick={() => onRefreshBranches?.()}>
          Trigger branch refresh
        </button>
        <button type="button" onClick={() => onBaseBranchChange?.('release')}>
          Change base branch
        </button>
        <button type="button" onClick={() => first && onStartPipeline?.(first)}>
          Start first
        </button>
        <button type="button" onClick={() => first && onRetry?.(first)}>
          Retry first
        </button>
        <button type="button" onClick={() => first && onRerun?.(first)}>
          Rerun first
        </button>
        <button type="button" onClick={() => first && onPause?.(first)}>
          Pause first
        </button>
        <button type="button" onClick={() => first && onResume?.(first)}>
          Resume first
        </button>
        <button type="button" onClick={() => first && onCancel?.(first)}>
          Cancel first
        </button>
        <button type="button" onClick={() => first && onCreatePr?.(first)}>
          Create PR first
        </button>
        <button type="button" onClick={() => first && onMarkDone?.(first)}>
          Mark done first
        </button>
        <button type="button" onClick={() => onAutoRunPrioritiesChange?.(['p0', 'p2'])}>
          Change auto priorities
        </button>
        <button type="button" onClick={() => onAutoRun?.()}>
          Trigger auto run
        </button>
        <button type="button" onClick={() => first?.threadId && onFetchPlanSteps?.(first.threadId)}>
          Fetch steps
        </button>
      </div>
    );
  },
}));

vi.mock('../features/project/project-graph-tab', () => ({
  ProjectGraphTab: ({ embedded }: { embedded?: boolean }) => (
    <div data-testid="project-graph-tab">{embedded ? 'embedded graph' : 'graph'}</div>
  ),
}));

import { IssuesPanel } from './IssuesPanel';

const project: Project = {
  id: 'project-1',
  name: 'ShipCode',
  path: '/tmp/shipcode',
  pathExists: true,
  gitRemote: 'git@github.com:shipshitdev/shipcode.git',
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
  discordRouting: 'inherit',
  discordWebhookUrlOverride: null,
  telegramRouting: 'inherit',
  telegramChatIdOverride: null,
  defaultBranch: 'main',
  pinned: false,
  archived: false,
  hidden: false,
  notifyGithubUser: null,
  createdAt: '2026-04-14T00:00:00.000Z',
  updatedAt: '2026-04-14T00:00:00.000Z',
};

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    projectId: project.id,
    kind: 'pipeline',
    title: 'Ship your first change with ShipCode',
    prompt: 'Fix it',
    status: 'executing',
    worktreeBranch: null,
    worktreePath: null,
    plannerModel: 'claude',
    reviewerModel: 'claude',
    verifierModel: 'claude',
    executorModel: 'claude',
    reviewRound: 0,
    clarificationRound: 0,
    clarificationRequest: null,
    clarificationAnswers: [],
    answeredClarification: null,
    verificationStatus: null,
    verificationRetries: 0,
    autonomous: true,
    baseBranch: 'main',
    forkPointSha: null,
    githubIssueNumber: 18,
    githubPrNumber: null,
    githubRepo: 'shipshitdev/shipcode',
    automationId: null,
    lastError: null,
    failurePhase: null,
    failureCount: 0,
    pausedPhase: null,
    pausedAt: null,
    createdAt: '2026-04-22T10:00:00.000Z',
    updatedAt: '2026-04-22T10:00:00.000Z',
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

function makeIssue(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return {
    id: 'issue-1',
    projectId: project.id,
    issueNumber: 18,
    title: 'Ship your first change with ShipCode',
    body: null,
    labels: [],
    assignee: null,
    state: 'open',
    pipelineStatus: 'todo',
    threadId: null,
    claimedAt: null,
    claimedBy: null,
    lastPhaseUpdate: '2026-04-22T10:00:00.000Z',
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
    fetchedAt: '2026-04-22T10:00:00.000Z',
    priorityRank: null,
    priorityRaw: null,
    priorityFetchedAt: null,
    isQuickMode: false,
    ...overrides,
  };
}

function makePanelData(overrides: Partial<ThreadPanelData> = {}): ThreadPanelData {
  return {
    project,
    settings: DEFAULT_SETTINGS,
    threads: [],
    latestPlanStatusByThreadId: {},
    branches: ['main'],
    ...overrides,
  };
}

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <IssuesPanel />
    </QueryClientProvider>,
  );
}

describe('IssuesPanel board actions', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    cleanup();
    invokeMock.mockReset();
    window.shipcode = {
      invoke: invokeMock as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };

    useAppStore.setState({
      activeProjectId: project.id,
      activeIssue: null,
      activeAutomationThreadId: null,
      commentComposerRequest: null,
      githubIssues: [],
      pendingCreatedIssues: [],
      viewMode: 'project',
      settingsVisible: false,
      sidebarCollapsed: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('opens triage confirmation only for eligible todo issues and confirms the triage mutation', async () => {
    const triageCandidate = makeIssue({ id: 'candidate-1', issueNumber: 24, title: 'Needs sort' });
    const ineligibleQuickIssue = makeIssue({
      id: 'quick-1',
      issueNumber: -123,
      title: 'Local quick task',
      isQuickMode: true,
    });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return makePanelData();
      if (channel === 'github:list-issues') return [triageCandidate, ineligibleQuickIssue];
      if (channel === 'github:triage-issues') {
        return { consideredCount: 1, appliedCount: 1 };
      }
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Needs sort')).toBeInTheDocument();
    expect(screen.getByTestId('triage-count')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: 'Trigger triage' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm triage' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:triage-issues', {
        projectId: project.id,
      });
    });
    expect(await screen.findByText('Triaged 1 issue; applied 1.')).toBeInTheDocument();
  });

  it('reports empty and failed triage results', async () => {
    const triageCandidate = makeIssue({
      id: 'candidate-empty',
      issueNumber: 25,
      title: 'Needs no-op sort',
    });
    let failTriage = false;

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return makePanelData();
      if (channel === 'github:list-issues') return [triageCandidate];
      if (channel === 'github:triage-issues') {
        if (failTriage) throw new Error('triage failed');
        return { consideredCount: 0, appliedCount: 0 };
      }
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Needs no-op sort')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Trigger triage' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm triage' }));
    expect(await screen.findByText('No Backlog issues need triage.')).toBeInTheDocument();

    failTriage = true;
    fireEvent.click(screen.getByRole('button', { name: 'Trigger triage' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm triage' }));
    expect(await screen.findByText(/Issue triage failed: triage failed/i)).toBeInTheDocument();
  });

  it('ignores triage clicks when no issue qualifies for board review', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return makePanelData();
      if (channel === 'github:list-issues') {
        return [makeIssue({ threadId: 'thread-1', pipelineStatus: 'planning' })];
      }
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Ship your first change with ShipCode')).toBeInTheDocument();
    expect(screen.getByTestId('triage-count')).toHaveTextContent('0');

    fireEvent.click(screen.getByRole('button', { name: 'Trigger triage' }));

    expect(screen.queryByRole('dialog', { name: 'Review board' })).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith('github:triage-issues', expect.anything());
  });

  it('closes archive and triage confirmation dialogs without invoking mutations', async () => {
    const triageCandidate = makeIssue({
      id: 'candidate-close',
      issueNumber: 26,
      title: 'Close dialogs candidate',
    });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return makePanelData();
      if (channel === 'github:list-issues') return [triageCandidate];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Close dialogs candidate')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Archive first' }));
    expect(await screen.findByRole('dialog', { name: 'Archive issues' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close archive' }));
    expect(screen.queryByRole('dialog', { name: 'Archive issues' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Trigger triage' }));
    expect(await screen.findByRole('dialog', { name: 'Review board' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close triage' }));
    expect(screen.queryByRole('dialog', { name: 'Review board' })).not.toBeInTheDocument();

    expect(invokeMock).not.toHaveBeenCalledWith('github:archive-issue', expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith('github:triage-issues', expect.anything());
  });

  it('does not auto-run when there is no active project', async () => {
    useAppStore.setState({ activeProjectId: null });
    invokeMock.mockResolvedValue(null);

    renderWithProviders();

    expect(screen.getByTestId('issue-count')).toHaveTextContent('0');
    fireEvent.click(screen.getByRole('button', { name: 'Trigger auto run' }));

    expect(invokeMock).not.toHaveBeenCalledWith('github:auto-run', expect.anything());
  });

  it('keeps guarded board actions inert when an issue is visible without an active project', async () => {
    useAppStore.setState({
      activeProjectId: null,
      pendingCreatedIssues: [
        makeIssue({
          id: 'orphan-pending',
          projectId: null as never,
          title: 'Orphan pending issue',
        }),
      ],
    });
    invokeMock.mockResolvedValue(null);

    renderWithProviders();

    expect(screen.getByText('Orphan pending issue')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh board' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trigger triage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark done first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trigger auto run' }));

    expect(invokeMock).not.toHaveBeenCalledWith('github:refresh-issues', expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith('github:triage-issues', expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith('issue:mark-done', expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith('github:auto-run', expect.anything());
  });

  it('merges pending created issues without duplicating cached issues', async () => {
    const cachedIssue = makeIssue({ id: 'cached-1', title: 'Cached issue' });
    const pendingIssue = makeIssue({ id: 'pending-1', title: 'Pending issue' });
    const duplicatePendingIssue = makeIssue({ id: 'cached-1', title: 'Duplicate pending issue' });
    const otherProjectPendingIssue = makeIssue({
      id: 'other-project-pending',
      projectId: 'project-2',
      title: 'Other project pending',
    });

    useAppStore.setState({
      pendingCreatedIssues: [pendingIssue, duplicatePendingIssue, otherProjectPendingIssue],
    });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return makePanelData();
      if (channel === 'github:list-issues') return [cachedIssue];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Pending issue')).toBeInTheDocument();
    expect(screen.getByTestId('issue-count')).toHaveTextContent('2');
    expect(screen.queryByText('Duplicate pending issue')).not.toBeInTheDocument();
    expect(screen.queryByText('Other project pending')).not.toBeInTheDocument();
  });

  it('maps idle automation threads to todo cards with default title and body', async () => {
    const automationThread = makeThread({
      id: 'automation-idle',
      automationId: 'automation-1',
      githubIssueNumber: null,
      status: 'idle',
      title: '',
      prompt: '',
    });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data')
        return makePanelData({ threads: [automationThread] });
      if (channel === 'github:list-issues') return [];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Automation run')).toBeInTheDocument();
    expect(screen.getByTestId('first-status')).toHaveTextContent('todo');
  });

  it('flashes cards when a cached issue changes status and clears the flash timeout', async () => {
    const issue = makeIssue({ id: 'flash-issue', title: 'Flash issue', pipelineStatus: 'todo' });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return makePanelData();
      if (channel === 'github:list-issues') return [issue];
      if (channel === 'github:refresh-issues') {
        return [{ ...issue, pipelineStatus: 'planning' }];
      }
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Flash issue')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh board' }));

    await waitFor(() => {
      expect(screen.getByTestId('flashing-issues')).toHaveTextContent('flash-issue');
    });

    await waitFor(
      () => {
        expect(screen.getByTestId('flashing-issues')).toHaveTextContent('');
      },
      { timeout: 2500 },
    );
  });

  it('refreshes branches with fetch and writes the fresh branch list into board props', async () => {
    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'thread-panel:get-data') return makePanelData({ branches: ['main'] });
      if (channel === 'github:list-issues') return [makeIssue()];
      if (channel === 'git:list-branches') {
        return (args as { fetch?: boolean }).fetch ? ['main', 'release'] : ['main'];
      }
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Ship your first change with ShipCode')).toBeInTheDocument();
    expect(screen.getByTestId('branches')).toHaveTextContent('main');

    fireEvent.click(screen.getByRole('button', { name: 'Trigger branch refresh' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('git:list-branches', {
        projectId: project.id,
        fetch: true,
      });
    });
    expect(await screen.findByTestId('branches')).toHaveTextContent('main,release');
  });

  it('refreshes the board from the board callback', async () => {
    const issue = makeIssue({ id: 'refresh-issue', title: 'Refresh issue' });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return makePanelData();
      if (channel === 'github:list-issues') return [issue];
      if (channel === 'github:refresh-issues') return [issue];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Refresh issue')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh board' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:refresh-issues', {
        projectId: project.id,
        force: true,
      });
    });
  });

  it('keeps the board mounted when manual refresh fails', async () => {
    const issue = makeIssue({ id: 'refresh-failure', title: 'Refresh failure issue' });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return makePanelData();
      if (channel === 'github:list-issues') return [issue];
      if (channel === 'github:refresh-issues') throw new Error('refresh failed');
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Refresh failure issue')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh board' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:refresh-issues', {
        projectId: project.id,
        force: true,
      });
    });
    expect(screen.getByText('Refresh failure issue')).toBeInTheDocument();
  });

  it('routes issue lifecycle actions through the correct IPC channels', async () => {
    const thread = makeThread({ id: 'thread-1', status: 'paused', pausedPhase: 'executing' });
    const issue = makeIssue({ threadId: thread.id, pipelineStatus: 'paused' });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return makePanelData({ threads: [thread] });
      if (channel === 'github:list-issues') return [issue];
      if (channel === 'git:list-branches') return ['main'];
      if (channel === 'github:auto-run-count') return { count: 0 };
      if (channel === 'pipeline:create-pr') {
        return { prNumber: 42, prUrl: 'https://github.com/shipshitdev/shipcode/pull/42' };
      }
      if (channel === 'github:refresh-issues') return [issue];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText(issue.title)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rerun first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create PR first' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:start-issue', {
        projectId: project.id,
        issueNumber: issue.issueNumber,
      });
      expect(invokeMock).toHaveBeenCalledWith('pipeline:retry', { threadId: thread.id });
      expect(invokeMock).toHaveBeenCalledWith('pipeline:pause', { threadId: thread.id });
      expect(invokeMock).toHaveBeenCalledWith('pipeline:resume', { threadId: thread.id });
      expect(invokeMock).toHaveBeenCalledWith('pipeline:cancel', { threadId: thread.id });
      expect(invokeMock).toHaveBeenCalledWith('pipeline:create-pr', { threadId: thread.id });
      expect(invokeMock).toHaveBeenCalledWith('shell:open-external', {
        url: 'https://github.com/shipshitdev/shipcode/pull/42',
      });
    });
  });

  it('selects, comments, and opens external links from board callbacks', async () => {
    const issue = makeIssue({
      id: 'issue-linked',
      issueNumber: 42,
      threadId: 'thread-linked',
      linkedPrUrl: 'https://github.com/acme/repo/pull/42',
    });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return makePanelData();
      if (channel === 'github:list-issues') return [issue];
      if (channel === 'shell:open-external') return undefined;
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText(issue.title)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));
    expect(useAppStore.getState().activeIssue?.id).toBe(issue.id);

    fireEvent.click(screen.getByRole('button', { name: 'Comment first' }));
    expect(useAppStore.getState().commentComposerRequest?.issueId).toBe(issue.id);

    fireEvent.click(screen.getByRole('button', { name: 'Open repo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open pull request' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('shell:open-external', {
        url: 'https://github.com/acme/repo',
      });
      expect(invokeMock).toHaveBeenCalledWith('shell:open-external', {
        url: 'https://github.com/acme/repo/pull/42',
      });
    });
  });

  it('routes automation selection and comments to the terminal without opening a composer', async () => {
    const automationThread = makeThread({
      id: 'automation-select',
      automationId: 'automation-1',
      githubIssueNumber: null,
      title: '[Auto] select',
      status: 'executing',
    });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data')
        return makePanelData({ threads: [automationThread] });
      if (channel === 'github:list-issues') return [];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('[Auto] select')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Comment first' }));

    await waitFor(() => {
      const state = useAppStore.getState();
      expect(state.activeAutomationThreadId).toBe(automationThread.id);
      expect(state.terminalThreadId).toBe(automationThread.id);
      expect(state.commentComposerRequest).toBeNull();
    });
  });

  it('ignores guarded board actions when required ids are missing', async () => {
    const issue = makeIssue({ id: 'unguarded', threadId: null, pipelineStatus: 'todo' });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return makePanelData();
      if (channel === 'github:list-issues') return [issue];
      if (channel === 'github:refresh-issues') return [issue];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText(issue.title)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Pause first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create PR first' }));

    expect(invokeMock).not.toHaveBeenCalledWith('pipeline:pause', expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith('pipeline:resume', expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith('pipeline:cancel', expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith('pipeline:create-pr', expect.anything());
  });

  it('archives one issue and then all closed issues through confirmation dialogs', async () => {
    const doneIssue = makeIssue({
      id: 'done-1',
      issueNumber: 77,
      pipelineStatus: 'closed',
      state: 'closed',
    });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return makePanelData();
      if (channel === 'github:list-issues') return [doneIssue];
      if (channel === 'github:archive-issue') return undefined;
      if (channel === 'github:archive-all-done') return { archivedCount: 1, failedCount: 0 };
      if (channel === 'github:refresh-issues') return [];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText(doneIssue.title)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Archive first' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm archive' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:archive-issue', {
        projectId: project.id,
        issueId: doneIssue.id,
        issueNumber: doneIssue.issueNumber,
      });
    });
    expect(await screen.findByText(/Issue #77 archived/i)).toBeInTheDocument();

    invokeMock.mockClear();
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return makePanelData();
      if (channel === 'github:list-issues') return [doneIssue];
      if (channel === 'github:archive-all-done') return { archivedCount: 1, failedCount: 0 };
      if (channel === 'github:refresh-issues') return [];
      return null;
    });

    fireEvent.click(screen.getByRole('button', { name: 'Archive all done' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm archive' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:archive-all-done', {
        projectId: project.id,
      });
    });
    expect(await screen.findByText('Archived 1 issues.')).toBeInTheDocument();
  });

  it('reports archive failures for one issue and all closed issues', async () => {
    const doneIssue = makeIssue({
      id: 'done-failure',
      issueNumber: 78,
      pipelineStatus: 'closed',
      state: 'closed',
    });
    let failSingle = true;

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return makePanelData();
      if (channel === 'github:list-issues') return [doneIssue];
      if (channel === 'github:archive-issue') {
        if (failSingle) throw new Error('archive failed');
        return undefined;
      }
      if (channel === 'github:archive-all-done') throw new Error('archive all failed');
      if (channel === 'github:refresh-issues') return [doneIssue];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText(doneIssue.title)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Archive first' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm archive' }));
    expect(await screen.findByText('Failed to archive issue #78.')).toBeInTheDocument();

    failSingle = false;
    fireEvent.click(screen.getByRole('button', { name: 'Archive all done' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm archive' }));
    expect(await screen.findByText('Failed to archive closed issues.')).toBeInTheDocument();
  });

  it('archives closed automation runs optimistically through archive-all', async () => {
    const automationThread = makeThread({
      id: 'automation-closed',
      automationId: 'automation-1',
      githubIssueNumber: null,
      title: '[Auto] closed',
      status: 'completed',
      doneAt: '2026-04-22T11:00:00.000Z',
    });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data')
        return makePanelData({ threads: [automationThread] });
      if (channel === 'github:list-issues') return [];
      if (channel === 'github:archive-all-done') return { archivedCount: 1, failedCount: 0 };
      if (channel === 'github:refresh-issues') return [];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('[Auto] closed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Archive all done' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm archive' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:archive-all-done', {
        projectId: project.id,
      });
    });
  });

  it('invalidates thread data after successfully closing an automation run', async () => {
    const automationThread = makeThread({
      id: 'automation-close-success',
      automationId: 'automation-1',
      githubIssueNumber: null,
      title: '[Auto] close success',
      status: 'completed',
      doneAt: null,
    });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data')
        return makePanelData({ threads: [automationThread] });
      if (channel === 'github:list-issues') return [];
      if (channel === 'issue:mark-done') return undefined;
      if (channel === 'github:refresh-issues') return [];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('[Auto] close success')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark done first' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('issue:mark-done', {
        projectId: project.id,
        issueId: `automation:${automationThread.id}`,
        issueNumber: expect.any(Number),
      });
      expect(invokeMock).toHaveBeenCalledWith('thread-panel:get-data', {
        projectId: project.id,
      });
    });
  });

  it('rolls back failed automation close and rerun mutations', async () => {
    const automationThread = makeThread({
      id: 'automation-failure',
      automationId: 'automation-1',
      githubIssueNumber: null,
      title: '[Auto] failure',
      status: 'completed',
      doneAt: '2026-04-22T11:00:00.000Z',
    });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data')
        return makePanelData({ threads: [automationThread] });
      if (channel === 'github:list-issues') return [];
      if (channel === 'issue:mark-done') throw new Error('mark done failed');
      if (channel === 'pipeline:retry') throw new Error('rerun failed');
      if (channel === 'github:refresh-issues') return [];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('[Auto] failure')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark done first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rerun first' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('issue:mark-done', {
        projectId: project.id,
        issueId: `automation:${automationThread.id}`,
        issueNumber: expect.any(Number),
      });
      expect(invokeMock).toHaveBeenCalledWith('pipeline:retry', {
        threadId: automationThread.id,
      });
    });
    expect(screen.getByText('[Auto] failure')).toBeInTheDocument();
  });

  it('marks an issue done and reports archive cleanup failures', async () => {
    const issue = makeIssue({ id: 'issue-close', issueNumber: 91 });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return makePanelData();
      if (channel === 'github:list-issues') return [issue];
      if (channel === 'issue:mark-done') return undefined;
      if (channel === 'github:archive-all-done') return { archivedCount: 1, failedCount: 2 };
      if (channel === 'github:refresh-issues') return [issue];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText(issue.title)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark done first' }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('issue:mark-done', {
        projectId: project.id,
        issueId: issue.id,
        issueNumber: issue.issueNumber,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Archive all done' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm archive' }));

    expect(await screen.findByText(/2 still need GitHub cleanup/i)).toBeInTheDocument();
  });

  it('handles rejected board mutations by refreshing or keeping the board responsive', async () => {
    const issue = makeIssue({
      id: 'issue-reject',
      issueNumber: 123,
      threadId: 'thread-reject',
      pipelineStatus: 'executing',
    });

    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'thread-panel:get-data') {
        return makePanelData({
          threads: [makeThread({ id: 'thread-reject', status: 'executing' })],
        });
      }
      if (channel === 'github:list-issues') return [issue];
      if (channel === 'git:list-branches') {
        if ((args as { fetch?: boolean } | undefined)?.fetch) throw new Error('fetch failed');
        return ['main'];
      }
      if (channel === 'project:set-default-branch') throw new Error('branch failed');
      if (channel === 'github:start-issue') throw new Error('start failed');
      if (channel === 'pipeline:retry') throw new Error('retry failed');
      if (channel === 'pipeline:pause') throw new Error('pause failed');
      if (channel === 'pipeline:resume') throw new Error('resume failed');
      if (channel === 'pipeline:cancel') throw new Error('cancel failed');
      if (channel === 'pipeline:create-pr') throw new Error('pr failed');
      if (channel === 'issue:mark-done') throw new Error('close failed');
      if (channel === 'github:auto-run') throw new Error('auto failed');
      if (channel === 'settings:set') throw new Error('settings failed');
      if (channel === 'shell:open-external') throw new Error('open failed');
      if (channel === 'task-graph:get-latest') throw new Error('graph failed');
      if (channel === 'github:refresh-issues') return [issue];
      if (channel === 'github:auto-run-count') return { count: 1 };
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText(issue.title)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open repo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open pull request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trigger branch refresh' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change base branch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rerun first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create PR first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark done first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change auto priorities' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trigger auto run' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fetch steps' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:refresh-issues', {
        projectId: project.id,
        force: true,
      });
      expect(invokeMock).toHaveBeenCalledWith('pipeline:create-pr', {
        threadId: issue.threadId,
      });
      expect(invokeMock).toHaveBeenCalledWith('task-graph:get-latest', {
        threadId: issue.threadId,
      });
    });
    expect(screen.getByText(issue.title)).toBeInTheDocument();
  });

  it('ignores a failed browser open after creating a pull request', async () => {
    const issue = makeIssue({
      id: 'issue-pr-open-fails',
      issueNumber: 124,
      threadId: 'thread-pr-open-fails',
      pipelineStatus: 'completed',
    });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') {
        return makePanelData({
          threads: [makeThread({ id: 'thread-pr-open-fails', status: 'completed' })],
        });
      }
      if (channel === 'github:list-issues') return [issue];
      if (channel === 'pipeline:create-pr') {
        return { prNumber: 44, prUrl: 'https://github.com/shipshitdev/shipcode/pull/44' };
      }
      if (channel === 'shell:open-external') throw new Error('open failed');
      if (channel === 'github:refresh-issues') return [issue];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText(issue.title)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create PR first' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('pipeline:create-pr', {
        threadId: issue.threadId,
      });
      expect(invokeMock).toHaveBeenCalledWith('shell:open-external', {
        url: 'https://github.com/shipshitdev/shipcode/pull/44',
      });
    });
  });

  it('saves auto-run priorities and starts auto-run with the current settings', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') {
        return makePanelData({
          settings: { ...DEFAULT_SETTINGS, autoRunPriorities: ['p1'], autoRunMaxTasks: 3 },
        });
      }
      if (channel === 'github:list-issues') return [makeIssue()];
      if (channel === 'git:list-branches') return ['main'];
      if (channel === 'github:auto-run-count') return { count: 2 };
      if (channel === 'github:refresh-issues') return [makeIssue({ pipelineStatus: 'planning' })];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Ship your first change with ShipCode')).toBeInTheDocument();
    expect(await screen.findByTestId('auto-run-count')).toHaveTextContent('2');

    fireEvent.click(screen.getByRole('button', { name: 'Change auto priorities' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('settings:set', {
        autoRunPriorities: ['p0', 'p2'],
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Trigger auto run' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:auto-run', {
        projectId: project.id,
        priorities: ['p0', 'p2'],
        maxTasks: 3,
      });
    });
  });

  it('fetches and normalizes plan steps from the latest task graph', async () => {
    const graph: TaskGraphWithNodes = {
      id: 'graph-1',
      threadId: 'thread-1',
      planId: 'plan-1',
      mode: 'internal',
      status: 'active',
      riskScore: 42,
      assessment: {
        mode: 'internal',
        shouldDecompose: true,
        riskScore: 42,
        reasons: [],
        suggestedNodeCount: 1,
        surfaces: ['general'],
      },
      nodes: [
        {
          id: 'node-1',
          graphId: 'graph-1',
          stableKey: 'node-1',
          order: 1,
          title: 'Implement the route',
          description: 'Implement the route',
          status: 'completed',
          agentRole: 'general',
          suggestedExecutorModel: null,
          suggestedReasoningEffort: 'medium',
          surfaces: ['general'],
          files: [],
          acceptanceCriteria: [],
          githubIssueNumber: null,
          startedAt: null,
          completedAt: null,
          createdAt: '2026-04-22T10:00:00.000Z',
          updatedAt: '2026-04-22T10:00:00.000Z',
        },
      ],
      edges: [],
      createdAt: '2026-04-22T10:00:00.000Z',
      updatedAt: '2026-04-22T10:00:00.000Z',
    };

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return makePanelData({ threads: [makeThread()] });
      if (channel === 'github:list-issues') return [makeIssue({ threadId: 'thread-1' })];
      if (channel === 'task-graph:get-latest') return graph;
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Ship your first change with ShipCode')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fetch steps' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('task-graph:get-latest', {
        threadId: 'thread-1',
      });
    });
  });

  it('treats missing task graph nodes as no plan steps', async () => {
    const graphWithoutNodes = {
      id: 'graph-empty',
      threadId: 'thread-1',
      nodes: [],
    };

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return makePanelData({ threads: [makeThread()] });
      if (channel === 'github:list-issues') return [makeIssue({ threadId: 'thread-1' })];
      if (channel === 'task-graph:get-latest') return graphWithoutNodes;
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Ship your first change with ShipCode')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fetch steps' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('task-graph:get-latest', {
        threadId: 'thread-1',
      });
    });
  });
});
