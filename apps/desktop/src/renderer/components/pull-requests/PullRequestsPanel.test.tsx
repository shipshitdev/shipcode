// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type { PullRequestListItem } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../stores/app-store';
import { PullRequestsPanel } from './PullRequestsPanel';

vi.mock('./PullRequestDetailPanel', () => ({
  PullRequestDetailPanel: ({ prNumber }: { prNumber: number }) => (
    <div data-testid="pr-detail">PR #{prNumber} detail</div>
  ),
}));

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PullRequestsPanel />
    </QueryClientProvider>,
  );
}

function makePr(overrides: Partial<PullRequestListItem> = {}): PullRequestListItem {
  return {
    number: 12,
    title: 'Ship PR panel',
    author: 'decod3rs',
    headRefName: 'ship/pr-panel',
    baseRefName: 'main',
    isDraft: false,
    state: 'OPEN',
    reviewDecision: null,
    url: 'https://github.com/acme/repo/pull/12',
    labels: [],
    updatedAt: '2026-05-08T10:00:00.000Z',
    linkedIssueNumbers: [],
    ...overrides,
  };
}

describe('PullRequestsPanel', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    useAppStore.setState({
      activeProjectId: null,
      activePrNumber: null,
    } as never);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the no-project and empty states', async () => {
    renderPanel();

    expect(screen.getByText('Select a project to view pull requests')).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();

    cleanup();
    invokeMock.mockResolvedValueOnce([]);
    useAppStore.setState({ activeProjectId: 'project-1', activePrNumber: null } as never);
    renderPanel();

    expect(await screen.findByText('No pull requests found')).toBeInTheDocument();
  });

  it('lists PRs, switches filters, refreshes, and opens detail', async () => {
    invokeMock.mockImplementation(async (channel: string, rawArgs?: unknown) => {
      const args = rawArgs as { filter?: string } | undefined;
      if (channel === 'github:list-prs') {
        return [
          makePr({
            number: args?.filter === 'closed' ? 13 : 12,
            title: args?.filter === 'closed' ? 'Closed PR' : 'Open PR',
            isDraft: args?.filter !== 'closed',
            reviewDecision: args?.filter === 'closed' ? 'CHANGES_REQUESTED' : 'APPROVED',
            author: args?.filter === 'closed' ? null : 'decod3rs',
          }),
        ];
      }
      return null;
    });
    useAppStore.setState({ activeProjectId: 'project-1', activePrNumber: null } as never);

    renderPanel();

    expect(await screen.findByText('Open PR')).toBeInTheDocument();
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
    expect(screen.getByText('APPROVED')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Open PR').closest('button') as HTMLButtonElement);
    expect(useAppStore.getState().activePrNumber).toBe(12);

    fireEvent.click(screen.getByRole('button', { name: 'Closed' }));
    expect(await screen.findByText('Closed PR')).toBeInTheDocument();
    expect(screen.getByText('CHANGES')).toBeInTheDocument();
    expect(screen.queryByText('decod3rs')).not.toBeInTheDocument();

    useAppStore.setState({ activePrNumber: 13 } as never);
    expect(await screen.findByTestId('pr-detail')).toHaveTextContent('PR #13 detail');

    fireEvent.click(screen.getAllByRole('button').at(3) as HTMLButtonElement);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:list-prs', {
        projectId: 'project-1',
        filter: 'closed',
      });
    });
  });
});
