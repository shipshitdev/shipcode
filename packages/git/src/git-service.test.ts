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
  getRemotes: vi.fn(),
  fetch: vi.fn(),
};

const worktreeGitMock = {
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
});
