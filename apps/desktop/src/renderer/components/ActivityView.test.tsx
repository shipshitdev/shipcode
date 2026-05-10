// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type { ActivityEntry } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { ActivityView } from './ActivityView';

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
      <ActivityView />
    </QueryClientProvider>,
  );
}

function makeActivity(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 'activity-1',
    threadId: 'thread-1',
    projectId: 'project-1',
    kind: 'phase_change',
    actor: 'codex',
    title: 'Planning started',
    subtitle: 'Issue #42',
    metadata: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ActivityView', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();
  const unsubscribeMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    window.shipcode.on = vi.fn(() => unsubscribeMock) as unknown as typeof window.shipcode.on;
    useAppStore.setState({
      activeProjectId: null,
      activeThreadId: null,
    } as never);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders empty activity state', async () => {
    invokeMock.mockResolvedValueOnce([]);

    renderWithClient();

    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
    expect(
      screen.getByText('Pipeline runs and agent actions will appear here.'),
    ).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith('dashboard:get-activity', { limit: 500 });
  });

  it('groups activity by day and opens linked project/thread rows', async () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const older = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    invokeMock.mockResolvedValueOnce([
      makeActivity({
        id: 'today-linked',
        title: 'Today linked',
        createdAt: today.toISOString(),
      }),
      makeActivity({
        id: 'yesterday-detached',
        projectId: null,
        threadId: null,
        actor: 'system',
        title: 'Yesterday detached',
        subtitle: null,
        createdAt: yesterday.toISOString(),
      }),
      makeActivity({
        id: 'older-entry',
        title: 'Older entry',
        createdAt: older.toISOString(),
      }),
      makeActivity({
        id: 'project-only',
        threadId: null,
        title: 'Project only entry',
        createdAt: older.toISOString(),
      }),
    ]);

    renderWithClient();

    expect(await screen.findByText('Today linked')).toBeInTheDocument();
    expect(screen.getByText('Yesterday detached')).toBeInTheDocument();
    expect(screen.getByText('Older entry')).toBeInTheDocument();
    expect(screen.getByText('Project only entry')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Today linked').closest('tr') as HTMLTableRowElement);

    await waitFor(() => {
      expect(useAppStore.getState().activeProjectId).toBe('project-1');
      expect(useAppStore.getState().activeThreadId).toBe('thread-1');
    });

    fireEvent.click(screen.getByText('Yesterday detached').closest('tr') as HTMLTableRowElement);

    expect(useAppStore.getState().activeProjectId).toBe('project-1');
    expect(useAppStore.getState().activeThreadId).toBe('thread-1');

    fireEvent.click(screen.getByText('Project only entry').closest('tr') as HTMLTableRowElement);

    expect(useAppStore.getState().activeProjectId).toBe('project-1');
    expect(useAppStore.getState().activeThreadId).toBeNull();
  });

  it('shows pagination for more than one activity page', async () => {
    invokeMock.mockResolvedValueOnce(
      Array.from({ length: 26 }, (_, index) =>
        makeActivity({
          id: `activity-${index}`,
          title: `Activity ${index}`,
          createdAt: '2026-05-08T10:00:00.000Z',
        }),
      ),
    );

    renderWithClient();

    expect(await screen.findByText('Activity 0')).toBeInTheDocument();
    expect(screen.queryByText('Activity 25')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(await screen.findByText('Activity 25')).toBeInTheDocument();
  });

  it('renders error state and retries the activity query', async () => {
    invokeMock.mockRejectedValueOnce(new Error('db unavailable')).mockResolvedValueOnce([]);

    renderWithClient();

    expect(await screen.findByText('Failed to load activity.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes activity when the dashboard invalidates activity data', async () => {
    invokeMock
      .mockResolvedValueOnce([makeActivity({ title: 'Before invalidate' })])
      .mockResolvedValueOnce([makeActivity({ id: 'activity-2', title: 'After invalidate' })]);

    renderWithClient();

    expect(await screen.findByText('Before invalidate')).toBeInTheDocument();

    const invalidateHandler = vi.mocked(window.shipcode.on).mock.calls[0][1] as (
      data: unknown,
    ) => void;
    invalidateHandler(null);
    invalidateHandler({ kinds: ['projects'] });
    expect(invokeMock).toHaveBeenCalledTimes(1);

    invalidateHandler({ kinds: ['activity'] });

    expect(await screen.findByText('After invalidate')).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
