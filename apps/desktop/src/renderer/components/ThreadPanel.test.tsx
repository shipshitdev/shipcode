// @vitest-environment jsdom

import {
  DEFAULT_SETTINGS,
  type GitHubIssueCacheRecord,
  type Project,
  type Thread,
  type ThreadPanelData,
} from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Profiler, type ProfilerOnRenderCallback, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { ThreadPanel } from './ThreadPanel';

vi.mock('electron-log/renderer', () => ({
  default: {
    error: vi.fn(),
  },
}));

function renderWithProviders(onRender?: ProfilerOnRenderCallback) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });

  return render(
    <StrictMode>
      {onRender ? (
        <Profiler id="thread-panel" onRender={onRender}>
          <QueryClientProvider client={queryClient}>
            <ThreadPanel />
          </QueryClientProvider>
        </Profiler>
      ) : (
        <QueryClientProvider client={queryClient}>
          <ThreadPanel />
        </QueryClientProvider>
      )}
    </StrictMode>,
  );
}

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

const panelData: ThreadPanelData = {
  project,
  settings: DEFAULT_SETTINGS,
  threads: [],
  latestPlanStatusByThreadId: {},
  branches: [],
};

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
    pipelineStatus: 'awaiting_approval',
    threadId: 'thread-1',
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
    githubIssueNumber: null,
    githubPrNumber: null,
    githubRepo: null,
    automationId: null,
    lastError: null,
    failurePhase: null,
    failureCount: 0,
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
    ...overrides,
  };
}

describe('ThreadPanel', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    cleanup();
    invokeMock.mockReset();
    window.shipcode = {
      invoke: invokeMock as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}),
    };

    useAppStore.setState({
      activeProjectId: project.id,
      activeIssue: null,
      githubIssues: [],
      viewMode: 'project',
      settingsVisible: false,
      sidebarCollapsed: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('does not loop while github issues are still loading', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return panelData;
      if (channel === 'github:list-issues') {
        return new Promise<GitHubIssueCacheRecord[]>(() => {});
      }
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('ShipCode')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh board/i })).toBeInTheDocument();
  });

  it('opens the issue detail sidebar from the explicit card action while collapsed', async () => {
    const issue = makeIssue();

    useAppStore.setState({});

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return panelData;
      if (channel === 'github:list-issues') return [issue];
      return null;
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: /open issue detail/i }));

    await waitFor(() => {
      const state = useAppStore.getState();
      expect(state.activeIssue?.id).toBe(issue.id);
      expect(state.activeThreadId).toBe(issue.threadId);
    });
  });

  it('labels approved waiters as waiting for execution when the latest plan is approved', async () => {
    const issue = makeIssue({ id: 'issue-slot-waiter', title: 'Approved waiter' });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') {
        return {
          ...panelData,
          latestPlanStatusByThreadId: { [issue.threadId as string]: 'approved' },
        } satisfies ThreadPanelData;
      }
      if (channel === 'github:list-issues') return [issue];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Waiting For Execution')).toBeInTheDocument();
    expect(await screen.findByText('Approved waiter')).toBeInTheDocument();
  });

  it('renders automation runs as Kanban cards and opens their run detail', async () => {
    const automationThread = makeThread({
      id: 'automation-thread-1',
      title: '[Auto] Nightly cleanup',
      prompt: 'Run the nightly cleanup task.',
      status: 'executing',
      automationId: 'automation-1',
    });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') {
        return {
          ...panelData,
          threads: [automationThread],
        } satisfies ThreadPanelData;
      }
      if (channel === 'github:list-issues') return [];
      return null;
    });

    renderWithProviders();

    const title = await screen.findByText('[Auto] Nightly cleanup');
    expect(screen.getByText('Auto')).toBeInTheDocument();

    fireEvent.click(title);

    await waitFor(() => {
      const state = useAppStore.getState();
      expect(state.activeAutomationThreadId).toBe(automationThread.id);
      expect(state.activeThreadId).toBe(automationThread.id);
      expect(state.terminalThreadId).toBe(automationThread.id);
      expect(state.terminalVisible).toBe(true);
    });
  });

  it('does not rerender on unrelated app-store updates', async () => {
    const issue = makeIssue();
    const onRender = vi.fn<ProfilerOnRenderCallback>();

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return panelData;
      if (channel === 'github:list-issues') return [issue];
      return null;
    });

    renderWithProviders(onRender);

    expect(await screen.findByText(issue.title)).toBeInTheDocument();

    onRender.mockClear();

    act(() => {
      useAppStore.setState({ terminalVisible: true });
    });

    expect(onRender).not.toHaveBeenCalled();
  });

  it('hides the board quick-link when no GitHub Projects URL is configured', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return panelData;
      if (channel === 'github:list-issues') return [makeIssue()];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Ship your first change with ShipCode')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'repo' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'board' })).not.toBeInTheDocument();
  });

  it('shows the board quick-link when a GitHub Projects URL is configured', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') {
        return {
          ...panelData,
          project: {
            ...project,
            githubProjectUrl: 'https://github.com/orgs/shipshitdev/projects/1',
          },
        } satisfies ThreadPanelData;
      }
      if (channel === 'github:list-issues') return [makeIssue()];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Ship your first change with ShipCode')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'board' })).toBeInTheDocument();
  });
});
