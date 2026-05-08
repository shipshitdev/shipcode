// @vitest-environment jsdom

import {
  formatRelativeTime,
  type GitHubIssueCacheRecord,
  type NotificationRecord,
  type Thread,
} from '@shipcode/shared';
import { TooltipProvider } from '@shipcode/ui';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { InboxView } from './InboxView';

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
      <TooltipProvider>
        <InboxView />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function makeIssue(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 42,
    title: 'Fallback issue',
    body: 'Issue body',
    labels: [],
    assignee: null,
    state: 'open',
    pipelineStatus: 'todo',
    threadId: 'current-thread',
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
    fetchedAt: '2026-04-21T10:00:00.000Z',
    priorityRank: null,
    priorityRaw: null,
    priorityFetchedAt: null,
    isQuickMode: false,
    ...overrides,
  };
}

describe('InboxView', () => {
  const notifications: NotificationRecord[] = [
    {
      id: 'notification-1',
      projectId: 'project-1',
      threadId: 'thread-1',
      kind: 'awaiting_approval',
      title: 'Approval needed for demo task',
      body: 'Pipeline paused before execution.',
      createdAt: '2026-04-21T10:00:00.000Z',
      dismissedAt: null,
    },
    {
      id: 'notification-2',
      projectId: 'project-1',
      threadId: 'thread-2',
      kind: 'failed',
      title: 'Execution failed for demo task',
      body: 'The executor exited non-zero.',
      createdAt: '2026-04-21T11:00:00.000Z',
      dismissedAt: null,
    },
  ];

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useAppStore.setState({
      activeProjectId: 'existing-project',
      activeThreadId: null,
      activeIssue: null,
      activeAutomationThreadId: null,
      viewMode: 'inbox',
      githubIssues: [],
      notifications: notifications,
    });
    (window as typeof window & { shipcode: typeof window.shipcode }).shipcode = {
      invoke: vi.fn(async (channel: string) => {
        if (channel === 'notification:list') return notifications;
        if (channel === 'notification:dismiss') return null;
        if (channel === 'notification:dismiss-all') return null;
        if (channel === 'github:list-issues') return [];
        if (channel === 'thread:get') return null;
        return null;
      }) as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as typeof window.shipcode.on,
    };
  });

  it('labels approval-gated notifications without a redundant secondary badge', async () => {
    renderWithProviders();

    expect(await screen.findByText('Needs approval')).toBeInTheDocument();
    expect(screen.queryByText('Approval required')).not.toBeInTheDocument();
  });

  it('filters inbox rows down to approval-gated notifications', async () => {
    renderWithProviders();

    expect(await screen.findByText('Execution failed for demo task')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /Needs approval/i })[0]);

    expect(screen.getByText('Approval needed for demo task')).toBeInTheDocument();
    expect(screen.queryByText('Execution failed for demo task')).toBeNull();
  });

  it('places the timestamp in the rightmost column with hover actions in the same cell', async () => {
    renderWithProviders();

    const title = await screen.findByText('Execution failed for demo task');
    const row = title.closest('tr');
    expect(row).not.toBeNull();

    const cells = within(row as HTMLTableRowElement).getAllByRole('cell');
    expect(cells).toHaveLength(3);
    expect(cells[1]).toHaveTextContent('Execution failed for demo task');
    expect(cells[2]).toHaveTextContent(formatRelativeTime(notifications[1].createdAt));
    expect(within(cells[2]).getByRole('button', { name: /Open issue/i })).toBeInTheDocument();
    expect(within(cells[2]).getByRole('button', { name: /Retry pipeline/i })).toBeInTheDocument();
    expect(
      within(cells[2]).getByRole('button', { name: /Dismiss notification/i }),
    ).toBeInTheDocument();
  });

  it('removes a failed notification immediately after retry is clicked', async () => {
    let listedNotifications = [...notifications];
    let resolveRetry: () => void = () => {};
    const retryStarted = new Promise<void>((resolve) => {
      resolveRetry = () => {
        listedNotifications = listedNotifications.filter((n) => n.id !== 'notification-2');
        resolve();
      };
    });

    vi.mocked(window.shipcode.invoke).mockImplementation(
      async (channel: string, args?: unknown) => {
        if (channel === 'notification:list') return listedNotifications;
        if (channel === 'pipeline:retry') return retryStarted;
        if (channel === 'github:list-issues') return [];
        if (channel === 'thread:get') return null;
        return args ?? null;
      },
    );

    renderWithProviders();

    const title = await screen.findByText('Execution failed for demo task');
    const row = title.closest('tr');
    expect(row).not.toBeNull();

    fireEvent.click(
      within(row as HTMLTableRowElement).getByRole('button', { name: /Retry pipeline/i }),
    );

    await waitFor(() => {
      expect(window.shipcode.invoke).toHaveBeenCalledWith('pipeline:retry', {
        threadId: 'thread-2',
      });
    });
    await waitFor(() => {
      expect(screen.queryByText('Execution failed for demo task')).not.toBeInTheDocument();
    });

    resolveRetry();

    await waitFor(() => {
      expect(screen.queryByText('Execution failed for demo task')).not.toBeInTheDocument();
    });
  });

  it('opens the issue matched by github issue number when the notification has a stale thread id', async () => {
    const fallbackIssue = makeIssue({ threadId: 'replacement-thread', issueNumber: 42 });
    vi.mocked(window.shipcode.invoke).mockImplementation(async (channel: string) => {
      if (channel === 'notification:list') return notifications;
      if (channel === 'github:list-issues') return [fallbackIssue];
      if (channel === 'thread:get') {
        return { id: 'thread-1', projectId: 'project-1', githubIssueNumber: 42 } as Thread;
      }
      return null;
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: /Open issue: Approval needed/i }));

    await waitFor(() => {
      expect(useAppStore.getState().activeProjectId).toBe('project-1');
      expect(useAppStore.getState().activeIssue?.id).toBe(fallbackIssue.id);
      expect(useAppStore.getState().activeThreadId).toBe('replacement-thread');
    });
  });

  it('opens an automation thread when no linked issue exists for the notification thread', async () => {
    vi.mocked(window.shipcode.invoke).mockImplementation(async (channel: string) => {
      if (channel === 'notification:list') return notifications;
      if (channel === 'github:list-issues') return [];
      if (channel === 'thread:get') {
        return {
          id: 'thread-2',
          projectId: 'project-1',
          automationId: 'automation-1',
        } as Thread;
      }
      return null;
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: /Open issue: Execution failed/i }));

    await waitFor(() => {
      expect(useAppStore.getState().activeAutomationThreadId).toBe('thread-2');
      expect(useAppStore.getState().activeIssue).toBeNull();
      expect(useAppStore.getState().activeThreadId).toBe('thread-2');
    });
  });

  it('restores the previous project and inbox view when issue navigation fails', async () => {
    vi.mocked(window.shipcode.invoke).mockImplementation(async (channel: string) => {
      if (channel === 'notification:list') return notifications;
      if (channel === 'github:list-issues') throw new Error('network down');
      return null;
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: /Open issue: Approval needed/i }));

    await waitFor(() => {
      expect(useAppStore.getState().activeProjectId).toBe('existing-project');
      expect(useAppStore.getState().viewMode).toBe('inbox');
      expect(useAppStore.getState().activeIssue).toBeNull();
    });
  });
});
