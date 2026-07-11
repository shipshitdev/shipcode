import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineContext } from '../types';
import { probeWorktreeChanges } from './execution-phase-utils';

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

describe('probeWorktreeChanges', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
    vi.restoreAllMocks();
  });

  it("reports 'clean' for a clean worktree with no fork-point diff", () => {
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'status') return '';
      if (args[0] === 'rev-parse' && args[2] === 'base^{commit}') return 'base\n';
      if (args[0] === 'diff') return '';
      return '';
    });

    expect(probeWorktreeChanges(makeContext())).toBe('clean');
  });

  it("reports 'dirty' for an unstaged/uncommitted worktree", () => {
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'status') return ' M src/a.ts\n';
      return '';
    });

    expect(probeWorktreeChanges(makeContext())).toBe('dirty');
  });

  it("reports 'dirty' when only the fork-point diff shows changes", () => {
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'status') return '';
      if (args[0] === 'rev-parse' && args[2] === 'base^{commit}') return 'base\n';
      if (args[0] === 'diff') return 'src/a.ts\n';
      return '';
    });

    expect(probeWorktreeChanges(makeContext())).toBe('dirty');
  });

  it("reports 'unknown' when the diff against a resolved base is a bad revision", () => {
    // Simulates a rebased/pruned base: `git status` is clean and the base SHA
    // resolves, but `git diff <base>..HEAD` fails with `fatal: bad revision`
    // because the SHA was pruned. This must NOT be reported as confirmed-clean —
    // real changes may sit committed in the worktree, invisible without a base.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'status') return '';
      if (args[0] === 'rev-parse' && args[2] === 'base^{commit}') return 'base\n';
      if (args[0] === 'diff') throw new Error("fatal: bad revision 'base..HEAD'");
      return '';
    });

    expect(probeWorktreeChanges(makeContext())).toBe('unknown');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[pipeline] worktree change probe failed'),
    );
  });

  it("reports 'unknown' when a git probe throws ENOENT", () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockExecFileSync.mockImplementation(() => {
      throw new Error('git unavailable\nfull stack should stay out of renderer-sized logs');
    });

    expect(probeWorktreeChanges(makeContext())).toBe('unknown');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[pipeline] worktree change probe failed'),
    );
    // Error is clamped to the first line — full stack never reaches renderer logs.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('git unavailable'));
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('full stack'));
  });
});
