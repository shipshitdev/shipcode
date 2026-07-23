import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAssertRegistered = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@shipcode/git', () => ({
  WorktreeManager: class {
    assertRegistered = mockAssertRegistered;
  },
}));

import { assertPersistedWorktreeTarget } from './worktree-target-guard';

describe('assertPersistedWorktreeTarget', () => {
  const persisted = {
    id: 'thread-1',
    worktreePath: '/safe/worktree',
    worktreeBranch: 'ship/42',
  };
  const deps = {
    threads: { getById: vi.fn(() => persisted) },
    settings: { get: vi.fn(() => ({ worktreeRoot: '/new/root', worktreeBranchFormat: null })) },
  };

  beforeEach(() => {
    mockAssertRegistered.mockClear();
    deps.threads.getById.mockReturnValue(persisted);
  });

  it('validates the exact persisted path and branch despite a changed root', async () => {
    await expect(
      assertPersistedWorktreeTarget(deps as never, {
        threadId: 'thread-1',
        projectPath: '/repo',
        worktreePath: '/safe/worktree',
      }),
    ).resolves.toBeUndefined();
    expect(mockAssertRegistered).toHaveBeenCalledWith('/safe/worktree', 'ship/42');
  });

  it('rejects a context path that differs from the persisted target', async () => {
    await expect(
      assertPersistedWorktreeTarget(deps as never, {
        threadId: 'thread-1',
        projectPath: '/repo',
        worktreePath: '/other/worktree',
      }),
    ).rejects.toThrow(/persisted target/);
    expect(mockAssertRegistered).not.toHaveBeenCalled();
  });
});
