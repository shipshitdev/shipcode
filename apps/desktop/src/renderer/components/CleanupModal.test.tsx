// @vitest-environment jsdom

import { type CleanupAnalyzeResult, DEFAULT_SETTINGS } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CleanupModal } from './CleanupModal';

const analysis: CleanupAnalyzeResult = {
  baseRef: 'origin/main',
  protectedBranches: ['main', 'master'],
  items: [
    {
      id: 'wt-merged:/tmp/worktree',
      kind: 'worktree-merged-pr',
      worktreePath: '/tmp/worktree',
      branch: 'ship/12-fix',
      prNumber: 12,
      prUrl: 'https://github.com/acme/repo/pull/12',
      dirty: false,
      aheadCount: 0,
      behindCount: 1,
      compareRef: 'origin/main',
    },
    {
      id: 'branch-merged:ship/13-done',
      kind: 'local-branch-merged',
      branch: 'ship/13-done',
      lastCommitDate: '2026-05-01T00:00:00.000Z',
      aheadCount: 0,
      behindCount: 0,
      compareRef: 'origin/main',
      remoteBranch: 'ship/13-done',
      prNumber: 13,
    },
    {
      id: 'remote-merged:origin/ship/14-done',
      kind: 'remote-branch-merged',
      branch: 'ship/14-done',
      remote: 'origin',
      lastCommitDate: '2026-05-01T00:00:00.000Z',
      aheadCount: 0,
      behindCount: 0,
      compareRef: 'origin/main',
      prNumber: 14,
    },
  ],
};

function renderCleanupModal() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <CleanupModal
        open
        onClose={vi.fn()}
        projectId="project-1"
        criteria={DEFAULT_SETTINGS.cleanupCriteria}
      />
    </QueryClientProvider>,
  );
}

describe('CleanupModal', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();
    window.shipcode = {
      invoke: invokeMock as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}),
    };
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'git:cleanup-analyze') return analysis;
      if (channel === 'git:cleanup-apply')
        return { succeeded: analysis.items.map((i) => i.id), failed: [] };
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('lists every selected worktree and branch in the confirmation before applying', async () => {
    renderCleanupModal();

    await screen.findByText('Confirm cleanup');
    expect(screen.getAllByText(/ship\/12-fix .*\/tmp\/worktree/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('ship/13-done').length).toBeGreaterThan(0);
    expect(screen.getAllByText('origin/ship/14-done').length).toBeGreaterThan(0);

    const applyButton = screen.getByRole('button', { name: 'Apply (3)' });
    expect(applyButton).toBeDisabled();

    fireEvent.click(
      screen.getByLabelText(
        'I reviewed this exact list and want to delete only these selected cleanup items.',
      ),
    );
    expect(applyButton).toBeEnabled();
    fireEvent.click(applyButton);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('git:cleanup-apply', {
        projectId: 'project-1',
        itemIds: analysis.items.map((item) => item.id),
      });
    });
  });
});
