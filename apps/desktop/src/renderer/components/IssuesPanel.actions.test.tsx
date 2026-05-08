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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';

type MockBoardProps = {
  issues: GitHubIssueCacheRecord[];
  triageCandidateCount?: number;
  refreshingBranches?: boolean;
  branches?: string[];
  autoRunCount?: number;
  onTriageIssues?: () => void;
  onRefreshBranches?: () => void;
  onBaseBranchChange?: (branch: string) => void;
  onStartPipeline?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onRetry?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onRerun?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onPause?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onResume?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onCancel?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onCreatePr?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
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
  ThreadPanelArchiveDialog: () => null,
}));

vi.mock('./ThreadPanelBoardReviewDialog', () => ({
  ThreadPanelBoardReviewDialog: ({
    open,
    count,
    onConfirm,
  }: {
    open: boolean;
    count: number;
    onConfirm: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Review board">
        <span>Reviewing {count}</span>
        <button type="button" onClick={onConfirm}>
          Confirm triage
        </button>
      </div>
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
    onTriageIssues,
    onRefreshBranches,
    onBaseBranchChange,
    onStartPipeline,
    onRetry,
    onRerun,
    onPause,
    onResume,
    onCancel,
    onCreatePr,
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
        {first ? <div>{first.title}</div> : null}
        <button type="button" onClick={() => onTriageIssues?.()}>
          Trigger triage
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
      githubIssues: [],
      pendingCreatedIssues: [],
      viewMode: 'project',
      settingsVisible: false,
      sidebarCollapsed: false,
    });
  });

  afterEach(() => {
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
      threadId: 'thread-1',
      version: 1,
      nodes: [
        {
          id: 'node-1',
          taskGraphId: 'graph-1',
          parentId: null,
          order: 1,
          title: 'Implement the route',
          summary: null,
          description: null,
          status: 'completed',
          agentRole: 'implementer',
          assignedAgent: null,
          dependencies: [],
          acceptanceCriteria: [],
          filesTouched: [],
          verificationNotes: null,
          startedAt: null,
          completedAt: null,
          createdAt: '2026-04-22T10:00:00.000Z',
          updatedAt: '2026-04-22T10:00:00.000Z',
        },
      ],
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
});
