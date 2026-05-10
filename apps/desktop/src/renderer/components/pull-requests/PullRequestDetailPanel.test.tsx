// @vitest-environment jsdom

import type { PullRequestDetailResponse } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByRole('button', { name: 'src/foo.ts' })).toBeInTheDocument();
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

  it('renders failing checks, review comments, and external links', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'github:get-pr-detail') {
        return makeDetail({
          diffs: [],
          failingChecks: [
            {
              name: 'test',
              workflowName: 'CI',
              status: 'completed',
              conclusion: 'failure',
              detailsUrl: 'https://github.com/acme/repo/actions/runs/1',
            },
          ],
          unresolvedReviewCommentCount: 1,
          unresolvedReviewComments: [
            {
              author: 'reviewer',
              body: 'Needs a tighter assertion',
              path: 'src/foo.ts',
              line: 12,
              url: 'https://github.com/acme/repo/pull/77#discussion_r1',
            },
          ],
        });
      }
      return null;
    });

    const { container } = renderPanel();

    expect(
      await screen.findByText('No local execution diff is stored for this PR yet.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Failing Checks (1)')).toBeInTheDocument();
    expect(screen.getByText('test')).toBeInTheDocument();
    expect(screen.getByText('CI')).toBeInTheDocument();
    expect(screen.getByText('Review Comments (1)')).toBeInTheDocument();
    expect(screen.getByText('src/foo.ts:12')).toBeInTheDocument();
    expect(screen.getByText('Needs a tighter assertion')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'GitHub' }));
    for (const button of container.querySelectorAll('button.size-5')) {
      fireEvent.click(button);
    }

    expect(invokeMock).toHaveBeenCalledWith('shell:open-external', {
      url: 'https://github.com/acme/repo/pull/77',
    });
    expect(invokeMock).toHaveBeenCalledWith('shell:open-external', {
      url: 'https://github.com/acme/repo/actions/runs/1',
    });
    expect(invokeMock).toHaveBeenCalledWith('shell:open-external', {
      url: 'https://github.com/acme/repo/pull/77#discussion_r1',
    });
  });
});
