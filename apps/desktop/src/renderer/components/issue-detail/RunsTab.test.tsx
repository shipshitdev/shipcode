// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type { PipelineRunTimelineEntry } from '@shipcode/shared';
import { PIPELINE_PHASE } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunsTab } from './RunsTab';

vi.mock('@shipcode/ui', () => ({
  PhaseChip: ({ status }: { status: string }) => <span data-testid="phase-chip">{status}</span>,
}));

const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

function renderWithClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RunsTab threadId="thread-1" />
    </QueryClientProvider>,
  );
}

function makeEntry(overrides: Partial<PipelineRunTimelineEntry> = {}): PipelineRunTimelineEntry {
  return {
    run: {
      id: 'run-2',
      threadId: 'thread-1',
      projectId: 'project-1',
      source: 'pipeline:resume',
      triggerDetail: 'issue:42',
      status: 'running',
      currentPhase: PIPELINE_PHASE.executing,
      startedAt: '2026-05-12T10:00:00.000Z',
      finishedAt: null,
      errorMessage: null,
      errorKind: null,
      context: null,
      retryOfRunId: 'run-1',
      createdAt: '2026-05-12T10:00:00.000Z',
      updatedAt: '2026-05-12T10:03:00.000Z',
    },
    isCurrent: true,
    retryDepth: 1,
    phaseTimeline: [
      {
        id: 'phase-1',
        threadId: 'thread-1',
        runId: 'run-2',
        phase: PIPELINE_PHASE.executing,
        startedAt: '2026-05-12T10:00:00.000Z',
        completedAt: null,
        durationMs: 1500,
        terminalStatus: null,
        errorMessage: null,
        metadata: null,
      },
    ],
    steps: [
      {
        id: 'step-1',
        threadId: 'thread-1',
        runId: 'run-2',
        phase: 'execute',
        attempt: 1,
        provider: 'claude-cli',
        requestedModel: 'claude',
        resolvedModel: 'claude-sonnet-4',
        status: 'completed',
        errorKind: null,
        errorMessage: null,
        promptTokens: 1000,
        completionTokens: 500,
        costUsd: 0.02,
        startedAt: '2026-05-12T10:00:00.000Z',
        completedAt: '2026-05-12T10:01:00.000Z',
        durationMs: 60_000,
      },
    ],
    terminalEvents: [
      {
        id: 'terminal-1',
        threadId: 'thread-1',
        runId: 'run-2',
        event: { kind: 'raw', content: 'agent output' },
        createdAt: '2026-05-12T10:01:00.000Z',
      },
    ],
    ...overrides,
  };
}

describe('RunsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.shipcode ??= {} as typeof window.shipcode;
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'pipeline-runs:list-by-thread') {
        return [
          makeEntry(),
          makeEntry({
            run: {
              ...makeEntry().run,
              id: 'run-1',
              status: 'failed',
              currentPhase: PIPELINE_PHASE.failed,
              retryOfRunId: null,
            },
            isCurrent: false,
            retryDepth: 0,
            phaseTimeline: [],
            steps: [],
            terminalEvents: [],
          }),
        ];
      }
      return [];
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders run lineage, scoped phases, attempts, and terminal output', async () => {
    renderWithClient();

    expect(await screen.findAllByText('Pipeline Resume · issue:42')).toHaveLength(2);
    expect(screen.getByText('retry of run 1')).toBeInTheDocument();
    expect(screen.getByText('current')).toBeInTheDocument();
    expect(screen.getByText('2k tokens')).toBeInTheDocument();
    expect(screen.getByText('$0.02')).toBeInTheDocument();
    expect(screen.getByText('agent output')).toBeInTheDocument();
    expect(screen.getByTestId('phase-chip')).toHaveTextContent('executing');

    const runHeader = screen.getAllByText('Pipeline Resume · issue:42')[0].closest('button');
    expect(runHeader).not.toBeNull();
    expect(within(runHeader as HTMLElement).getByText('running')).toBeInTheDocument();
  });

  it('renders an empty state when no run records exist', async () => {
    invokeMock.mockResolvedValueOnce([]);

    renderWithClient();

    expect(await screen.findByText('No run records yet.')).toBeInTheDocument();
  });
});
