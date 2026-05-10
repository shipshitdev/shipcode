import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mainGitMock = {
  status: vi.fn(),
  log: vi.fn(),
  diff: vi.fn(),
  add: vi.fn(),
  commit: vi.fn(),
  reset: vi.fn(),
  push: vi.fn(),
  branch: vi.fn(),
  branchLocal: vi.fn(),
  raw: vi.fn(),
  revparse: vi.fn(),
  getRemotes: vi.fn(),
  fetch: vi.fn(),
};

const worktreeGitMock = {
  status: vi.fn(),
  raw: vi.fn(),
  revparse: vi.fn(),
  diff: vi.fn(),
  add: vi.fn(),
  commit: vi.fn(),
  reset: vi.fn(),
  branch: vi.fn(),
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

  it('uses the selected repository when reading raw status', async () => {
    worktreeGitMock.status.mockResolvedValueOnce({ current: 'feature/worktree' });

    const git = new GitService('/repo/project');

    await expect(git.getRawStatus('/tmp/worktree')).resolves.toEqual({
      current: 'feature/worktree',
    });
    expect(worktreeGitMock.status).toHaveBeenCalledTimes(1);
    expect(mainGitMock.status).not.toHaveBeenCalled();
  });

  it('reads diff variants and commit helpers from the selected repository', async () => {
    mainGitMock.diff.mockResolvedValueOnce('working diff');
    worktreeGitMock.diff.mockResolvedValueOnce('head diff');
    mainGitMock.diff.mockResolvedValueOnce('stat diff');
    worktreeGitMock.commit.mockResolvedValueOnce({ commit: 'commit-1' });
    mainGitMock.commit.mockResolvedValueOnce({ commit: 'commit-2' });

    const git = new GitService('/repo/project');

    await expect(git.getDiff()).resolves.toBe('working diff');
    await expect(git.getDiffAgainstHead('/tmp/worktree')).resolves.toBe('head diff');
    await expect(git.getDiffStat()).resolves.toBe('stat diff');
    await expect(git.commit('save changes', '/tmp/worktree')).resolves.toBe('commit-1');
    await expect(git.commitStaged('save staged')).resolves.toBe('commit-2');
    expect(worktreeGitMock.diff).toHaveBeenCalledWith(['HEAD']);
    expect(mainGitMock.diff).toHaveBeenLastCalledWith(['--stat']);
    expect(worktreeGitMock.add).toHaveBeenCalledWith('.');
  });

  it('reads main and worktree variants for git helpers with optional paths', async () => {
    mainGitMock.diff.mockResolvedValueOnce('main head diff');
    worktreeGitMock.diff.mockResolvedValueOnce('worktree stat diff');
    mainGitMock.commit.mockResolvedValueOnce({ commit: 'commit-main' });
    worktreeGitMock.commit.mockResolvedValueOnce({ commit: 'commit-staged-worktree' });
    mainGitMock.log.mockResolvedValueOnce({ all: [] });

    const git = new GitService('/repo/project');

    await expect(git.getDiffAgainstHead()).resolves.toBe('main head diff');
    await expect(git.getDiffStat('/tmp/worktree')).resolves.toBe('worktree stat diff');
    await expect(git.commit('save main')).resolves.toBe('commit-main');
    await git.addPaths(['main.ts']);
    await git.resetIndex();
    await expect(git.commitStaged('save staged', '/tmp/worktree')).resolves.toBe(
      'commit-staged-worktree',
    );
    await expect(git.getRawStatus()).resolves.toBeUndefined();
    await expect(git.log()).resolves.toEqual([]);

    expect(mainGitMock.raw).toHaveBeenCalledWith(['add', '-A', '--', 'main.ts']);
    expect(mainGitMock.reset).toHaveBeenCalledWith(['--mixed']);
    expect(worktreeGitMock.commit).toHaveBeenCalledWith('save staged');
    expect(mainGitMock.status).toHaveBeenCalled();
  });

  it('pushes either the current branch or a named upstream branch', async () => {
    const git = new GitService('/repo/project');

    await git.push();
    await git.push('feature/a', '/tmp/worktree');

    expect(mainGitMock.push).toHaveBeenCalledWith();
    expect(worktreeGitMock.push).toHaveBeenCalledWith('origin', 'feature/a', ['--set-upstream']);
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

  it('uses origin HEAD when available and falls back through master/current/default', async () => {
    const git = new GitService('/repo/project');

    mainGitMock.raw.mockResolvedValueOnce('origin/develop\n');
    await expect(git.getDefaultBranch()).resolves.toBe('develop');

    mainGitMock.raw.mockRejectedValueOnce(new Error('origin/HEAD missing'));
    mainGitMock.branchLocal.mockResolvedValueOnce({
      all: ['feature/test', 'master'],
      current: '',
    });
    await expect(git.getDefaultBranch()).resolves.toBe('master');

    mainGitMock.raw.mockRejectedValueOnce(new Error('origin/HEAD missing'));
    mainGitMock.branchLocal.mockResolvedValueOnce({
      all: ['feature/test'],
      current: 'feature/test',
    });
    await expect(git.getDefaultBranch()).resolves.toBe('feature/test');

    mainGitMock.raw.mockRejectedValueOnce(new Error('origin/HEAD missing'));
    mainGitMock.branchLocal.mockResolvedValueOnce({
      all: [],
      current: undefined,
    });
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

  it('returns null when origin is missing or remotes cannot be read', async () => {
    const git = new GitService('/repo/project');

    mainGitMock.getRemotes.mockResolvedValueOnce([{ name: 'upstream', refs: { fetch: 'url' } }]);
    await expect(git.getRemoteUrl()).resolves.toBeNull();

    mainGitMock.getRemotes.mockRejectedValueOnce(new Error('remote failure'));
    await expect(git.getRemoteUrl()).resolves.toBeNull();
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

  it('ignores string-form repository unavailable errors from simple-git', async () => {
    mainGitMock.fetch.mockRejectedValueOnce('fatal: not a git repository');
    mainGitMock.branch.mockRejectedValueOnce(
      'Cannot use simple-git on a directory that does not exist',
    );

    const git = new GitService('/repo/project');

    await expect(git.fetch()).resolves.toBeUndefined();
    await expect(git.listBranches('main')).resolves.toEqual([]);
  });

  it('surfaces fetch failures unrelated to repository detection', async () => {
    mainGitMock.fetch.mockRejectedValueOnce(new Error('network unavailable'));

    const git = new GitService('/repo/project');

    await expect(git.fetch()).rejects.toThrow('network unavailable');
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

  it('returns null when no pre-commit hook exists or git commands fail', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const git = new GitService('/repo/project');

    try {
      mainGitMock.revparse.mockResolvedValueOnce('/repo/project\n');
      mainGitMock.raw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'config') return '".githooks"\n';
        return '';
      });
      await expect(git.getPreCommitHookPath()).resolves.toBeNull();

      mainGitMock.revparse.mockRejectedValueOnce(new Error('not a repo'));
      await expect(git.getPreCommitHookPath()).resolves.toBeNull();
    } finally {
      existsSpy.mockRestore();
    }
  });

  it('handles staging, branch deletion, staged file parsing, and logs', async () => {
    mainGitMock.diff.mockResolvedValueOnce('M\ta.ts\nA\tb.ts\nR100\told.ts\tnew.ts\n\n');
    worktreeGitMock.log.mockResolvedValueOnce({
      all: [
        { hash: 'abc', message: 'first', date: '2026-05-08T00:00:00Z' },
        { hash: 'def', message: 'second', date: '2026-05-07T00:00:00Z' },
      ],
    });

    const git = new GitService('/repo/project');

    await git.addPaths([]);
    await git.addPaths(['a.ts', 'b.ts'], '/tmp/worktree');
    await git.resetIndex('/tmp/worktree');
    await expect(git.getStagedFiles()).resolves.toEqual(['a.ts', 'b.ts', 'old.ts', 'new.ts']);
    await git.deleteLocalBranch('feature/remove', '/tmp/worktree');
    await git.deleteRemoteBranch('feature/remove', 'upstream');
    await expect(git.log(2, '/tmp/worktree')).resolves.toEqual([
      { hash: 'abc', message: 'first', date: '2026-05-08T00:00:00Z' },
      { hash: 'def', message: 'second', date: '2026-05-07T00:00:00Z' },
    ]);

    expect(worktreeGitMock.raw).toHaveBeenCalledWith(['add', '-A', '--', 'a.ts', 'b.ts']);
    expect(worktreeGitMock.reset).toHaveBeenCalledWith(['--mixed']);
    expect(worktreeGitMock.branch).toHaveBeenCalledWith(['-D', 'feature/remove']);
    expect(mainGitMock.push).toHaveBeenCalledWith(['upstream', '--delete', 'feature/remove']);
    expect(worktreeGitMock.log).toHaveBeenCalledWith({ maxCount: 2 });
  });

  it('ignores staged name-status entries without paths', async () => {
    mainGitMock.diff.mockResolvedValueOnce('M\nC100\told.ts\tnew.ts\n');
    worktreeGitMock.diff.mockResolvedValueOnce('A\tworktree.ts\n');

    const git = new GitService('/repo/project');

    await expect(git.getStagedFiles()).resolves.toEqual(['old.ts', 'new.ts']);
    await expect(git.getStagedFiles('/tmp/worktree')).resolves.toEqual(['worktree.ts']);
  });

  it('deletes local branches from the main repository by default', async () => {
    const git = new GitService('/repo/project');

    await git.deleteLocalBranch('feature/remove');

    expect(mainGitMock.branch).toHaveBeenCalledWith(['-D', 'feature/remove']);
  });

  it('checks refs, merge ancestry, and branch divergence with fallback failure behavior', async () => {
    const git = new GitService('/repo/project');

    mainGitMock.raw.mockResolvedValueOnce('');
    await expect(git.hasRef('main')).resolves.toBe(true);

    mainGitMock.raw.mockRejectedValueOnce(new Error('missing'));
    await expect(git.hasRef('missing')).resolves.toBe(false);

    mainGitMock.raw.mockRejectedValueOnce(new Error('missing a'));
    mainGitMock.raw.mockResolvedValueOnce('');
    await expect(git.resolveFirstExistingRef(['missing', 'origin/main'])).resolves.toBe(
      'origin/main',
    );

    mainGitMock.raw.mockRejectedValueOnce(new Error('missing a'));
    mainGitMock.raw.mockRejectedValueOnce(new Error('missing b'));
    await expect(git.resolveFirstExistingRef(['missing-a', 'missing-b'])).resolves.toBeNull();

    mainGitMock.raw.mockResolvedValueOnce('');
    mainGitMock.raw.mockResolvedValueOnce('');
    mainGitMock.raw.mockResolvedValueOnce('');
    await expect(git.isRefMergedInto('feature/a', 'main')).resolves.toBe(true);

    mainGitMock.raw.mockResolvedValueOnce('');
    mainGitMock.raw.mockResolvedValueOnce('');
    mainGitMock.raw.mockRejectedValueOnce(new Error('not ancestor'));
    await expect(git.isRefMergedInto('feature/a', 'main')).resolves.toBe(false);

    mainGitMock.raw.mockRejectedValueOnce(new Error('missing feature'));
    await expect(git.isRefMergedInto('feature/a', 'main')).resolves.toBe(false);

    mainGitMock.raw.mockResolvedValueOnce('');
    mainGitMock.raw.mockResolvedValueOnce('');
    mainGitMock.raw.mockResolvedValueOnce('3\t2\n');
    await expect(git.getBranchDivergence('feature/a', 'main')).resolves.toEqual({
      aheadCount: 2,
      behindCount: 3,
      compareRef: 'main',
    });

    mainGitMock.raw.mockResolvedValueOnce('');
    mainGitMock.raw.mockResolvedValueOnce('');
    mainGitMock.raw.mockResolvedValueOnce('not-a-number\n');
    await expect(git.getBranchDivergence('feature/a', 'main')).resolves.toEqual({
      aheadCount: 0,
      behindCount: 0,
      compareRef: 'main',
    });

    mainGitMock.raw.mockResolvedValueOnce('');
    mainGitMock.raw.mockResolvedValueOnce('');
    mainGitMock.raw.mockResolvedValueOnce('');
    await expect(git.getBranchDivergence('feature/a', 'main')).resolves.toEqual({
      aheadCount: 0,
      behindCount: 0,
      compareRef: 'main',
    });

    mainGitMock.raw.mockResolvedValueOnce('');
    mainGitMock.raw.mockResolvedValueOnce('');
    mainGitMock.raw.mockRejectedValueOnce(new Error('rev-list failed'));
    await expect(git.getBranchDivergence('feature/a', 'main')).resolves.toEqual({
      aheadCount: 0,
      behindCount: 0,
      compareRef: 'main',
    });

    mainGitMock.raw.mockRejectedValueOnce(new Error('missing branch'));
    await expect(git.getBranchDivergence('missing', 'main')).resolves.toEqual({
      aheadCount: 0,
      behindCount: 0,
      compareRef: null,
    });
  });

  it('calculates status divergence from upstream and fallback refs', async () => {
    const git = new GitService('/repo/project');

    mainGitMock.status.mockResolvedValueOnce({
      current: null,
      isClean: () => true,
      not_added: [],
      staged: [],
      modified: [],
    });
    mainGitMock.log.mockResolvedValueOnce({ latest: null });
    mainGitMock.raw.mockResolvedValueOnce('origin/main\n');
    mainGitMock.raw.mockResolvedValueOnce('');
    mainGitMock.raw.mockResolvedValueOnce('4\t1\n');
    mainGitMock.revparse.mockRejectedValueOnce(new Error('no hook root'));
    await expect(git.getStatus()).resolves.toMatchObject({
      branch: 'HEAD',
      commitHash: '',
      isDirty: false,
      aheadCount: 1,
      behindCount: 4,
      compareRef: 'origin/main',
    });

    mainGitMock.status.mockResolvedValueOnce({
      current: 'feature/a',
      isClean: () => true,
      not_added: [],
      staged: [],
      modified: [],
    });
    mainGitMock.log.mockResolvedValueOnce({ latest: { hash: 'abc' } });
    mainGitMock.raw.mockRejectedValueOnce(new Error('no upstream'));
    mainGitMock.raw.mockResolvedValueOnce('');
    mainGitMock.raw.mockRejectedValueOnce(new Error('divergence failed'));
    mainGitMock.revparse.mockRejectedValueOnce(new Error('no hook root'));
    await expect(git.getStatus(undefined, 'main')).resolves.toMatchObject({
      aheadCount: 0,
      behindCount: 0,
      compareRef: 'main',
    });
  });

  it('uses worktree status fallbacks and clamps malformed divergence counts', async () => {
    worktreeGitMock.status.mockResolvedValueOnce({
      current: undefined,
      isClean: () => true,
      not_added: [],
      staged: [],
      modified: [],
    });
    worktreeGitMock.log.mockResolvedValueOnce({ latest: undefined });
    worktreeGitMock.raw.mockRejectedValueOnce(new Error('no upstream'));
    worktreeGitMock.raw.mockResolvedValueOnce('');
    worktreeGitMock.raw.mockResolvedValueOnce('');
    worktreeGitMock.revparse.mockRejectedValueOnce(new Error('no hook root'));

    const git = new GitService('/repo/project');

    await expect(git.getStatus('/tmp/worktree', 'main')).resolves.toMatchObject({
      branch: 'HEAD',
      commitHash: '',
      aheadCount: 0,
      behindCount: 0,
      compareRef: 'main',
    });
  });

  it('returns null when git-path resolves no pre-commit hook path', async () => {
    mainGitMock.revparse.mockResolvedValueOnce('/repo/project\n');
    mainGitMock.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'config') return '';
      return '';
    });

    const git = new GitService('/repo/project');

    await expect(git.getPreCommitHookPath()).resolves.toBeNull();
  });

  it('prefers the explicit compare fallback when requested for status divergence', async () => {
    const git = new GitService('/repo/project');

    mainGitMock.status.mockResolvedValueOnce({
      current: 'feature/a',
      isClean: () => true,
      not_added: [],
      staged: [],
      modified: [],
    });
    mainGitMock.log.mockResolvedValueOnce({ latest: { hash: 'abc' } });
    mainGitMock.raw.mockResolvedValueOnce('');
    mainGitMock.raw.mockResolvedValueOnce('1\t2\n');
    mainGitMock.revparse.mockRejectedValueOnce(new Error('no hook root'));

    await expect(
      git.getStatus(undefined, 'main', { preferFallbackRef: true }),
    ).resolves.toMatchObject({
      aheadCount: 2,
      behindCount: 1,
      compareRef: 'main',
    });

    expect(mainGitMock.raw).toHaveBeenNthCalledWith(1, [
      'rev-parse',
      '--verify',
      '--quiet',
      'main^{commit}',
    ]);
    expect(mainGitMock.raw).toHaveBeenNthCalledWith(2, [
      'rev-list',
      '--left-right',
      '--count',
      'main...HEAD',
    ]);
  });

  it('marks dirty worktrees as dirty when status is dirty or unreadable', async () => {
    mainGitMock.status
      .mockResolvedValueOnce({ isClean: () => false })
      .mockRejectedValueOnce(new Error('missing worktree'));

    const git = new GitService('/repo/project');

    await expect(git.getDirtyWorktrees(['/tmp/a', '/tmp/b'])).resolves.toEqual(
      new Map([
        ['/tmp/a', true],
        ['/tmp/b', true],
      ]),
    );
  });

  it('parses local and remote branch metadata', async () => {
    mainGitMock.raw
      .mockResolvedValueOnce(
        'main\torigin/main\t2026-05-08T00:00:00+00:00\nfeature/a\t\t2026-05-07T00:00:00+00:00\nfeature/no-date\torigin/feature/no-date\n',
      )
      .mockResolvedValueOnce(
        'origin/HEAD\t2026-05-08T00:00:00+00:00\norigin/main\t2026-05-08T00:00:00+00:00\norigin/feature/a\t\nupstream/other\t2026-05-06T00:00:00+00:00\n',
      );

    const git = new GitService('/repo/project');

    await expect(git.listLocalBranchesWithMeta()).resolves.toEqual([
      {
        name: 'main',
        hasRemote: true,
        remoteName: 'origin/main',
        lastCommitDate: '2026-05-08T00:00:00+00:00',
      },
      {
        name: 'feature/a',
        hasRemote: false,
        remoteName: null,
        lastCommitDate: '2026-05-07T00:00:00+00:00',
      },
      {
        name: 'feature/no-date',
        hasRemote: true,
        remoteName: 'origin/feature/no-date',
        lastCommitDate: '',
      },
    ]);
    await expect(git.listRemoteBranchesWithMeta()).resolves.toEqual([
      {
        name: 'main',
        remote: 'origin',
        lastCommitDate: '2026-05-08T00:00:00+00:00',
      },
      {
        name: 'feature/a',
        remote: 'origin',
        lastCommitDate: '',
      },
      {
        name: 'upstream/other',
        remote: 'origin',
        lastCommitDate: '2026-05-06T00:00:00+00:00',
      },
    ]);
  });
});
