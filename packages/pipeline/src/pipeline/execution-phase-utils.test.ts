import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineContext } from '../types';
import { worktreeHasChanges } from './execution-phase-utils';

const { mockExecFileSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFileSync: mockExecFileSync,
  };
});

function makeContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    threadId: 'thread-1',
    projectPath: '/repo',
    worktreePath: '/repo-worktree',
    forkPointSha: 'base',
    baseBranch: 'main',
    ...overrides,
  } as PipelineContext;
}

describe('worktreeHasChanges', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
    vi.restoreAllMocks();
  });

  it('returns false for a clean worktree with no fork-point diff', () => {
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'status') return '';
      if (args[0] === 'rev-parse' && args[2] === 'base^{commit}') return 'base\n';
      if (args[0] === 'diff') return '';
      return '';
    });

    expect(worktreeHasChanges(makeContext())).toBe(false);
  });

  it('returns true for a dirty worktree', () => {
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'status') return ' M src/a.ts\n';
      return '';
    });

    expect(worktreeHasChanges(makeContext())).toBe(true);
  });

  it('logs probe failures and falls back to no confirmed changes', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockExecFileSync.mockImplementation(() => {
      throw new Error('git unavailable\nfull stack should stay out of renderer-sized logs');
    });

    expect(worktreeHasChanges(makeContext())).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[pipeline] worktree change probe failed; treating as no confirmed changes',
      ),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('git unavailable'));
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('full stack'));
  });
});
