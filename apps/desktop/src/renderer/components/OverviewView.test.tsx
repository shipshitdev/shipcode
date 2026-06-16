// @vitest-environment jsdom

import type { ActivePipelineSummary, DashboardOverview } from '@shipcode/shared';
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
      if (channel === 'pipeline-analytics:get-overview') {
        return {
          timeToPr: { sampleSize: 0, medianMs: null, p75Ms: null, p95Ms: null },
          averagePhaseDurations: [],
          slowestRecentRuns: [],
          tokensByPhase: [],
          promptByPhase: [],
          skillFallback: {
            totalResolutions: 0,
            fallbackCount: 0,
            fallbackRate: 0,
            parseFailureRate: 0,
            retryRate: 0,
            downstreamSuccessRate: 0,
            score: 0,
          },
        };
      }

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
            runningByPhase: { approval: 1 },
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
              phase: 'approval',
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

  it('renders analytics duration ranges across milliseconds, seconds, minutes, and hours', async () => {
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
          activity: [],
          activityTotal: 0,
          recent: [],
          recentTotal: 0,
        } satisfies DashboardOverview;
      }
      if (channel === 'pipeline-analytics:get-overview') {
        return {
          timeToPr: { sampleSize: 2, medianMs: 500, p75Ms: 45_500, p95Ms: 3_900_000 },
          averagePhaseDurations: [
            {
              phase: 'executing',
              runCount: 2,
              averageMs: 125_000,
              medianMs: 120_000,
              p75Ms: 3_900_000,
              p95Ms: 4_200_000,
            },
          ],
          slowestRecentRuns: [
            {
              threadId: 'slow-thread',
              projectId: 'project-1',
              projectName: 'ShipCode',
              title: 'Slow run',
              githubPrNumber: 44,
              durationMs: 3_900_000,
              bottleneckPhase: 'executing',
              completedAt: '2026-05-09T00:00:00.000Z',
            },
          ],
          tokensByPhase: [
            {
              phase: 'plan',
              promptTokens: 100,
              completionTokens: 50,
              costUsd: 0.12,
              attemptCount: 1,
            },
          ],
          promptByPhase: [],
          skillFallback: {
            totalResolutions: 0,
            fallbackCount: 0,
            fallbackRate: 0,
            parseFailureRate: 0,
            retryRate: 0,
            downstreamSuccessRate: 0,
            score: 0,
          },
        };
      }
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('500ms')).toBeInTheDocument();
    expect(screen.getByText('45.5s')).toBeInTheDocument();
    expect(screen.getByText('2m 5s')).toBeInTheDocument();
    expect(screen.getAllByText('1h 5m').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText(/#44 Slow run/).closest('tr') as HTMLTableRowElement);
    expect(useAppStore.getState().activeThreadId).toBe('slow-thread');
  });

  it('expands running agents, paginates tables, and navigates rows with cached issue matches', async () => {
    const running: ActivePipelineSummary[] = Array.from({ length: 5 }, (_, index) => ({
      threadId: `thread-${index + 1}`,
      projectId: 'project-1',
      projectName: 'ShipCode',
      threadTitle: `Running agent ${index + 1}`,
      phase: 'executing' as const,
      startedAt: Date.now() - index * 1000,
      activeProcessId: `process-${index + 1}`,
      githubIssueNumber: index + 1,
      modelProvider: 'claude' as const,
      model: 'claude-sonnet-4',
      reasoningEffort: 'medium',
    }));

    invokeMock.mockImplementation(async (channel: string, args?: unknown) => {
      if (channel === 'dashboard:get-overview') {
        return {
          stats: {
            agentsRunning: 5,
            runningByPhase: {},
            agentsRunningByProject: {},
            pendingApprovalsByProject: {},
            tasksInProgress: 2,
            tasksOpen: 6,
            tasksBlocked: 1,
            pendingApprovals: 2,
            staleApprovals: 1,
            shippedLast7d: 3,
            failedLast7d: 1,
          },
          running,
          activity: [
            {
              id: 'activity-linked',
              threadId: 'thread-linked',
              projectId: 'project-1',
              kind: 'phase_change',
              actor: 'claude',
              title: 'Linked activity',
              subtitle: null,
              metadata: null,
              createdAt: '2026-05-09T00:00:00.000Z',
            },
          ],
          activityTotal: 8,
          recent: [
            {
              threadId: 'thread-task',
              projectId: 'project-1',
              projectName: 'ShipCode',
              title: 'Recent task without issue number',
              phase: 'reviewing',
              githubIssueNumber: null,
              updatedAt: '2026-05-09T00:00:00.000Z',
            },
          ],
          recentTotal: 8,
        } satisfies DashboardOverview;
      }
      if (channel === 'github:list-issues') {
        return [
          {
            id: 'issue-linked',
            projectId: 'project-1',
            issueNumber: 88,
            title: 'Linked issue',
            body: null,
            labels: [],
            assignee: null,
            state: 'open',
            pipelineStatus: 'executing',
            threadId:
              (args as { projectId: string }).projectId === 'project-1' ? 'thread-linked' : null,
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
          },
        ];
      }
      if (channel === 'pipeline-analytics:get-overview') {
        return {
          timeToPr: { sampleSize: 1, medianMs: null, p75Ms: null, p95Ms: null },
          averagePhaseDurations: [],
          slowestRecentRuns: [
            {
              threadId: 'slow-no-pr',
              projectId: 'project-1',
              projectName: null,
              title: 'Slow run without metadata',
              githubPrNumber: null,
              durationMs: null,
              bottleneckPhase: null,
              completedAt: '2026-05-09T00:00:00.000Z',
            },
          ],
          tokensByPhase: [],
          promptByPhase: [],
          skillFallback: {
            totalResolutions: 0,
            fallbackCount: 0,
            fallbackRate: 0,
            parseFailureRate: 0,
            retryRate: 0,
            downstreamSuccessRate: 0,
            score: 0,
          },
        };
      }
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('+1 more')).toBeInTheDocument();
    expect(screen.queryByText('Running agent 5')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /View all/i })[0]);
    expect(await screen.findByText('Running agent 5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Show less/i }));
    expect(screen.queryByText('Running agent 5')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /View all/i })[1]);
    expect(useAppStore.getState().viewMode).toBe('activity');
    fireEvent.click(screen.getAllByRole('button', { name: /View all/i })[2]);
    expect(useAppStore.getState().viewMode).toBe('inbox');

    fireEvent.click(screen.getByText('Linked activity').closest('tr') as HTMLTableRowElement);
    await waitFor(() => {
      expect(useAppStore.getState().activeIssue?.id).toBe('issue-linked');
      expect(useAppStore.getState().terminalVisible).toBe(true);
    });

    fireEvent.click(
      screen.getByText('Recent task without issue number').closest('tr') as HTMLTableRowElement,
    );
    await waitFor(() => {
      expect(useAppStore.getState().activeThreadId).toBe('thread-task');
    });

    expect(screen.getByText('1 shipped sample')).toBeInTheDocument();
    expect(screen.getByText('Unknown project')).toBeInTheDocument();
  });

  it('keeps row navigation working when issue lookup fails', async () => {
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
          activity: [],
          activityTotal: 0,
          recent: [
            {
              threadId: 'thread-fallback',
              projectId: 'project-1',
              projectName: 'ShipCode',
              title: 'Fallback task',
              phase: 'planning',
              githubIssueNumber: 10,
              updatedAt: '2026-05-09T00:00:00.000Z',
            },
          ],
          recentTotal: 1,
        } satisfies DashboardOverview;
      }
      if (channel === 'github:list-issues') throw new Error('github unavailable');
      if (channel === 'pipeline-analytics:get-overview') {
        return {
          timeToPr: { sampleSize: 0, medianMs: null, p75Ms: null, p95Ms: null },
          averagePhaseDurations: [],
          slowestRecentRuns: [],
          tokensByPhase: [],
          promptByPhase: [],
          skillFallback: {
            totalResolutions: 0,
            fallbackCount: 0,
            fallbackRate: 0,
            parseFailureRate: 0,
            retryRate: 0,
            downstreamSuccessRate: 0,
            score: 0,
          },
        };
      }
      return null;
    });

    renderWithProviders();

    const fallbackTaskRow = await screen
      .findByText(/#10 Fallback task/)
      .then((node) => node.closest('tr'));
    if (!fallbackTaskRow) throw new Error('Expected fallback task row');
    fireEvent.click(fallbackTaskRow);

    await waitFor(() => {
      expect(useAppStore.getState().activeThreadId).toBe('thread-fallback');
      expect(useAppStore.getState().activeIssue).toBeNull();
    });
  });
});
