// @vitest-environment jsdom

import type { PullRequestDetailResponse } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../stores/app-store';
import { PullRequestDetailPanel } from './PullRequestDetailPanel';

function makeDetail(overrides: Partial<PullRequestDetailResponse> = {}): PullRequestDetailResponse {
  return {
    number: 77,
    url: 'https://github.com/acme/repo/pull/77',
    title: 'Ship feature',
    body: 'PR body',
    author: 'decod3rs',
    headRefName: 'ship/77-feature',
    baseRefName: 'main',
    isDraft: false,
    state: 'OPEN',
    reviewDecision: null,
    additions: 10,
    deletions: 2,
    changedFiles: 1,
    labels: [],
    linkedIssueNumbers: [42],
    ciBlocked: false,
    failingChecks: [],
    unresolvedReviewComments: [],
    unresolvedReviewCommentCount: 0,
    linkedThreadId: 'thread-1',
    diffs: [
      {
        id: 'diff-1',
        threadId: 'thread-1',
        filePath: 'src/foo.ts',
        action: 'modify',
        diffContent:
          'diff --git a/src/foo.ts b/src/foo.ts\n@@ -1 +1 @@\n-console.log("old")\n+console.log("new")',
        beforeHash: '1111111',
        afterHash: '2222222',
        createdAt: new Date().toISOString(),
      },
    ],
    ...overrides,
  };
}

function renderPanel() {
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
      <PullRequestDetailPanel prNumber={77} />
    </QueryClientProvider>,
  );
}

describe('PullRequestDetailPanel', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    invokeMock.mockReset();
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    useAppStore.setState({
      activeProjectId: 'project-1',
      activePrNumber: 77,
      activeIssue: null,
      activeThreadId: null,
      githubIssues: [],
      setProjectTab: vi.fn(),
    });
  });

  it('renders the persisted local diff and review action for open PRs', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'github:get-pr-detail') return makeDetail();
      return null;
    });

    renderPanel();

    expect(await screen.findByText('Code Changes')).toBeInTheDocument();
    expect(screen.getByText('src/foo.ts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument();
  });

  it('hides review actions for merged PRs and shows the unlinked empty state', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'github:get-pr-detail') {
        return makeDetail({
          state: 'MERGED',
          linkedThreadId: null,
          diffs: [],
        });
      }
      return null;
    });

    renderPanel();

    await waitFor(() => {
      expect(
        screen.getByText(
          'This PR is not linked to a ShipCode pipeline thread, so no local execution diff is available.',
        ),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();
  });
});
