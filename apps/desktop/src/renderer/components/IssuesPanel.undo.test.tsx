// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import {
  DEFAULT_SETTINGS,
  type GitHubIssueCacheRecord,
  type Project,
  type Thread,
  type ThreadPanelData,
} from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';

vi.mock('electron-log/renderer', () => ({
  default: {
    error: vi.fn(),
  },
}));

vi.mock('./ThreadPanelArchiveDialog', () => ({
  ThreadPanelArchiveDialog: () => null,
}));

vi.mock('@shipcode/ui', () => ({
  AUTOMATION_ISSUE_NUMBER_BASE: -1_000_000,
  isAutomationIssue: (issue: GitHubIssueCacheRecord) =>
    !issue.isQuickMode && issue.issueNumber <= -1_000_000,
  KanbanBoard: ({
    issues,
    onMarkDone,
    onRerun,
  }: {
    issues: GitHubIssueCacheRecord[];
    onMarkDone?: (issue: GitHubIssueCacheRecord) => void;
    onRerun?: (issue: GitHubIssueCacheRecord) => void;
  }) => (
    <div>
      <div>{issues[0]?.title ?? 'Loading issues'}</div>
      <div data-testid="board-status">{issues[0]?.pipelineStatus ?? 'none'}</div>
      {issues[0] ? (
        <>
          <button type="button" onClick={() => onMarkDone?.(issues[0])}>
            Trigger mark done
          </button>
          <button type="button" onClick={() => onRerun?.(issues[0])}>
            Trigger rerun
          </button>
        </>
      ) : null}
    </div>
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

const awaitingApprovalThread: Thread = {
  id: 'thread-1',
  projectId: project.id,
  title: 'Ship your first change with ShipCode',
  prompt: 'Fix it',
  status: 'awaiting_approval',
  kind: 'pipeline',
  worktreeBranch: null,
  worktreePath: null,
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
  githubIssueNumber: 18,
  githubPrNumber: null,
  githubRepo: 'shipshitdev/shipcode',
  automationId: null,
  lastError: null,
  failurePhase: null,
  failureCount: 0,
  doneAt: null,
  createdAt: '2026-04-14T00:00:00.000Z',
  updatedAt: '2026-04-14T00:00:00.000Z',
  plannerResolvedModel: null,
  reviewerResolvedModel: null,
  revisorResolvedModel: null,
  executorResolvedModel: null,
  verifierResolvedModel: null,
  totalTokensPrompt: 0,
  totalTokensCompletion: 0,
  totalCostUsd: 0,
};

const panelData: ThreadPanelData = {
  project,
  settings: DEFAULT_SETTINGS,
  threads: [awaitingApprovalThread],
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
    threadId: awaitingApprovalThread.id,
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

describe('IssuesPanel undo done move', () => {
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
      viewMode: 'project',
      settingsVisible: false,
      sidebarCollapsed: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows an undo toast for accidental done moves and reopens on undo', async () => {
    const originalIssue = makeIssue();
    const doneIssue = makeIssue({ state: 'closed', pipelineStatus: 'done' });
    let refreshCount = 0;

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return panelData;
      if (channel === 'github:list-issues') return [originalIssue];
      if (channel === 'issue:mark-done') return undefined;
      if (channel === 'github:reopen-issue') return undefined;
      if (channel === 'github:refresh-issues') {
        refreshCount += 1;
        return refreshCount === 1 ? [doneIssue] : [originalIssue];
      }
      return null;
    });

    renderWithProviders();

    await screen.findByText(originalIssue.title);
    fireEvent.click(await screen.findByRole('button', { name: 'Trigger mark done' }));

    expect(await screen.findByText('Moved #18 to Done')).toBeInTheDocument();
    expect(screen.getByText(/restore it to awaiting approval/i)).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith('issue:mark-done', {
      projectId: project.id,
      issueId: originalIssue.id,
      issueNumber: originalIssue.issueNumber,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:reopen-issue', {
        projectId: project.id,
        issueNumber: originalIssue.issueNumber,
      });
    });
  });

  it('optimistically moves completed linked-PR issues into done when the badge is clicked', async () => {
    const completedIssue = makeIssue({
      pipelineStatus: 'completed',
      linkedPrNumber: 91,
      linkedPrUrl: 'https://github.com/shipshitdev/shipcode/pull/91',
    });
    const doneIssue = makeIssue({
      pipelineStatus: 'done',
      state: 'closed',
      linkedPrNumber: 91,
      linkedPrUrl: 'https://github.com/shipshitdev/shipcode/pull/91',
    });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') return panelData;
      if (channel === 'github:list-issues') return [completedIssue];
      if (channel === 'issue:mark-done') return undefined;
      if (channel === 'github:refresh-issues') return [doneIssue];
      return null;
    });

    renderWithProviders();

    await screen.findByText(completedIssue.title);
    expect(screen.getByTestId('board-status')).toHaveTextContent('completed');

    fireEvent.click(await screen.findByRole('button', { name: 'Trigger mark done' }));

    await waitFor(() => {
      expect(screen.getByTestId('board-status')).toHaveTextContent('done');
    });
    expect(invokeMock).toHaveBeenCalledWith('issue:mark-done', {
      projectId: project.id,
      issueId: completedIssue.id,
      issueNumber: completedIssue.issueNumber,
    });
  });

  it('retries failed automation cards through pipeline retry and moves them to planning', async () => {
    const automationThread: Thread = {
      ...awaitingApprovalThread,
      id: 'automation-thread-1',
      githubIssueNumber: null,
      automationId: 'automation-1',
      status: 'failed',
      title: '[Auto] clean',
      failurePhase: 'executing',
      lastError: 'failed',
    };
    let retried = false;

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread-panel:get-data') {
        return {
          ...panelData,
          threads: [
            retried
              ? { ...automationThread, status: 'planning', updatedAt: new Date().toISOString() }
              : automationThread,
          ],
          latestPlanStatusByThreadId: {},
        } satisfies ThreadPanelData;
      }
      if (channel === 'github:list-issues') return [];
      if (channel === 'pipeline:retry') {
        retried = true;
        return undefined;
      }
      return null;
    });

    renderWithProviders();

    await screen.findByText('[Auto] clean');
    expect(screen.getByTestId('board-status')).toHaveTextContent('failed');

    fireEvent.click(await screen.findByRole('button', { name: 'Trigger rerun' }));

    await waitFor(() => {
      expect(screen.getByTestId('board-status')).toHaveTextContent('planning');
    });
    expect(invokeMock).toHaveBeenCalledWith('pipeline:retry', {
      threadId: automationThread.id,
    });
    expect(invokeMock).not.toHaveBeenCalledWith('github:start-issue', expect.anything());
  });
});
