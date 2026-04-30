import { describe, expect, it } from 'vitest';
import { analyzeCleanup, type CleanupAnalysisInput } from './cleanup-analyzer';

const ALL_ON = {
  worktreeMergedPr: true,
  worktreeClosedPr: true,
  localBranchNoRemote: true,
  worktreeNoPrCleanTree: false,
};

function input(overrides: Partial<CleanupAnalysisInput> = {}): CleanupAnalysisInput {
  return {
    worktrees: [],
    branches: [],
    pullRequests: [],
    criteria: ALL_ON,
    protectedBranches: ['main', 'master'],
    ...overrides,
  };
}

describe('analyzeCleanup', () => {
  it('flags merged-PR worktrees', () => {
    const items = analyzeCleanup(
      input({
        worktrees: [{ path: '/wt/a', branch: 'feat/a', dirty: false }],
        pullRequests: [
          {
            number: 1,
            url: 'u',
            state: 'merged',
            headRef: 'feat/a',
            merged: true,
          },
        ],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('worktree-merged-pr');
  });

  it('flags closed-unmerged-PR worktrees with dirty flag propagated', () => {
    const items = analyzeCleanup(
      input({
        worktrees: [{ path: '/wt/b', branch: 'feat/b', dirty: true }],
        pullRequests: [{ number: 2, url: 'u', state: 'closed', headRef: 'feat/b', merged: false }],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('worktree-closed-pr');
    if (items[0].kind === 'worktree-closed-pr') {
      expect(items[0].dirty).toBe(true);
    }
  });

  it('treats local commits ahead of the compare ref as unsafe worktree state', () => {
    const items = analyzeCleanup(
      input({
        worktrees: [
          {
            path: '/wt/b',
            branch: 'feat/b',
            dirty: false,
            aheadCount: 2,
            behindCount: 0,
            compareRef: 'develop',
          },
        ],
        pullRequests: [{ number: 2, url: 'u', state: 'closed', headRef: 'feat/b', merged: false }],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('worktree-closed-pr');
    if (items[0].kind === 'worktree-closed-pr') {
      expect(items[0].dirty).toBe(true);
      expect(items[0].aheadCount).toBe(2);
      expect(items[0].compareRef).toBe('develop');
    }
  });

  it('does not suggest no-PR worktrees that are clean but ahead of the compare ref', () => {
    const items = analyzeCleanup(
      input({
        worktrees: [
          {
            path: '/wt/a',
            branch: 'feat/a',
            dirty: false,
            aheadCount: 1,
            compareRef: 'develop',
          },
        ],
        criteria: { ...ALL_ON, worktreeNoPrCleanTree: true },
      }),
    );
    expect(items).toHaveLength(0);
  });

  it('never returns protected branches', () => {
    const items = analyzeCleanup(
      input({
        worktrees: [{ path: '/wt/main', branch: 'main', dirty: false }],
        pullRequests: [{ number: 9, url: 'u', state: 'merged', headRef: 'main', merged: true }],
        branches: [{ name: 'main', hasRemote: false, lastCommitDate: '2026-01-01' }],
      }),
    );
    expect(items).toHaveLength(0);
  });

  it('respects criteria toggles', () => {
    const items = analyzeCleanup(
      input({
        worktrees: [{ path: '/wt/a', branch: 'feat/a', dirty: false }],
        pullRequests: [{ number: 1, url: 'u', state: 'merged', headRef: 'feat/a', merged: true }],
        criteria: { ...ALL_ON, worktreeMergedPr: false },
      }),
    );
    expect(items).toHaveLength(0);
  });

  it('flags local-only branches with no remote and no worktree', () => {
    const items = analyzeCleanup(
      input({
        branches: [
          { name: 'orphan', hasRemote: false, lastCommitDate: '2026-01-01' },
          { name: 'tracked', hasRemote: true, lastCommitDate: '2026-02-01' },
        ],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('local-branch-no-remote');
    if (items[0].kind === 'local-branch-no-remote') {
      expect(items[0].branch).toBe('orphan');
    }
  });

  it('skips local branches that already have an active worktree', () => {
    const items = analyzeCleanup(
      input({
        worktrees: [{ path: '/wt/a', branch: 'orphan', dirty: false }],
        branches: [{ name: 'orphan', hasRemote: false, lastCommitDate: '2026-01-01' }],
      }),
    );
    expect(items).toHaveLength(0);
  });
});
