// @vitest-environment jsdom

import type { DashboardOverview } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { OverviewView } from './OverviewView';

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
      <OverviewView />
    </QueryClientProvider>,
  );
}

describe('OverviewView', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    window.shipcode.on = vi.fn(() => () => {}) as unknown as typeof window.shipcode.on;

    useAppStore.setState({
      activeProjectId: null,
      activeThreadId: null,
      activeIssue: null,
      githubIssues: [],
    } as never);

    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'dashboard:get-overview') {
        return {
          stats: {
            agentsRunning: 1,
            runningByPhase: { planning: 1 },
            agentsRunningByProject: { 'project-1': 1 },
            pendingApprovalsByProject: {},
            tasksInProgress: 1,
            tasksOpen: 1,
            tasksBlocked: 0,
            pendingApprovals: 0,
            staleApprovals: 0,
            shippedLast7d: 0,
            failedLast7d: 0,
          },
          running: [
            {
              threadId: 'thread-14',
              projectId: 'project-1',
              projectName: 'meterbarapp',
              threadTitle: 'ClaudeCodeLocalService: replace cross-app keychain access',
              phase: 'planning',
              startedAt: Date.now() - 129_000,
              activeProcessId: 'process-14',
              githubIssueNumber: 14,
              modelProvider: 'codex',
              model: 'gpt-5.4',
              reasoningEffort: 'high',
            },
          ],
          activity: [],
          activityTotal: 0,
          recent: [],
          recentTotal: 0,
        } satisfies DashboardOverview;
      }

      if (channel === 'pipeline:cancel') return null;
      if (channel === 'github:list-issues') return [];

      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders running agents with the kanban active-card treatment', async () => {
    const { container } = renderWithProviders();

    expect(
      await screen.findByText('ClaudeCodeLocalService: replace cross-app keychain access'),
    ).toBeInTheDocument();
    expect(screen.getByText('meterbarapp')).toBeInTheDocument();
    expect(screen.getByText('#14')).toBeInTheDocument();
    expect(screen.getByText('GPT-5.4 · high')).toBeInTheDocument();
    expect(container.querySelector('.issue-card-active-bg')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /stop/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('pipeline:cancel', { threadId: 'thread-14' });
    });
  });

  it('does not style detached activity rows as clickable', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'dashboard:get-overview') {
        return {
          stats: {
            agentsRunning: 0,
            runningByPhase: {},
            agentsRunningByProject: {},
            pendingApprovalsByProject: {},
            tasksInProgress: 0,
            tasksOpen: 0,
            tasksBlocked: 0,
            pendingApprovals: 0,
            staleApprovals: 0,
            shippedLast7d: 0,
            failedLast7d: 0,
          },
          running: [],
          activity: [
            {
              id: 'activity-1',
              threadId: null,
              projectId: null,
              kind: 'notification_fired',
              actor: 'system',
              title: 'Detached activity',
              subtitle: 'No linked project or thread',
              metadata: null,
              createdAt: new Date('2026-04-22T00:00:00.000Z').toISOString(),
            },
          ],
          activityTotal: 1,
          recent: [],
          recentTotal: 0,
        } satisfies DashboardOverview;
      }

      if (channel === 'github:list-issues') return [];

      return null;
    });

    renderWithProviders();

    const row = (await screen.findByText('Detached activity')).closest('tr');
    expect(row).not.toBeNull();
    expect(row).not.toHaveClass('cursor-pointer');

    fireEvent.click(row as HTMLTableRowElement);

    expect(useAppStore.getState().activeProjectId).toBeNull();
    expect(useAppStore.getState().activeThreadId).toBeNull();
    expect(invokeMock).not.toHaveBeenCalledWith('github:list-issues', expect.anything());
  });

  it('shows approved execution waiters as waiting for slot in running cards', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'dashboard:get-overview') {
        return {
          stats: {
            agentsRunning: 1,
            runningByPhase: { awaiting_approval: 1 },
            agentsRunningByProject: {},
            pendingApprovalsByProject: {},
            tasksInProgress: 1,
            tasksOpen: 1,
            tasksBlocked: 0,
            pendingApprovals: 0,
            staleApprovals: 0,
            shippedLast7d: 0,
            failedLast7d: 0,
          },
          running: [
            {
              threadId: 'thread-19',
              projectId: 'project-1',
              projectName: 'vitayai',
              threadTitle: 'Approved but waiting for an execution slot',
              phase: 'awaiting_approval',
              approvedAwaitingExecution: true,
              startedAt: Date.now() - 45_000,
              activeProcessId: null,
              githubIssueNumber: 19,
              modelProvider: 'claude',
              model: 'claude-sonnet-4-6',
              reasoningEffort: 'high',
            },
          ],
          activity: [],
          activityTotal: 0,
          recent: [],
          recentTotal: 0,
        } satisfies DashboardOverview;
      }

      if (channel === 'pipeline:cancel') return null;
      if (channel === 'github:list-issues') return [];

      return null;
    });

    renderWithProviders();

    const card = (await screen.findByText('Approved but waiting for an execution slot')).closest(
      '[role="button"]',
    );
    expect(card?.textContent).toContain('Waiting for slot');
    expect(card?.textContent?.toLowerCase()).not.toContain('awaiting approval');
  });

  it('opens and pins the terminal when a synthetic automation card is clicked', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'dashboard:get-overview') {
        return {
          stats: {
            agentsRunning: 1,
            runningByPhase: { testing: 1 },
            agentsRunningByProject: { 'project-1': 1 },
            pendingApprovalsByProject: {},
            tasksInProgress: 1,
            tasksOpen: 1,
            tasksBlocked: 0,
            pendingApprovals: 0,
            staleApprovals: 0,
            shippedLast7d: 0,
            failedLast7d: 0,
          },
          running: [
            {
              threadId: 'thread-auto',
              projectId: 'project-1',
              projectName: 'shipcode',
              threadTitle: '[Auto] clean',
              phase: 'testing',
              startedAt: Date.now() - 60_000,
              activeProcessId: 'process-auto',
              githubIssueNumber: null,
              modelProvider: 'claude',
              model: 'claude-sonnet-4-6',
              reasoningEffort: 'medium',
            },
          ],
          activity: [],
          activityTotal: 0,
          recent: [],
          recentTotal: 0,
        } satisfies DashboardOverview;
      }

      if (channel === 'github:list-issues') return [];

      return null;
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: /Open \[Auto\] clean/i }));

    await waitFor(() => {
      const state = useAppStore.getState();
      expect(state.activeProjectId).toBe('project-1');
      expect(state.activeThreadId).toBe('thread-auto');
      expect(state.terminalThreadId).toBe('thread-auto');
      expect(state.terminalVisible).toBe(true);
    });
  });
});
