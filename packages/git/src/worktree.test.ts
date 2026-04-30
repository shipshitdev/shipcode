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
    vi.clearAllMocks();
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
});
