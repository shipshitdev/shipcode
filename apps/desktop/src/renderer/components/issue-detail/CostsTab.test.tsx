// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type {
  CostTaskSummary,
  PipelineStepRecord,
  PipelineThreadAnalytics,
  Thread,
} from '@shipcode/shared';
import { PIPELINE_PHASE } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CostsTab } from './CostsTab';

vi.mock('../heatmap/ActivityHeatmap', () => ({
  ActivityHeatmap: () => <div data-testid="thread-activity-heatmap" />,
}));

function renderWithClient(thread: Thread | null = makeThread()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <CostsTab projectId="project-1" issueNumber={42} thread={thread} />
    </QueryClientProvider>,
  );
}

function makeTask(overrides: Partial<CostTaskSummary> = {}): CostTaskSummary {
  return {
    threadId: 'thread-1',
    projectId: 'project-1',
    title: 'Costed task',
    projectName: 'ShipCode',
    phase: PIPELINE_PHASE.completed,
    provider: 'codex',
    model: 'gpt-5.4',
    costUsd: 1.5,
    tokensPrompt: 1200,
    tokensCompletion: 800,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeStep(overrides: Partial<PipelineStepRecord> = {}): PipelineStepRecord {
  return {
    id: 'step-1',
    threadId: 'thread-1',
    phase: 'plan',
    attempt: 1,
    provider: 'codex',
    requestedModel: null,
    resolvedModel: 'gpt-5.4',
    status: 'completed',
    errorKind: null,
    errorMessage: null,
    promptTokens: 1000,
    completionTokens: 500,
    costUsd: 0.01,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 65_000,
    ...overrides,
  };
}

function makeAnalytics(overrides: Partial<PipelineThreadAnalytics> = {}): PipelineThreadAnalytics {
  return {
    threadId: 'thread-1',
    phaseTimeline: [
      {
        id: 'phase-1',
        threadId: 'thread-1',
        phase: PIPELINE_PHASE.completed,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 1500,
        terminalStatus: 'completed',
        errorMessage: null,
        metadata: null,
      },
    ],
    providerAttempts: [],
    promptTelemetry: [
      {
        id: 'prompt-1',
        threadId: 'thread-1',
        phase: 'plan',
        invocationId: 'invoke-1',
        attempt: 1,
        provider: 'codex',
        model: 'gpt-5.4',
        promptCharacters: 1100,
        promptBytes: 1234,
        promptLines: 20,
        selectedMaterials: {
          count: 3,
          labels: ['issue prompt', 'repo context', 'testing context'],
          kinds: ['issue_prompt', 'repo_file_context', 'testing_context'],
        },
        promptTokens: 456,
        completionTokens: 123,
        costUsd: 0.01,
        createdAt: new Date().toISOString(),
      },
    ],
    skillResolutions: [
      {
        id: 'skill-1',
        threadId: 'thread-1',
        phase: 'plan',
        skillKey: 'react-testing-library',
        source: 'explicit',
        fallbackUsed: true,
        parseFailed: false,
        retryAttempt: 0,
        downstreamStatus: 'completed',
        createdAt: new Date().toISOString(),
      },
    ],
    tokensByPhase: [],
    promptByPhase: [
      {
        phase: 'plan',
        promptCount: 2,
        averageBytes: 1234,
        averageLines: 20,
        materialCount: 3,
        materialKinds: ['file', 'test'],
      },
    ],
    bottleneckPhase: null,
    bottleneckDurationMs: null,
    totalDurationMs: 1500,
    skillFallback: {
      totalResolutions: 2,
      fallbackCount: 1,
      fallbackRate: 0.5,
      parseFailureRate: 0,
      retryRate: 0.25,
      downstreamSuccessRate: 1,
      score: 88,
    },
    ...overrides,
  } as PipelineThreadAnalytics;
}

function makeThread(): Thread {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    issueNumber: 42,
    status: 'completed',
    phase: PIPELINE_PHASE.completed,
    branch: 'shipcode/42',
    worktreePath: '/tmp/worktree',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastError: null,
    plannerResolvedModel: 'gpt-5.4',
    reviewerResolvedModel: 'claude-sonnet-4',
    executorResolvedModel: null,
    verifierResolvedModel: null,
  } as unknown as Thread;
}

describe('CostsTab', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders empty cost data with analytics fallback states', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'costs:list-for-issue') return [];
      if (channel === 'pipeline-analytics:get-thread') {
        return makeAnalytics({
          phaseTimeline: [],
          promptTelemetry: [],
          promptByPhase: [],
          skillResolutions: [],
          skillFallback: undefined as unknown as PipelineThreadAnalytics['skillFallback'],
        });
      }
      return null;
    });

    renderWithClient();

    expect(await screen.findByText('No cost data yet.')).toBeInTheDocument();
    expect(screen.getByText('No phase timing data yet.')).toBeInTheDocument();
    expect(screen.getByText('No prompt telemetry yet.')).toBeInTheDocument();
  });

  it('renders task totals, heatmap, attempts, current models, and analytics details', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'costs:list-for-issue') {
        return [
          makeTask(),
          makeTask({
            threadId: 'thread-2',
            phase: PIPELINE_PHASE.failed,
            costUsd: 0.5,
            tokensPrompt: 100,
            tokensCompletion: 100,
            model: 'custom-model',
            updatedAt: '',
          }),
        ];
      }
      if (channel === 'pipeline-steps:list-by-thread') {
        return [
          makeStep(),
          makeStep({
            id: 'step-2',
            phase: 'verify',
            status: 'failed',
            errorKind: 'runtime',
            errorMessage: 'Tests failed',
            resolvedModel: null,
            requestedModel: 'requested-model',
            promptTokens: null,
            completionTokens: null,
            costUsd: 0,
            durationMs: 500,
          }),
        ];
      }
      if (channel === 'pipeline-analytics:get-thread') return makeAnalytics();
      return null;
    });

    renderWithClient();

    expect(await screen.findByText('$2.00')).toBeInTheDocument();
    expect(screen.getByText('2k')).toBeInTheDocument();
    expect(screen.getByTestId('thread-activity-heatmap')).toBeInTheDocument();
    expect(screen.getAllByText('GPT-5.4').length).toBeGreaterThan(0);
    expect(screen.getByText('custom-model')).toBeInTheDocument();

    const firstRun = screen.getAllByRole('button', { expanded: false })[0];
    fireEvent.click(firstRun);

    expect((await screen.findAllByText('Plan · attempt 1')).length).toBeGreaterThan(0);
    expect(await screen.findByText('runtime: Tests failed')).toBeInTheDocument();
    expect(screen.getByText('Timeline')).toBeInTheDocument();
    expect(screen.getByText('1.5s')).toBeInTheDocument();
    expect(screen.getByText('Payload')).toBeInTheDocument();
    expect(screen.getByText('1.2 KB')).toBeInTheDocument();
    expect(screen.getByText('Lines')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('Context Materials')).toBeInTheDocument();
    expect(screen.getByText('Issue Prompt')).toBeInTheDocument();
    expect(screen.getByText('Repo File Context')).toBeInTheDocument();
    expect(screen.getByText('testing context')).toBeInTheDocument();
    expect(
      within(screen.getByText('Skill Resolution').parentElement as HTMLElement).getByText('88'),
    ).toBeInTheDocument();
    expect(screen.getByText('explicit · fallback')).toBeInTheDocument();
  });
});
