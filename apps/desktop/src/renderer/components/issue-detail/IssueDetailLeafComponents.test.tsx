// @vitest-environment jsdom

import type { ActivePipelineSummary, ActivityEntry } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../stores/app-store';
import { IssueHistoryTab } from './IssueHistoryTab';
import { PlanWaiting } from './PlanWaiting';
import { PrdTab } from './PrdTab';

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
    window.shipcode = {
      invoke: vi.fn(async (channel: string) => {
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
              githubIssueNumber: 42,
              modelProvider: 'claude',
              model: 'claude',
              reasoningEffort: 'high',
            },
          ] satisfies ActivePipelineSummary[];
        }
        return null;
      }) as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}),
    };

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
      expect(screen.getByText(/- 2m [01]s/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Last output: 3\ds ago/)).toBeInTheDocument();

    cleanup();

    window.shipcode.invoke = vi.fn(async () => []) as typeof window.shipcode.invoke;
    renderWithProviders(<PlanWaiting threadId="thread-2" />);

    expect(screen.getByText(/No output in 1m 3[56]s/)).toBeInTheDocument();
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
      {
        id: 'event-2',
        projectId: 'project-1',
        kind: 'pipeline_started',
        actor: 'human',
        title: 'Issue imported',
        subtitle: null,
        metadata: null,
        threadId: null,
        createdAt: new Date(Date.now() - 10_000).toISOString(),
      },
    ];

    const empty = render(<IssueHistoryTab normalizedIssueActivity={[]} runNumberByThreadId={{}} />);
    expect(empty.getByText('No issue activity yet.')).toBeInTheDocument();
    empty.unmount();

    render(
      <IssueHistoryTab normalizedIssueActivity={entries} runNumberByThreadId={{ 'thread-1': 3 }} />,
    );

    expect(screen.getByText('Activity')).toBeInTheDocument();
    expect(screen.getByText('2 events')).toBeInTheDocument();
    expect(screen.getByText('Plan drafted')).toBeInTheDocument();
    expect(screen.getByText('First draft ready')).toBeInTheDocument();
    expect(screen.getByText('Run 3')).toBeInTheDocument();
    expect(screen.getByText('Issue imported')).toBeInTheDocument();
  });

  it('renders PRD body, empty body, and refresh/edit actions', () => {
    const onEditPrd = vi.fn();
    const onRefreshFromGithub = vi.fn();
    const activeIssue = {
      issueNumber: 42,
      body: '## Brief\n\n- Ship it',
    };

    const body = render(
      <PrdTab
        activeIssue={activeIssue as never}
        isRefreshingFromGithub={true}
        onEditPrd={onEditPrd}
        onRefreshFromGithub={onRefreshFromGithub}
      />,
    );

    expect(screen.getByText('Issue brief')).toBeInTheDocument();
    expect(screen.getByText('Ship it')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh issue from GitHub' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Edit issue body' }));
    expect(onEditPrd).toHaveBeenCalledTimes(1);
    body.unmount();

    render(
      <PrdTab
        activeIssue={{ ...activeIssue, body: '' } as never}
        isRefreshingFromGithub={false}
        onEditPrd={onEditPrd}
        onRefreshFromGithub={onRefreshFromGithub}
      />,
    );

    expect(screen.getByText(/This issue has no PRD body yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh issue from GitHub' }));
    expect(onRefreshFromGithub).toHaveBeenCalledTimes(1);
  });
});
