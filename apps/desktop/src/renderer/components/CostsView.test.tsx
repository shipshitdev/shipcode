// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type {
  CostSummary,
  CostTaskSummary,
  GitHubIssueCacheRecord,
  PipelineAnalyticsOverview,
} from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { CostsView } from './CostsView';

vi.mock('./heatmap/ActivityHeatmap', () => ({
  ActivityHeatmap: () => <div data-testid="activity-heatmap" />,
}));

vi.mock('./costs/TokensByPhaseChart', () => ({
  TokensByPhaseChart: ({ tokensByPhase }: { tokensByPhase: unknown[] }) => (
    <div data-testid="tokens-by-phase-chart">{tokensByPhase.length} phases</div>
  ),
}));

vi.mock('./costs/CostByProjectChart', () => ({
  CostByProjectChart: ({ byProject }: { byProject: unknown[] }) =>
    byProject.length > 1 ? (
      <div data-testid="cost-by-project-chart">{byProject.length} projects</div>
    ) : null,
}));

vi.mock('./costs/PhaseDurationsChart', () => ({
  PhaseDurationsChart: ({ phaseDurations }: { phaseDurations: unknown[] }) => (
    <div data-testid="phase-durations-chart">{phaseDurations.length} phases</div>
  ),
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

function makeAnalytics(
  overrides: Partial<PipelineAnalyticsOverview> = {},
): PipelineAnalyticsOverview {
  return {
    timeToPr: { sampleSize: 3, medianMs: 120_000, p75Ms: 240_000, p95Ms: 600_000 },
    averagePhaseDurations: [
      {
        phase: 'executing',
        runCount: 5,
        averageMs: 90_000,
        medianMs: 80_000,
        p75Ms: 120_000,
        p95Ms: 200_000,
      },
      {
        phase: 'planning',
        runCount: 5,
        averageMs: 30_000,
        medianMs: 25_000,
        p75Ms: 40_000,
        p95Ms: 60_000,
      },
    ],
    slowestRecentRuns: [],
    tokensByPhase: [
      {
        phase: 'execute',
        promptTokens: 50_000,
        completionTokens: 10_000,
        costUsd: 2.5,
        attemptCount: 5,
      },
      {
        phase: 'plan',
        promptTokens: 20_000,
        completionTokens: 5_000,
        costUsd: 1.0,
        attemptCount: 5,
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
  } as unknown as GitHubIssueCacheRecord;
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
      if (channel === 'pipeline-analytics:get-overview') return makeAnalytics();
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
      phase: 'approval',
      model: null,
      updatedAt: '',
    });
    invokeMock.mockImplementation(async (channel: string, rawArgs?: unknown) => {
      const args = rawArgs as { projectId?: string } | undefined;
      if (channel === 'costs:get-summary') return makeSummary();
      if (channel === 'costs:list-tasks') return args?.projectId ? [projectTask] : [topTask];
      if (channel === 'costs:count-tasks') return 1;
      if (channel === 'github:list-issues') return [makeIssue()];
      if (channel === 'pipeline-analytics:get-overview') return makeAnalytics();
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
    expect(screen.getByText('approval')).toBeInTheDocument();
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
    invokeMock.mockImplementation(async (channel: string, rawArgs?: unknown) => {
      const args = rawArgs as { offset?: number } | undefined;
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
      if (channel === 'pipeline-analytics:get-overview') return makeAnalytics();
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
      if (channel === 'pipeline-analytics:get-overview') return makeAnalytics();
      return null;
    });

    renderWithClient();

    expect(await screen.findByText('Failed to load cost data.')).toBeInTheDocument();
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'costs:get-summary') return makeSummary({ byProject: [] });
      if (channel === 'costs:list-tasks') return [];
      if (channel === 'costs:count-tasks') return 0;
      if (channel === 'pipeline-analytics:get-overview') return makeAnalytics();
      return null;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('No cost data yet')).toBeInTheDocument();
  });

  it('renders usage analytics section with charts and time-to-pr cards', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'costs:get-summary') return makeSummary();
      if (channel === 'costs:list-tasks') return [makeTask()];
      if (channel === 'costs:count-tasks') return 1;
      if (channel === 'pipeline-analytics:get-overview') return makeAnalytics();
      return null;
    });

    renderWithClient();

    expect(await screen.findByText('Usage Analytics')).toBeInTheDocument();
    expect(await screen.findByTestId('tokens-by-phase-chart')).toHaveTextContent('2 phases');
    expect(screen.getByTestId('phase-durations-chart')).toHaveTextContent('2 phases');
    expect(screen.getByText('Median Time to PR')).toBeInTheDocument();
    expect(screen.getByText('P75')).toBeInTheDocument();
    expect(screen.getByText('P95')).toBeInTheDocument();
  });

  it('shows project donut chart when multiple projects exist', async () => {
    const multiProjectSummary = makeSummary({
      byProject: [
        {
          projectId: 'p1',
          projectName: 'Alpha',
          totalCostUsd: 5,
          totalTokensPrompt: 10_000,
          totalTokensCompletion: 2_000,
          taskCount: 1,
        },
        {
          projectId: 'p2',
          projectName: 'Beta',
          totalCostUsd: 7,
          totalTokensPrompt: 15_000,
          totalTokensCompletion: 3_000,
          taskCount: 2,
        },
      ],
    });

    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'costs:get-summary') return multiProjectSummary;
      if (channel === 'costs:list-tasks') return [makeTask()];
      if (channel === 'costs:count-tasks') return 1;
      if (channel === 'pipeline-analytics:get-overview') return makeAnalytics();
      return null;
    });

    renderWithClient();

    expect(await screen.findByTestId('cost-by-project-chart')).toHaveTextContent('2 projects');
  });
});
