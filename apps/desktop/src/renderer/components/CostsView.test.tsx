// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type { CostSummary, CostTaskSummary, GitHubIssueCacheRecord } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { CostsView } from './CostsView';

vi.mock('./heatmap/ActivityHeatmap', () => ({
  ActivityHeatmap: () => <div data-testid="activity-heatmap" />,
}));

function renderWithClient() {
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
      <CostsView />
    </QueryClientProvider>,
  );
}

function makeSummary(overrides: Partial<CostSummary> = {}): CostSummary {
  return {
    totalCostAllTime: 12.34,
    totalCost7d: 2.5,
    totalTokensAllTime: 123_000,
    totalTokens7d: 12_000,
    avgCostPerTask: 1.23,
    avgTokensPerTask: 4_500,
    byProject: [
      {
        projectId: 'project-1',
        projectName: 'ShipCode',
        totalCostUsd: 10,
        totalTokensPrompt: 20_000,
        totalTokensCompletion: 5_000,
        taskCount: 2,
      },
    ],
    ...overrides,
  };
}

function makeTask(overrides: Partial<CostTaskSummary> = {}): CostTaskSummary {
  return {
    threadId: 'thread-1',
    projectId: 'project-1',
    title: 'Add cost coverage',
    projectName: 'ShipCode',
    phase: 'executing',
    provider: 'codex',
    model: 'gpt-5.4',
    costUsd: 1.23,
    tokensPrompt: 1000,
    tokensCompletion: 250,
    updatedAt: '2026-05-08T10:00:00.000Z',
    ...overrides,
  };
}

function makeIssue(): GitHubIssueCacheRecord {
  return {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 42,
    title: 'Add cost coverage',
    body: 'body',
    labels: [],
    assignee: null,
    state: 'open',
    url: 'https://github.com/shipshitdev/shipcode/issues/42',
    createdAt: '2026-05-08T00:00:00.000Z',
    updatedAt: '2026-05-08T00:00:00.000Z',
    threadId: 'thread-1',
    pipelineStatus: 'executing',
    archivedAt: null,
    completedAt: null,
    closedAt: null,
    prUrl: null,
    prNumber: null,
    prState: null,
    prMergedAt: null,
    prReviewDecision: null,
    prReviewUrl: null,
    priority: null,
    issueType: null,
    projectStatus: null,
    projectPriority: null,
    projectComplexity: null,
    projectArea: null,
    projectIteration: null,
    projectEstimate: null,
    projectDueDate: null,
    projectMilestone: null,
    projectLabels: null,
    issueGroupId: null,
    issueGroupTitle: null,
    issueGroupStatus: null,
    parentIssueNumber: null,
    parentIssueTitle: null,
    parentIssueUrl: null,
    childIssueCount: 0,
    dependencyCount: 0,
    blockedByCount: 0,
    isBlocked: false,
    isBlocking: false,
    staleness: null,
    githubProjectItemId: null,
    githubProjectId: null,
    quickMode: false,
    planStatus: null,
    latestPlanId: null,
    latestPlanVersion: null,
    latestReviewDecision: null,
    latestVerificationResult: null,
    verificationFailureCount: 0,
    costUsd: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    agentProvider: null,
    agentModel: null,
    agentReasoningEffort: null,
    lastActivityAt: null,
  } as GitHubIssueCacheRecord;
}

describe('CostsView', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    window.shipcode.on = vi.fn(() => () => {}) as unknown as typeof window.shipcode.on;
    useAppStore.setState({
      activeProjectId: null,
      activeThreadId: null,
      activeIssue: null,
      githubIssues: [],
    } as never);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders empty cost data and toggles between tokens and USD', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'costs:get-summary') return makeSummary({ byProject: [] });
      if (channel === 'costs:list-tasks') return [];
      if (channel === 'costs:count-tasks') return 0;
      return null;
    });

    renderWithClient();

    expect(await screen.findByText('No cost data yet')).toBeInTheDocument();
    expect(screen.getByText('No tasks yet.')).toBeInTheDocument();
    expect(screen.getAllByText('123k').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Show costs in US dollars' }));

    expect(await screen.findByText('$12.34')).toBeInTheDocument();
    expect(screen.getByText('123k tokens')).toBeInTheDocument();
  });

  it('renders projects, expands project cost details, and navigates to task issues', async () => {
    const topTask = makeTask();
    const projectTask = makeTask({
      threadId: 'thread-2',
      title: 'Project detail task',
      phase: 'awaiting_approval',
      model: null,
      updatedAt: '',
    });
    invokeMock.mockImplementation(async (channel: string, args?: { projectId?: string }) => {
      if (channel === 'costs:get-summary') return makeSummary();
      if (channel === 'costs:list-tasks') return args?.projectId ? [projectTask] : [topTask];
      if (channel === 'costs:count-tasks') return 1;
      if (channel === 'github:list-issues') return [makeIssue()];
      return null;
    });

    renderWithClient();

    expect((await screen.findAllByText('ShipCode')).length).toBeGreaterThan(0);
    expect(screen.getByText('Add cost coverage')).toBeInTheDocument();
    expect(screen.getByText('GPT-5.4')).toBeInTheDocument();

    const byProject = screen.getByText('By Project').closest('section') as HTMLElement;
    fireEvent.click(within(byProject).getByText('ShipCode').closest('tr') as HTMLTableRowElement);

    expect(await screen.findByText('ShipCode Cost Details')).toBeInTheDocument();
    expect(await screen.findByText('Project detail task')).toBeInTheDocument();
    expect(screen.getByText('awaiting approval')).toBeInTheDocument();
    expect(screen.getAllByText('codex').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('Add cost coverage').closest('tr') as HTMLTableRowElement);

    await waitFor(() => {
      expect(useAppStore.getState().activeProjectId).toBe('project-1');
      expect(useAppStore.getState().activeThreadId).toBe('thread-1');
      expect(useAppStore.getState().activeIssue?.threadId).toBe('thread-1');
    });
    expect(invokeMock).toHaveBeenCalledWith('github:list-issues', { projectId: 'project-1' });
  });

  it('renders task pagination', async () => {
    invokeMock.mockImplementation(async (channel: string, args?: { offset?: number }) => {
      if (channel === 'costs:get-summary') return makeSummary();
      if (channel === 'costs:list-tasks') {
        return [
          makeTask({
            threadId: `thread-${args?.offset ?? 0}`,
            title: `Task offset ${args?.offset ?? 0}`,
          }),
        ];
      }
      if (channel === 'costs:count-tasks') return 9;
      return null;
    });

    renderWithClient();

    expect(await screen.findByText('Task offset 0')).toBeInTheDocument();
    const topTasks = screen.getByText('Top Tasks by Cost').closest('section') as HTMLElement;
    fireEvent.click(within(topTasks).getByRole('button', { name: /next/i }));

    expect(await screen.findByText('Task offset 8')).toBeInTheDocument();
  });

  it('renders error state and retries summary loading', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'costs:get-summary') throw new Error('db unavailable');
      if (channel === 'costs:list-tasks') return [];
      if (channel === 'costs:count-tasks') return 0;
      return null;
    });

    renderWithClient();

    expect(await screen.findByText('Failed to load cost data.')).toBeInTheDocument();
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'costs:get-summary') return makeSummary({ byProject: [] });
      if (channel === 'costs:list-tasks') return [];
      if (channel === 'costs:count-tasks') return 0;
      return null;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('No cost data yet')).toBeInTheDocument();
  });
});
