// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type {
  AppSettings,
  AutoCommitResult,
  GitVisualizerData,
  GitWorktreeSummary,
} from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../stores/app-store';
import { ProjectGitVisualizer } from './project-git-visualizer';

vi.mock('@shipcode/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipcode/ui')>();

  return {
    ...actual,
    GitVisualizer: ({
      headerActions,
      onRefresh,
      onSelectWorktree,
      selectedWorktreePath,
      worktrees,
    }: {
      headerActions: ReactNode;
      onRefresh: () => void;
      onSelectWorktree: (path: string) => void;
      selectedWorktreePath: string | null;
      worktrees: GitWorktreeSummary[];
    }) => (
      <div>
        <div data-testid="selected-worktree">{selectedWorktreePath ?? 'none'}</div>
        <div data-testid="worktree-count">{worktrees.length}</div>
        <button type="button" onClick={onRefresh}>
          Refresh graph
        </button>
        <button type="button" onClick={() => onSelectWorktree('/repo/worktree')}>
          Select worktree
        </button>
        <div>{headerActions}</div>
      </div>
    ),
  };
});

vi.mock('../../components/CleanupModal', () => ({
  CleanupModal: ({ open, projectId }: { open: boolean; projectId: string }) =>
    open ? <div data-testid="cleanup-modal">cleanup {projectId}</div> : null,
}));

function renderWithClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectGitVisualizer />
    </QueryClientProvider>,
  );
}

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    autoCommitEnabled: true,
    cleanupCriteria: {
      includeMergedBranches: true,
      includeCompletedWorktrees: true,
      includeStaleWorktrees: false,
      staleDays: 14,
    },
    ...overrides,
  } as AppSettings;
}

function makeWorktree(overrides: Partial<GitWorktreeSummary> = {}): GitWorktreeSummary {
  return {
    id: 'main',
    kind: 'main',
    path: '/repo',
    branch: 'main',
    commitHash: 'abc',
    isDirty: true,
    untrackedCount: 1,
    stagedCount: 0,
    modifiedCount: 1,
    aheadCount: 0,
    behindCount: 0,
    compareRef: null,
    preCommitHookPath: null,
    threadId: null,
    issueNumber: null,
    title: null,
    status: null,
    ...overrides,
  };
}

function makeData(worktrees = [makeWorktree()]): GitVisualizerData {
  return {
    project: { id: 'project-1', name: 'ShipCode', path: '/repo' },
    branches: ['main'],
    worktrees,
  } as unknown as GitVisualizerData;
}

describe('ProjectGitVisualizer', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'settings:get') return makeSettings();
      return null;
    });
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    useAppStore.setState({
      activeProjectId: null,
      pendingGitWorktreePath: null,
    } as never);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders no-project, loading, and git-state error states', async () => {
    renderWithClient();
    expect(screen.getByText('Select a project to view git worktrees.')).toBeInTheDocument();

    cleanup();
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'settings:get') return makeSettings();
      if (channel === 'git:visualizer-data') throw new Error('git exploded');
      return [];
    });
    useAppStore.setState({ activeProjectId: 'project-1' } as never);
    renderWithClient();

    expect(await screen.findByText('git exploded')).toBeInTheDocument();
  });

  it('selects pending worktrees, refreshes data, opens cleanup, and handles auto-commit outcomes', async () => {
    const autoCommitResults: AutoCommitResult[] = [
      {
        commits: [{ sha: 'abc', message: 'commit one' }],
        fallbackUsed: true,
        preCommitHookPath: '.git/hooks/pre-commit',
      },
      {
        commits: [{ sha: 'abc', message: 'commit one' }],
        fallbackUsed: false,
        preCommitHookPath: null,
        partialFailure: {
          groupIndex: 1,
          error: 'hook failed',
          hookFailure: true,
          hookPath: '.git/hooks/pre-commit',
        },
      },
    ] as AutoCommitResult[];
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'settings:get') return makeSettings();
      if (channel === 'git:visualizer-data') {
        return makeData([
          makeWorktree({ path: '/repo', branch: 'main', kind: 'main', isDirty: false }),
          makeWorktree({ path: '/repo/worktree', branch: 'shipcode/42', kind: 'shipcode' }),
        ]);
      }
      if (channel === 'git:worktree-diff') return [{ id: 'diff-1' }];
      if (channel === 'git:auto-commit') return autoCommitResults.shift();
      return null;
    });
    useAppStore.setState({
      activeProjectId: 'project-1',
      pendingGitWorktreePath: '/repo/worktree',
    } as never);

    renderWithClient();

    expect(await screen.findByTestId('selected-worktree')).toHaveTextContent('/repo/worktree');
    expect(useAppStore.getState().pendingGitWorktreePath).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh graph' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cleanup' }));
    expect(screen.getByTestId('cleanup-modal')).toHaveTextContent('project-1');

    fireEvent.click(screen.getByRole('button', { name: /Auto-commit/i }));
    expect(await screen.findByText(/Created 1 commit/)).toHaveTextContent('single-commit fallback');

    fireEvent.click(screen.getByRole('button', { name: /Auto-commit/i }));
    expect(await screen.findByText(/Pre-commit hook blocked auto-commit/)).toHaveTextContent(
      'hook failed',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select worktree' }));
    expect(await screen.findByTestId('selected-worktree')).toHaveTextContent('/repo/worktree');
  });

  it('clears unmatched pending worktrees and reports diff or auto-commit errors', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'settings:get') return makeSettings({ autoCommitEnabled: false });
      if (channel === 'git:visualizer-data') return makeData([makeWorktree({ path: '/repo' })]);
      if (channel === 'git:worktree-diff') throw new Error('diff unavailable');
      if (channel === 'git:auto-commit') throw new Error('commit unavailable');
      return null;
    });
    useAppStore.setState({
      activeProjectId: 'project-1',
      pendingGitWorktreePath: '/missing',
    } as never);

    renderWithClient();

    expect(await screen.findByTestId('selected-worktree')).toHaveTextContent('/repo');
    expect(useAppStore.getState().pendingGitWorktreePath).toBeNull();
    expect(await screen.findByText('diff unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Auto-commit/i })).toBeDisabled();
  });

  it('clears selection when there are no worktrees', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'settings:get') return makeSettings();
      if (channel === 'git:visualizer-data') return makeData([]);
      return [];
    });
    useAppStore.setState({ activeProjectId: 'project-1' } as never);

    renderWithClient();

    expect(await screen.findByTestId('selected-worktree')).toHaveTextContent('none');
  });
});
