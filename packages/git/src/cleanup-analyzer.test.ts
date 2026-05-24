import { describe, expect, it } from 'vitest';
import { analyzeCleanup, type CleanupAnalysisInput } from './cleanup-analyzer';

const ALL_ON = {
  worktreeMergedPr: true,
  worktreeClosedPr: true,
  localBranchMerged: true,
  localBranchNoRemote: true,
  remoteBranchMerged: true,
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
        worktrees: [
          { path: '/wt/a', branch: 'feat/a', dirty: false, aheadCount: 0, compareRef: 'main' },
        ],
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

  it('does not flag closed-PR worktrees with local work', () => {
    const items = analyzeCleanup(
      input({
        worktrees: [
          { path: '/wt/b', branch: 'feat/b', dirty: true, aheadCount: 0, compareRef: 'main' },
        ],
        pullRequests: [{ number: 2, url: 'u', state: 'closed', headRef: 'feat/b', merged: false }],
      }),
    );
    expect(items).toHaveLength(0);
  });

  it('does not flag worktrees with local commits ahead of the compare ref', () => {
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
    expect(items).toHaveLength(0);
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

  it('flags worktree artifact cleanup without requiring merged branch state', () => {
    const items = analyzeCleanup(
      input({
        worktrees: [
          {
            path: '/wt/a',
            branch: 'ship/77-open',
            dirty: true,
            aheadCount: 3,
            compareRef: 'main',
            artifactPaths: ['node_modules', '.next'],
          },
        ],
      }),
    );

    expect(items).toEqual([
      {
        id: 'wt-artifacts:/wt/a',
        kind: 'worktree-artifacts',
        worktreePath: '/wt/a',
        branch: 'ship/77-open',
        artifactPaths: ['node_modules', '.next'],
      },
    ]);
  });

  it('flags managed no-PR worktrees with clean verified trees when enabled', () => {
    const items = analyzeCleanup(
      input({
        worktrees: [
          {
            path: '/wt/no-pr',
            branch: 'ship/77-clean',
            dirty: false,
            aheadCount: 0,
            behindCount: 0,
            compareRef: 'main',
          },
        ],
        criteria: { ...ALL_ON, worktreeNoPrCleanTree: true },
      }),
    );

    expect(items).toEqual([
      expect.objectContaining({
        id: 'wt-no-pr:/wt/no-pr',
        kind: 'worktree-no-pr-clean',
        worktreePath: '/wt/no-pr',
        branch: 'ship/77-clean',
      }),
    ]);
  });

  it('flags closed-PR worktrees with clean verified trees', () => {
    const items = analyzeCleanup(
      input({
        worktrees: [
          {
            path: '/wt/closed',
            branch: 'feat/closed',
            dirty: false,
            aheadCount: 0,
            behindCount: 0,
            compareRef: 'main',
          },
        ],
        pullRequests: [
          {
            number: 2,
            url: 'https://github.com/acme/repo/pull/2',
            state: 'closed',
            headRef: 'feat/closed',
            merged: false,
          },
        ],
      }),
    );

    expect(items).toEqual([
      expect.objectContaining({
        id: 'wt-closed:/wt/closed',
        kind: 'worktree-closed-pr',
        prNumber: 2,
        prUrl: 'https://github.com/acme/repo/pull/2',
      }),
    ]);
  });

  it('never returns protected branches', () => {
    const items = analyzeCleanup(
      input({
        worktrees: [
          { path: '/wt/main', branch: 'main', dirty: false, aheadCount: 0, compareRef: 'main' },
        ],
        pullRequests: [{ number: 9, url: 'u', state: 'merged', headRef: 'main', merged: true }],
        branches: [{ name: 'main', hasRemote: false, lastCommitDate: '2026-01-01' }],
      }),
    );
    expect(items).toHaveLength(0);
  });

  it('respects criteria toggles', () => {
    const items = analyzeCleanup(
      input({
        worktrees: [
          { path: '/wt/a', branch: 'feat/a', dirty: false, aheadCount: 0, compareRef: 'main' },
        ],
        pullRequests: [{ number: 1, url: 'u', state: 'merged', headRef: 'feat/a', merged: true }],
        criteria: { ...ALL_ON, worktreeMergedPr: false },
      }),
    );
    expect(items).toHaveLength(0);
  });

  it('skips worktrees with incomplete verification metadata', () => {
    const items = analyzeCleanup(
      input({
        worktrees: [
          {
            path: '/wt/incomplete',
            branch: 'ship/45-incomplete',
            dirty: false,
          },
        ],
        criteria: { ...ALL_ON, worktreeNoPrCleanTree: true },
      }),
    );

    expect(items).toEqual([]);
  });

  it('flags local-only branches with no remote and no worktree', () => {
    const items = analyzeCleanup(
      input({
        branches: [
          {
            name: 'orphan',
            hasRemote: false,
            lastCommitDate: '2026-01-01',
            aheadCount: 0,
            compareRef: 'main',
          },
          {
            name: 'tracked',
            hasRemote: true,
            lastCommitDate: '2026-02-01',
            aheadCount: 0,
            compareRef: 'main',
          },
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
        worktrees: [
          { path: '/wt/a', branch: 'orphan', dirty: false, aheadCount: 0, compareRef: 'main' },
        ],
        branches: [
          {
            name: 'orphan',
            hasRemote: false,
            lastCommitDate: '2026-01-01',
            aheadCount: 0,
            compareRef: 'main',
          },
        ],
      }),
    );
    expect(items).toHaveLength(0);
  });

  it('flags merged local and remote ShipCode branches', () => {
    const items = analyzeCleanup(
      input({
        branches: [
          {
            name: 'ship/44-done',
            hasRemote: true,
            remoteName: 'origin/ship/44-done',
            lastCommitDate: '2026-01-01',
            aheadCount: 0,
            compareRef: 'origin/main',
          },
        ],
        remoteBranches: [
          {
            name: 'ship/44-done',
            remote: 'origin',
            lastCommitDate: '2026-01-01',
            aheadCount: 0,
            compareRef: 'origin/main',
          },
        ],
      }),
    );

    expect(items.map((item) => item.kind)).toEqual(['local-branch-merged', 'remote-branch-merged']);
  });

  it('uses non-origin remote names as-is for merged local branches', () => {
    const items = analyzeCleanup(
      input({
        branches: [
          {
            name: 'shipcode/done',
            hasRemote: true,
            remoteName: 'upstream/shipcode/done',
            lastCommitDate: '2026-01-01',
            aheadCount: 0,
            behindCount: 2,
            compareRef: 'upstream/main',
          },
        ],
      }),
    );

    expect(items).toEqual([
      expect.objectContaining({
        kind: 'local-branch-merged',
        remoteBranch: 'upstream/shipcode/done',
        behindCount: 2,
      }),
    ]);
  });

  it('skips unverified local branches before applying branch cleanup criteria', () => {
    const items = analyzeCleanup(
      input({
        branches: [
          {
            name: 'ship/45-unverified',
            hasRemote: false,
            lastCommitDate: '2026-01-01',
            aheadCount: 0,
            compareRef: null,
          },
        ],
      }),
    );

    expect(items).toEqual([]);
  });

  it('defaults missing local branch cleanup metadata when emitting items', () => {
    const items = analyzeCleanup(
      input({
        branches: [
          {
            name: 'ship/45-local',
            hasRemote: true,
            remoteName: 'origin/ship/45-local',
            lastCommitDate: '2026-01-01',
            compareRef: 'origin/main',
          },
          {
            name: 'local-only',
            hasRemote: false,
            lastCommitDate: '2026-01-02',
            compareRef: 'main',
          },
        ],
        managedBranches: ['local-only'],
      }),
    );

    expect(items).toEqual([
      expect.objectContaining({
        kind: 'local-branch-merged',
        aheadCount: 0,
        behindCount: 0,
        compareRef: 'origin/main',
        remoteBranch: 'ship/45-local',
      }),
      expect.objectContaining({
        kind: 'local-branch-no-remote',
        aheadCount: 0,
        behindCount: 0,
        compareRef: 'main',
      }),
    ]);
  });

  it('respects the local branch no-remote cleanup toggle', () => {
    const items = analyzeCleanup(
      input({
        branches: [
          {
            name: 'local-only',
            hasRemote: false,
            lastCommitDate: '2026-01-02',
            compareRef: 'main',
          },
        ],
        criteria: { ...ALL_ON, localBranchNoRemote: false },
      }),
    );

    expect(items).toEqual([]);
  });

  it('skips remote branches when a matching worktree has local work', () => {
    const items = analyzeCleanup(
      input({
        worktrees: [
          {
            path: '/wt/a',
            branch: 'ship/44-done',
            dirty: true,
            aheadCount: 0,
            compareRef: 'origin/main',
          },
        ],
        remoteBranches: [
          {
            name: 'ship/44-done',
            remote: 'origin',
            lastCommitDate: '2026-01-01',
            aheadCount: 0,
            compareRef: 'origin/main',
          },
        ],
      }),
    );

    expect(items).toHaveLength(0);
  });

  it('skips protected, unsafe, unverified, and unmanaged remote branches', () => {
    const items = analyzeCleanup(
      input({
        worktrees: [
          {
            path: '/wt/unsafe',
            branch: 'ship/99-unsafe',
            dirty: false,
            aheadCount: 1,
            compareRef: 'origin/main',
          },
        ],
        remoteBranches: [
          {
            name: 'main',
            remote: 'origin',
            lastCommitDate: '2026-01-01',
            aheadCount: 0,
            compareRef: 'origin/main',
          },
          {
            name: 'ship/99-unsafe',
            remote: 'origin',
            lastCommitDate: '2026-01-01',
            aheadCount: 0,
            compareRef: 'origin/main',
          },
          {
            name: 'ship/100-ahead',
            remote: 'origin',
            lastCommitDate: '2026-01-01',
            aheadCount: 1,
            compareRef: 'origin/main',
          },
          {
            name: 'feature/unmanaged',
            remote: 'origin',
            lastCommitDate: '2026-01-01',
            aheadCount: 0,
            compareRef: 'origin/main',
          },
        ],
      }),
    );

    expect(items).toEqual([]);
  });

  it('respects the remote branch cleanup toggle', () => {
    const items = analyzeCleanup(
      input({
        remoteBranches: [
          {
            name: 'ship/46-remote',
            remote: 'origin',
            lastCommitDate: '2026-01-01',
            compareRef: 'origin/main',
          },
        ],
        criteria: { ...ALL_ON, remoteBranchMerged: false },
      }),
    );

    expect(items).toEqual([]);
  });

  it('defaults missing remote branch metadata when emitting cleanup items', () => {
    const items = analyzeCleanup(
      input({
        worktrees: [
          {
            path: '/wt/safe',
            branch: 'ship/47-safe',
            dirty: false,
          },
        ],
        remoteBranches: [
          {
            name: 'ship/46-remote',
            remote: 'origin',
            lastCommitDate: '2026-01-01',
            compareRef: 'origin/main',
          },
        ],
      }),
    );

    expect(items).toEqual([
      expect.objectContaining({
        kind: 'remote-branch-merged',
        aheadCount: 0,
        behindCount: 0,
        compareRef: 'origin/main',
      }),
    ]);
  });
});
