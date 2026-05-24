import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from './types';

const pathGuardState = vi.hoisted(() => ({
  error: new Error('unexpected guard failure'),
}));

vi.mock('./path-guard', () => ({
  PathGuardError: class PathGuardError extends Error {},
  assertPathInWorktree: vi.fn(async () => {
    throw pathGuardState.error;
  }),
}));

import { writeTool } from './write';

describe('writeTool guarded failures', () => {
  it('rethrows unexpected path guard failures', async () => {
    const ctx: ToolContext = {
      worktreePath: '/tmp/worktree',
      signal: new AbortController().signal,
      threadId: 'thread-1',
    };

    await expect(writeTool.execute({ path: 'file.txt', content: 'x' }, ctx)).rejects.toThrow(
      'unexpected guard failure',
    );
  });
});
