import os from 'node:os';
import path from 'node:path';
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
  const defaultUntitledIssueWorktreePath = path.join(
    os.homedir(),
    '.shipcode/worktrees/project-9a1fd1/42',
  );

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

  it('formats untitled issue branches and paths through default options', () => {
    const manager = new WorktreeManager('/repo/project');

    expect(manager.getBranchName(42, undefined as never)).toBe('ship/42');
    expect(manager.getWorktreePath(42, undefined as never)).toBe(defaultUntitledIssueWorktreePath);
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

  it('creates untitled issue worktrees under the default worktree root', async () => {
    gitMock.raw
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(new Error('branch not found'))
      .mockResolvedValueOnce('');
    const manager = new WorktreeManager('/repo/project');

    await expect(manager.create(42, undefined as never, 'main')).resolves.toEqual({
      worktreePath: defaultUntitledIssueWorktreePath,
      branch: 'ship/42',
    });
  });

  it('creates issue worktrees from the resolved default branch when no base is passed', async () => {
    gitMock.raw
      .mockResolvedValueOnce('origin/main\n')
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(new Error('branch not found'))
      .mockResolvedValueOnce('');
    const manager = new WorktreeManager('/repo/project', {
      worktreeRoot: '/tmp/shipcode-worktrees',
    });

    await expect(manager.create(42, 'Fix OpenRouter')).resolves.toEqual({
      worktreePath: '/tmp/shipcode-worktrees/project-9a1fd1/42-fix-openrouter',
      branch: 'ship/42-fix-openrouter',
    });
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

  it('does not treat an explicit non-issue title as a base ref when baseBranch is undefined', async () => {
    gitMock.raw
      .mockResolvedValueOnce('origin/main\n')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('');
    const manager = new WorktreeManager('/repo/project', {
      worktreeRoot: '/tmp/shipcode-worktrees',
    });

    await expect(
      manager.create('XqHCBbk29QnO6wzPlg9_Z', '[Auto] clean', undefined),
    ).resolves.toEqual({
      worktreePath: '/tmp/shipcode-worktrees/project-9a1fd1/auto-clean',
      branch: 'shipcode/auto-clean',
    });

    expect(gitMock.raw).toHaveBeenLastCalledWith([
      '-c',
      'branch.autoSetupMerge=false',
      '-c',
      'push.autoSetupRemote=false',
      'worktree',
      'add',
      '-b',
      'shipcode/auto-clean',
      '/tmp/shipcode-worktrees/project-9a1fd1/auto-clean',
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

  it('continues suffixing issue branches until it finds a free branch name', async () => {
    gitMock.raw
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(new Error('branch not found'))
      .mockResolvedValueOnce('');
    const manager = new WorktreeManager('/repo/project', {
      worktreeRoot: '/tmp/shipcode-worktrees',
    });

    await expect(manager.create(42, 'Fix OpenRouter', 'main')).resolves.toEqual({
      worktreePath: '/tmp/shipcode-worktrees/project-9a1fd1/42-fix-openrouter-3',
      branch: 'ship/42-fix-openrouter-3',
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

  it('retries string-form concurrent branch collisions', async () => {
    gitMock.raw
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(new Error('branch not found'))
      .mockRejectedValueOnce('branch already exists')
      .mockResolvedValueOnce('');
    const manager = new WorktreeManager('/repo/project', {
      worktreeRoot: '/tmp/shipcode-worktrees',
    });

    await expect(manager.create(42, 'Fix OpenRouter', 'main')).resolves.toEqual({
      worktreePath: '/tmp/shipcode-worktrees/project-9a1fd1/42-fix-openrouter-2',
      branch: 'ship/42-fix-openrouter-2',
    });
  });

  it('retries untitled issue branch collisions', async () => {
    gitMock.raw
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(new Error('branch not found'))
      .mockRejectedValueOnce('branch already exists')
      .mockResolvedValueOnce('');
    const manager = new WorktreeManager('/repo/project', {
      worktreeRoot: '/tmp/shipcode-worktrees',
    });

    await expect(manager.create(42, undefined as never, 'main')).resolves.toEqual({
      worktreePath: '/tmp/shipcode-worktrees/project-9a1fd1/42-2',
      branch: 'ship/42-2',
    });
  });

  it('retries non-issue branch collisions using title and id directory fallbacks', async () => {
    gitMock.raw
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce('branch already exists')
      .mockRejectedValueOnce('branch already exists')
      .mockResolvedValueOnce('');
    const manager = new WorktreeManager('/repo/project', {
      worktreeRoot: '/tmp/shipcode-worktrees',
    });

    await expect(manager.create('thread-1', '!!!', 'main')).resolves.toEqual({
      worktreePath: '/tmp/shipcode-worktrees/project-9a1fd1/thread-1-3',
      branch: 'shipcode/thread-1-3',
    });
  });

  it('retries non-issue branch collisions without an effective thread title', async () => {
    gitMock.raw
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce('branch already exists')
      .mockResolvedValueOnce('');
    const manager = new WorktreeManager('/repo/project', {
      worktreeRoot: '/tmp/shipcode-worktrees',
    });

    await expect(manager.create('thread-2', '', 'main')).resolves.toEqual({
      worktreePath: '/tmp/shipcode-worktrees/project-9a1fd1/thread-2-3',
      branch: 'shipcode/thread-2-3',
    });
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

  it('treats string-form already-removed cleanup errors as success', async () => {
    gitMock.raw.mockRejectedValueOnce('no such file');
    gitMock.deleteLocalBranch.mockRejectedValueOnce('does not exist');

    const manager = new WorktreeManager('/repo/project');

    await expect(manager.remove('/tmp/worktree', 'ship/42')).resolves.toEqual({
      worktreeRemoved: true,
      branchDeleted: true,
    });
  });

  it('removes existing worktrees and branches successfully', async () => {
    gitMock.raw.mockResolvedValueOnce('');
    gitMock.deleteLocalBranch.mockResolvedValueOnce(undefined);

    const manager = new WorktreeManager('/repo/project');

    await expect(manager.remove('/tmp/worktree', 'ship/42')).resolves.toEqual({
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
