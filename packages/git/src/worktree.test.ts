import { beforeEach, describe, expect, it, vi } from 'vitest';

const gitMock = {
  raw: vi.fn(),
  deleteLocalBranch: vi.fn(),
  checkout: vi.fn(),
  merge: vi.fn(),
  commit: vi.fn(),
  branchLocal: vi.fn(),
};

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => gitMock),
}));

import { WorktreeManager } from './worktree';

describe('WorktreeManager', () => {
  beforeEach(() => {
    Object.values(gitMock).forEach((mock) => {
      mock.mockReset();
    });
  });

  it('formats issue-based branch names and worktree paths from the current settings', () => {
    const manager = new WorktreeManager('/repo/project', {
      worktreeRoot: '/tmp/shipcode-worktrees',
      branchFormat: 'feat/{id}-{slug}',
    });

    expect(manager.getBranchName(42, 'Fix OpenRouter Tier 1!')).toBe(
      'feat/42-fix-openrouter-tier-1',
    );
    expect(manager.getWorktreePath(42, 'Fix OpenRouter Tier 1!')).toBe(
      '/tmp/shipcode-worktrees/project-9a1fd1/42-fix-openrouter-tier-1',
    );
  });

  it('formats manual thread branches and paths from title slugs when available', () => {
    const manager = new WorktreeManager('/repo/project', {
      worktreeRoot: '/tmp/shipcode-worktrees',
    });

    expect(manager.getBranchName('thread-1', 'Tighten Quick Flow!')).toBe(
      'shipcode/tighten-quick-flow',
    );
    expect(manager.getWorktreePath('thread-1', 'Tighten Quick Flow!')).toBe(
      '/tmp/shipcode-worktrees/project-9a1fd1/tighten-quick-flow',
    );
    expect(manager.getBranchName('thread-1')).toBe('shipcode/thread-1');
    expect(manager.getWorktreePath('thread-1')).toBe(
      '/tmp/shipcode-worktrees/project-9a1fd1/thread-1',
    );
    expect(manager.getBranchName(42, '')).toBe('ship/42');
    expect(manager.getWorktreePath(42, '')).toBe('/tmp/shipcode-worktrees/project-9a1fd1/42');
  });

  it('parses git worktree list output and keeps only ShipCode-managed branches', async () => {
    gitMock.raw.mockResolvedValueOnce(`worktree /repo/project
HEAD abc123
branch refs/heads/main

worktree /tmp/shipcode-worktrees/42-fix-openrouter
HEAD def456
branch refs/heads/ship/42-fix-openrouter

worktree /tmp/shipcode-worktrees/thread-1
HEAD ghi789
branch refs/heads/shipcode/thread-1

worktree /tmp/other
HEAD zyx987
branch refs/heads/feature/not-ours
`);

    const manager = new WorktreeManager('/repo/project');

    await expect(manager.list()).resolves.toEqual([
      {
        path: '/tmp/shipcode-worktrees/42-fix-openrouter',
        branch: 'ship/42-fix-openrouter',
      },
      {
        path: '/tmp/shipcode-worktrees/thread-1',
        branch: 'shipcode/thread-1',
      },
    ]);
  });

  it('creates worktrees without branch auto-config writes', async () => {
    gitMock.raw
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(new Error('branch not found'))
      .mockResolvedValueOnce('');
    const manager = new WorktreeManager('/repo/project', {
      worktreeRoot: '/tmp/shipcode-worktrees',
    });

    await expect(manager.create(42, 'Fix OpenRouter Tier 1!', 'main')).resolves.toEqual({
      worktreePath: '/tmp/shipcode-worktrees/project-9a1fd1/42-fix-openrouter-tier-1',
      branch: 'ship/42-fix-openrouter-tier-1',
    });

    expect(gitMock.raw).toHaveBeenNthCalledWith(1, ['worktree', 'prune']);
    expect(gitMock.raw).toHaveBeenNthCalledWith(3, [
      '-c',
      'branch.autoSetupMerge=false',
      '-c',
      'push.autoSetupRemote=false',
      'worktree',
      'add',
      '-b',
      'ship/42-fix-openrouter-tier-1',
      '/tmp/shipcode-worktrees/project-9a1fd1/42-fix-openrouter-tier-1',
      'main',
    ]);
  });

  it('creates manual worktrees from the resolved default branch', async () => {
    gitMock.raw
      .mockResolvedValueOnce('origin/develop\n')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('');
    const manager = new WorktreeManager('/repo/project', {
      worktreeRoot: '/tmp/shipcode-worktrees',
    });

    await expect(manager.create('thread-1')).resolves.toEqual({
      worktreePath: '/tmp/shipcode-worktrees/project-9a1fd1/thread-1',
      branch: 'shipcode/thread-1',
    });

    expect(gitMock.raw).toHaveBeenLastCalledWith([
      '-c',
      'branch.autoSetupMerge=false',
      '-c',
      'push.autoSetupRemote=false',
      'worktree',
      'add',
      '-b',
      'shipcode/thread-1',
      '/tmp/shipcode-worktrees/project-9a1fd1/thread-1',
      'develop',
    ]);
  });

  it('creates non-issue worktrees from a short title slug', async () => {
    gitMock.raw.mockResolvedValueOnce('').mockResolvedValueOnce('');
    const manager = new WorktreeManager('/repo/project', {
      worktreeRoot: '/tmp/shipcode-worktrees',
    });

    await expect(
      manager.create('YS_jeq0nszO3vTJZRWSeg', 'Tighten Quick Flow', 'main'),
    ).resolves.toEqual({
      worktreePath: '/tmp/shipcode-worktrees/project-9a1fd1/tighten-quick-flow',
      branch: 'shipcode/tighten-quick-flow',
    });

    expect(gitMock.raw).toHaveBeenLastCalledWith([
      '-c',
      'branch.autoSetupMerge=false',
      '-c',
      'push.autoSetupRemote=false',
      'worktree',
      'add',
      '-b',
      'shipcode/tighten-quick-flow',
      '/tmp/shipcode-worktrees/project-9a1fd1/tighten-quick-flow',
      'main',
    ]);
  });

  it('suffixes issue branch and directory names when an existing branch collides', async () => {
    gitMock.raw
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(new Error('branch not found'))
      .mockResolvedValueOnce('');
    const manager = new WorktreeManager('/repo/project', {
      worktreeRoot: '/tmp/shipcode-worktrees',
    });

    await expect(manager.create(42, 'Fix OpenRouter', 'main')).resolves.toEqual({
      worktreePath: '/tmp/shipcode-worktrees/project-9a1fd1/42-fix-openrouter-2',
      branch: 'ship/42-fix-openrouter-2',
    });
  });

  it('retries concurrent branch collisions and gives up after the retry limit', async () => {
    gitMock.raw
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(new Error('branch not found'))
      .mockRejectedValueOnce(new Error('branch already exists'))
      .mockRejectedValueOnce(new Error('is already checked out'))
      .mockResolvedValueOnce('');
    const manager = new WorktreeManager('/repo/project', {
      worktreeRoot: '/tmp/shipcode-worktrees',
    });

    await expect(manager.create(42, 'Fix OpenRouter', 'main')).resolves.toEqual({
      worktreePath: '/tmp/shipcode-worktrees/project-9a1fd1/42-fix-openrouter-3',
      branch: 'ship/42-fix-openrouter-3',
    });

    gitMock.raw
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(new Error('branch not found'))
      .mockRejectedValue(new Error('already exists'));

    await expect(manager.create(43, 'Retry forever', 'main')).rejects.toThrow('already exists');
  });

  it('treats already-removed worktrees and branches as successful cleanup', async () => {
    gitMock.raw.mockRejectedValueOnce(new Error('path is not a working tree'));
    gitMock.deleteLocalBranch.mockRejectedValueOnce(new Error('branch not found'));

    const manager = new WorktreeManager('/repo/project');

    await expect(
      manager.remove('/tmp/shipcode-worktrees/42-fix-openrouter', 'ship/42-fix-openrouter'),
    ).resolves.toEqual({
      worktreeRemoved: true,
      branchDeleted: true,
    });
  });

  it('reports worktree remove and branch delete failures separately', async () => {
    const manager = new WorktreeManager('/repo/project');

    gitMock.raw.mockRejectedValueOnce(new Error('permission denied'));
    await expect(manager.remove('/tmp/worktree', 'ship/42')).resolves.toEqual({
      worktreeRemoved: false,
      branchDeleted: false,
      error: 'worktree remove: permission denied',
    });

    gitMock.raw.mockResolvedValueOnce('');
    gitMock.deleteLocalBranch.mockRejectedValueOnce(new Error('branch checked out'));
    await expect(manager.remove('/tmp/worktree', 'ship/42')).resolves.toEqual({
      worktreeRemoved: true,
      branchDeleted: false,
      error: 'branch delete: branch checked out',
    });
  });

  it('repairs concrete worktree paths through git worktree repair', async () => {
    const manager = new WorktreeManager('/repo/project');

    await manager.repair(['/tmp/worktree-a', '/tmp/worktree-b']);

    expect(gitMock.raw).toHaveBeenCalledWith([
      'worktree',
      'repair',
      '/tmp/worktree-a',
      '/tmp/worktree-b',
    ]);
  });

  it('skips repair when no paths are provided', async () => {
    const manager = new WorktreeManager('/repo/project');

    await manager.repair([]);

    expect(gitMock.raw).not.toHaveBeenCalled();
  });

  it('prunes stale worktree metadata through git worktree prune', async () => {
    const manager = new WorktreeManager('/repo/project');

    await manager.prune();

    expect(gitMock.raw).toHaveBeenCalledWith(['worktree', 'prune']);
  });

  it('moves concrete worktree paths through git worktree move', async () => {
    const manager = new WorktreeManager('/repo/project');

    await manager.move('/tmp/old-worktree', '/tmp/new-worktree');

    expect(gitMock.raw).toHaveBeenCalledWith([
      'worktree',
      'move',
      '/tmp/old-worktree',
      '/tmp/new-worktree',
    ]);
  });

  it('uses squash merge flow when requested', async () => {
    const manager = new WorktreeManager('/repo/project');

    await manager.merge('ship/42-fix-openrouter', 'develop', 'squash');

    expect(gitMock.checkout).toHaveBeenCalledWith('develop');
    expect(gitMock.raw).toHaveBeenCalledWith(['merge', '--squash', 'ship/42-fix-openrouter']);
    expect(gitMock.commit).toHaveBeenCalledWith('feat: merge ship/42-fix-openrouter (squashed)');
  });

  it('uses normal merge and default-branch fallbacks', async () => {
    const manager = new WorktreeManager('/repo/project');

    gitMock.raw.mockRejectedValueOnce(new Error('origin head unavailable'));
    gitMock.branchLocal.mockResolvedValueOnce({
      current: 'release',
      all: ['main', 'master'],
    });
    await manager.merge('ship/42-fix-openrouter');
    expect(gitMock.checkout).toHaveBeenCalledWith('release');
    expect(gitMock.merge).toHaveBeenCalledWith(['ship/42-fix-openrouter', '--no-ff']);

    gitMock.raw.mockRejectedValueOnce(new Error('origin head unavailable'));
    gitMock.branchLocal.mockResolvedValueOnce({
      current: '',
      all: ['main'],
    });
    await manager.merge('ship/43-fix-openrouter');
    expect(gitMock.checkout).toHaveBeenLastCalledWith('main');

    gitMock.raw.mockRejectedValueOnce(new Error('origin head unavailable'));
    gitMock.branchLocal.mockResolvedValueOnce({
      current: '',
      all: ['master'],
    });
    await manager.merge('ship/44-fix-openrouter');
    expect(gitMock.checkout).toHaveBeenLastCalledWith('master');

    gitMock.raw.mockRejectedValueOnce(new Error('origin head unavailable'));
    gitMock.branchLocal.mockResolvedValueOnce({
      current: '',
      all: [],
    });
    await manager.merge('ship/45-fix-openrouter');
    expect(gitMock.checkout).toHaveBeenLastCalledWith('main');
  });
});
