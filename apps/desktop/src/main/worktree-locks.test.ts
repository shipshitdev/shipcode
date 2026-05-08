import { describe, expect, it } from 'vitest';
import { isWorktreeLocked, withWorktreeLock } from './worktree-locks';

describe('worktree-locks', () => {
  it('marks a worktree as locked while work is in flight and releases it after success', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });

    const result = withWorktreeLock('/tmp/worktree-a', async () => {
      expect(isWorktreeLocked('/tmp/worktree-a')).toBe(false);
      await pending;
      return 'done';
    });

    expect(isWorktreeLocked('/tmp/worktree-a')).toBe(true);
    expect(isWorktreeLocked('/tmp/worktree-b')).toBe(false);

    release();
    await expect(result).resolves.toBe('done');
    expect(isWorktreeLocked('/tmp/worktree-a')).toBe(false);
  });

  it('rejects concurrent work for the same worktree and releases the lock after failures', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withWorktreeLock('/tmp/worktree-a', async () => {
      await pending;
      throw new Error('workflow failed');
    });

    await expect(withWorktreeLock('/tmp/worktree-a', async () => 'blocked')).rejects.toThrow(
      'worktree busy: /tmp/worktree-a',
    );
    await expect(withWorktreeLock('/tmp/worktree-b', async () => 'other')).resolves.toBe('other');

    release();
    await expect(first).rejects.toThrow('workflow failed');
    expect(isWorktreeLocked('/tmp/worktree-a')).toBe(false);
    await expect(withWorktreeLock('/tmp/worktree-a', async () => 'retry')).resolves.toBe('retry');
  });
});
