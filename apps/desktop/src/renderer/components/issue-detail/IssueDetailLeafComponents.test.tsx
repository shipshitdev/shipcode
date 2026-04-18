// @vitest-environment jsdom

import type { ActivePipelineSummary, ActivityEntry } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../stores/app-store';
import { IssueHistoryTab } from './IssueHistoryTab';
import { PlanWaiting } from './PlanWaiting';

function renderWithProviders(element: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('issue-detail leaf components', () => {
  beforeEach(() => {
    window.shipcode.invoke = vi.fn(async (channel: string) => {
      if (channel === 'pipeline:list-active') {
        return [
          {
            threadId: 'thread-1',
            projectId: 'project-1',
            projectName: 'ShipCode',
            threadTitle: 'Fix the board',
            phase: 'planning',
            startedAt: Date.now() - 120_000,
            activeProcessId: 'process-1',
          },
        ] satisfies ActivePipelineSummary[];
      }
      return null;
    }) as typeof window.shipcode.invoke;

    useAppStore.setState({
      lastActivityByThread: {
        'thread-1': Date.now() - 30_000,
        'thread-2': Date.now() - 95_000,
      },
    });
  });

  it('shows recent and stale plan waiting states', async () => {
    renderWithProviders(<PlanWaiting threadId="thread-1" />);

    expect(screen.getByText(/Waiting for plan generation/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/- 2m 0s/)).toBeInTheDocument();
    });
    expect(screen.getByText('Last output: 30s ago')).toBeInTheDocument();

    cleanup();

    window.shipcode.invoke = vi.fn(async () => []) as typeof window.shipcode.invoke;
    renderWithProviders(<PlanWaiting threadId="thread-2" />);

    expect(screen.getByText(/No output in 1m 35s/)).toBeInTheDocument();
  });

  it('renders issue history states and run badges', () => {
    const entries: ActivityEntry[] = [
      {
        id: 'event-1',
        projectId: 'project-1',
        kind: 'plan_parsed',
        actor: 'system',
        title: 'Plan drafted',
        subtitle: 'First draft ready',
        metadata: null,
        threadId: 'thread-1',
        createdAt: new Date(Date.now() - 5_000).toISOString(),
      },
    ];

    const empty = render(<IssueHistoryTab normalizedIssueActivity={[]} runNumberByThreadId={{}} />);
    expect(empty.getByText('No issue activity yet.')).toBeInTheDocument();
    empty.unmount();

    render(
      <IssueHistoryTab normalizedIssueActivity={entries} runNumberByThreadId={{ 'thread-1': 3 }} />,
    );

    expect(screen.getByText('Issue History')).toBeInTheDocument();
    expect(screen.getByText('1 events')).toBeInTheDocument();
    expect(screen.getByText('Plan drafted')).toBeInTheDocument();
    expect(screen.getByText('First draft ready')).toBeInTheDocument();
    expect(screen.getByText('Run 3')).toBeInTheDocument();
  });
});
