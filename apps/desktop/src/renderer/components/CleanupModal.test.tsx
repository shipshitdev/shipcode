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

function renderCleanupModal({ open = true, onClose = vi.fn() } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <CleanupModal
        open={open}
        onClose={onClose}
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

  it('toggles individual items and whole groups without selecting blocked local work', async () => {
    const blockedAnalysis: CleanupAnalyzeResult = {
      ...analysis,
      protectedBranches: [],
      items: [
        ...analysis.items,
        {
          id: 'wt-dirty:/tmp/dirty',
          kind: 'worktree-no-pr-clean',
          worktreePath: '/tmp/dirty',
          branch: 'ship/dirty',
          dirty: true,
          aheadCount: 2,
          behindCount: 0,
          compareRef: 'origin/main',
        },
        {
          id: 'local-no-remote:ship/local',
          kind: 'local-branch-no-remote',
          branch: 'ship/local',
          lastCommitDate: '2026-05-02T00:00:00.000Z',
          aheadCount: 0,
          behindCount: 0,
          compareRef: null,
        },
      ],
    };
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'git:cleanup-analyze') return blockedAnalysis;
      if (channel === 'git:cleanup-apply') return { succeeded: [], failed: [] };
      return null;
    });

    renderCleanupModal();

    expect(await screen.findByText('ship/dirty')).toBeInTheDocument();
    expect(screen.getByText(/LOCAL WORK/)).toBeInTheDocument();
    expect(screen.getByText(/\+2 ahead vs origin\/main/)).toBeInTheDocument();
    expect(screen.getByText('ship/local')).toBeInTheDocument();

    const dirtyCheckbox = screen.getByLabelText(/ship\/dirty/);
    expect(dirtyCheckbox).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply (3)' })).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/ship\/13-done/));
    expect(screen.getByRole('button', { name: 'Apply (2)' })).toBeDisabled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear' })[0]);
    expect(screen.getByRole('button', { name: 'Apply (1)' })).toBeDisabled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Select all' })[0]);
    expect(screen.getByRole('button', { name: 'Apply (2)' })).toBeDisabled();
  });

  it('renders analyze and apply failures', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'git:cleanup-analyze') throw new Error('analysis failed');
      return null;
    });

    renderCleanupModal();

    expect(await screen.findByText('analysis failed')).toBeInTheDocument();

    cleanup();
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'git:cleanup-analyze') return analysis;
      if (channel === 'git:cleanup-apply') throw new Error('apply failed');
      return null;
    });

    renderCleanupModal();

    await screen.findByText('Confirm cleanup');
    fireEvent.click(
      screen.getByLabelText(
        'I reviewed this exact list and want to delete only these selected cleanup items.',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply (3)' }));

    expect(await screen.findByText('apply failed')).toBeInTheDocument();
  });

  it('renders partial cleanup results and resets when closed', async () => {
    const onClose = vi.fn();
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'git:cleanup-analyze') return analysis;
      if (channel === 'git:cleanup-apply') {
        return {
          succeeded: [analysis.items[0].id],
          failed: [{ itemId: analysis.items[1].id, error: 'branch locked' }],
        };
      }
      return null;
    });

    const { rerender } = renderCleanupModal({ onClose });

    await screen.findByText('Confirm cleanup');
    fireEvent.click(
      screen.getByLabelText(
        'I reviewed this exact list and want to delete only these selected cleanup items.',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply (3)' }));

    expect(await screen.findByText('Removed 1 item.')).toBeInTheDocument();
    expect(await screen.findByText('1 failed:')).toBeInTheDocument();
    expect(screen.getByText(/branch locked/)).toBeInTheDocument();

    const closeButton = screen.getAllByRole('button', { name: 'Close' }).at(-1);
    if (!closeButton) throw new Error('Expected a close button');
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();

    rerender(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
          })
        }
      >
        <CleanupModal
          open={false}
          onClose={onClose}
          projectId="project-1"
          criteria={DEFAULT_SETTINGS.cleanupCriteria}
        />
      </QueryClientProvider>,
    );
  });
});
