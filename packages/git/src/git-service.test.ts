import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mainGitMock = {
  status: vi.fn(),
  log: vi.fn(),
  diff: vi.fn(),
  add: vi.fn(),
  commit: vi.fn(),
  push: vi.fn(),
  branch: vi.fn(),
  branchLocal: vi.fn(),
  raw: vi.fn(),
  revparse: vi.fn(),
  getRemotes: vi.fn(),
  fetch: vi.fn(),
};

const worktreeGitMock = {
  raw: vi.fn(),
  revparse: vi.fn(),
  diff: vi.fn(),
  add: vi.fn(),
  commit: vi.fn(),
  push: vi.fn(),
  log: vi.fn(),
};

vi.mock('simple-git', () => ({
  simpleGit: vi.fn((repoPath?: string) =>
    repoPath === '/tmp/worktree' ? worktreeGitMock : mainGitMock,
  ),
}));

import { GitService } from './git-service';

describe('GitService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps simple-git status and latest commit into GitState', async () => {
    mainGitMock.status.mockResolvedValueOnce({
      current: 'develop',
      isClean: () => false,
      not_added: ['a', 'b'],
      staged: ['c'],
      modified: ['d', 'e', 'f'],
    });
    mainGitMock.log.mockResolvedValueOnce({
      latest: { hash: 'abc123' },
    });

    const git = new GitService('/repo/project');

    await expect(git.getStatus()).resolves.toEqual({
      branch: 'develop',
      commitHash: 'abc123',
      isDirty: true,
      untrackedCount: 2,
      stagedCount: 1,
      modifiedCount: 3,
      aheadCount: 0,
      behindCount: 0,
      compareRef: null,
      preCommitHookPath: null,
    });
  });

  it('uses the worktree path when requesting a diff override', async () => {
    worktreeGitMock.diff.mockResolvedValueOnce('worktree diff');

    const git = new GitService('/repo/project');

    await expect(git.getDiff('/tmp/worktree')).resolves.toBe('worktree diff');
    expect(worktreeGitMock.diff).toHaveBeenCalled();
    expect(mainGitMock.diff).not.toHaveBeenCalled();
  });

  it('falls back to main when origin/HEAD is unavailable but main exists locally', async () => {
    mainGitMock.raw.mockRejectedValueOnce(new Error('origin/HEAD missing'));
    mainGitMock.branchLocal.mockResolvedValueOnce({
      all: ['feature/test', 'main'],
      current: '',
    });

    const git = new GitService('/repo/project');

    await expect(git.getDefaultBranch()).resolves.toBe('main');
  });

  it('returns the origin fetch URL when available', async () => {
    mainGitMock.getRemotes.mockResolvedValueOnce([
      {
        name: 'origin',
        refs: { fetch: 'https://github.com/shipshitdev/shipcode.git' },
      },
    ]);

    const git = new GitService('/repo/project');

    await expect(git.getRemoteUrl()).resolves.toBe('https://github.com/shipshitdev/shipcode.git');
  });

  it('normalizes branch names for a valid repository', async () => {
    mainGitMock.branch.mockResolvedValueOnce({
      all: ['main', 'feature/a', 'remotes/origin/main', 'remotes/origin/release'],
    });

    const git = new GitService('/repo/project');

    await expect(git.listBranches('main')).resolves.toEqual([
      'main',
      'feature/a',
      'origin/release',
    ]);
  });

  it('returns no branches when the project path is not a git repository', async () => {
    mainGitMock.branch.mockRejectedValueOnce(
      new Error('fatal: not a git repository (or any of the parent directories): .git'),
    );

    const git = new GitService('/repo/project');

    await expect(git.listBranches('main')).resolves.toEqual([]);
  });

  it('returns no branches when the project folder no longer exists', async () => {
    mainGitMock.branch.mockRejectedValueOnce(
      new Error('Cannot use simple-git on a directory that does not exist'),
    );

    const git = new GitService('/repo/project');

    await expect(git.listBranches('main')).resolves.toEqual([]);
  });

  it('ignores fetch for a project path that is not a git repository', async () => {
    mainGitMock.fetch.mockRejectedValueOnce(
      new Error('fatal: not a git repository (or any of the parent directories): .git'),
    );

    const git = new GitService('/repo/project');

    await expect(git.fetch()).resolves.toBeUndefined();
  });

  it('still surfaces branch listing failures unrelated to repository detection', async () => {
    mainGitMock.branch.mockRejectedValueOnce(new Error('fatal: bad revision'));

    const git = new GitService('/repo/project');

    await expect(git.listBranches('main')).rejects.toThrow('fatal: bad revision');
  });

  it('resolves relative git hook paths against the repository root', async () => {
    worktreeGitMock.revparse.mockResolvedValueOnce('/repo/project\n');
    worktreeGitMock.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'config') throw new Error('unset');
      if (args[0] === 'rev-parse') return '.git/hooks/pre-commit\n';
      return '';
    });
    const existsSpy = vi
      .spyOn(fs, 'existsSync')
      .mockImplementation((candidate) => candidate === '/repo/project/.git/hooks/pre-commit');

    const git = new GitService('/repo/project');

    try {
      await expect(git.getPreCommitHookPath('/tmp/worktree')).resolves.toBe(
        '/repo/project/.git/hooks/pre-commit',
      );
    } finally {
      existsSpy.mockRestore();
    }
  });

  it('resolves relative core.hooksPath values against the repository root', async () => {
    mainGitMock.revparse.mockResolvedValueOnce('/repo/project\n');
    mainGitMock.raw.mockResolvedValueOnce('.githooks\n');
    const existsSpy = vi
      .spyOn(fs, 'existsSync')
      .mockImplementation((candidate) => candidate === '/repo/project/.githooks/pre-commit');

    const git = new GitService('/repo/project');

    try {
      await expect(git.getPreCommitHookPath()).resolves.toBe('/repo/project/.githooks/pre-commit');
    } finally {
      existsSpy.mockRestore();
    }
  });
});
