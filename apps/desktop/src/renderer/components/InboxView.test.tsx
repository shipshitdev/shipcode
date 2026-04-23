import type { NotificationRecord } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxView } from './InboxView';

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
      <InboxView />
    </QueryClientProvider>,
  );
}

describe('InboxView', () => {
  const notifications: NotificationRecord[] = [
    {
      id: 'notification-1',
      projectId: 'project-1',
      threadId: 'thread-1',
      kind: 'awaiting_approval',
      title: 'Approval needed for demo task',
      body: 'Pipeline paused before execution.',
      createdAt: '2026-04-21T10:00:00.000Z',
      dismissedAt: null,
    },
    {
      id: 'notification-2',
      projectId: 'project-1',
      threadId: 'thread-2',
      kind: 'failed',
      title: 'Execution failed for demo task',
      body: 'The executor exited non-zero.',
      createdAt: '2026-04-21T11:00:00.000Z',
      dismissedAt: null,
    },
  ];

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.shipcode.invoke = vi.fn(async (channel: string) => {
      if (channel === 'notification:list') return notifications;
      if (channel === 'notification:dismiss') return null;
      if (channel === 'notification:dismiss-all') return null;
      if (channel === 'github:list-issues') return [];
      if (channel === 'thread:get') return null;
      return null;
    }) as typeof window.shipcode.invoke;

    window.shipcode.on = vi.fn(() => () => {}) as typeof window.shipcode.on;
  });

  it('labels approval-gated notifications without a redundant secondary badge', async () => {
    renderWithProviders();

    expect(await screen.findByText('Needs approval')).toBeInTheDocument();
    expect(screen.queryByText('Approval required')).not.toBeInTheDocument();
  });

  it('filters inbox rows down to approval-gated notifications', async () => {
    renderWithProviders();

    expect(await screen.findByText('Execution failed for demo task')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /Needs approval/i })[0]);

    expect(screen.getByText('Approval needed for demo task')).toBeInTheDocument();
    expect(screen.queryByText('Execution failed for demo task')).toBeNull();
  });
});
