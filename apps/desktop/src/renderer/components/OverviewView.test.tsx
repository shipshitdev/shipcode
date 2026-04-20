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
              model: 'codex',
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
    expect(screen.getByText('Codex / GPT-5.4 · high')).toBeInTheDocument();
    expect(container.querySelector('.issue-card-active-bg')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /stop/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('pipeline:cancel', { threadId: 'thread-14' });
    });
  });
});
