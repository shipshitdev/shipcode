import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineContext } from '../types';
import { probeWorktreeChanges, resolveWorktreeDiffBase } from './execution-phase-utils';

const { mockRun, mockWithGitLock } = vi.hoisted(() => {
  const mockRun = vi.fn();
  return {
    mockRun,
    // Runs the callback inline with a stubbed runner. Serialization itself is
    // covered by the git-exec unit tests; here we only need the git results.
    mockWithGitLock: vi.fn(
      async (cwd: string, fn: (run: (args: string[]) => Promise<string>) => Promise<unknown>) =>
        fn(async (args: string[]) => String(await mockRun(cwd, args)).trim()),
    ),
  };
});

// Replace the async git transport wholesale — importing the real module would
// pull in simple-git for no benefit, and no real git may run in unit tests.
vi.mock('@shipcode/git', () => ({ withGitLock: mockWithGitLock }));

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
    mockRun.mockReset();
    mockWithGitLock.mockClear();
    vi.restoreAllMocks();
  });

  it("reports 'clean' for a clean worktree with no fork-point diff", async () => {
    mockRun.mockImplementation((_cwd: string, args: string[]) => {
      if (args[0] === 'status') return '';
      if (args[0] === 'rev-parse' && args[2] === 'base^{commit}') return 'base\n';
      if (args[0] === 'diff') return '';
      return '';
    });

    await expect(probeWorktreeChanges(makeContext())).resolves.toBe('clean');
  });

  it('probes under a single lock so the status and the diff share one index view', async () => {
    mockRun.mockResolvedValue('');

    await probeWorktreeChanges(makeContext());

    // Nested locking would self-deadlock: resolveWorktreeDiffBase runs on the
    // lock probeWorktreeChanges already holds.
    expect(mockWithGitLock).toHaveBeenCalledTimes(1);
    expect(mockWithGitLock.mock.calls[0][0]).toBe('/repo-worktree');
  });

  it("reports 'dirty' for an unstaged/uncommitted worktree", async () => {
    mockRun.mockImplementation((_cwd: string, args: string[]) =>
      args[0] === 'status' ? ' M src/a.ts\n' : '',
    );

    await expect(probeWorktreeChanges(makeContext())).resolves.toBe('dirty');
  });

  it("reports 'dirty' when only the fork-point diff shows changes", async () => {
    mockRun.mockImplementation((_cwd: string, args: string[]) => {
      if (args[0] === 'status') return '';
      if (args[0] === 'rev-parse' && args[2] === 'base^{commit}') return 'base\n';
      if (args[0] === 'diff') return 'src/a.ts\n';
      return '';
    });

    await expect(probeWorktreeChanges(makeContext())).resolves.toBe('dirty');
  });

  it("reports 'unknown' when the diff against a resolved base is a bad revision", async () => {
    // Simulates a rebased/pruned base: `git status` is clean and the base SHA
    // resolves, but `git diff <base>..HEAD` fails with `fatal: bad revision`
    // because the SHA was pruned. This must NOT be reported as confirmed-clean —
    // real changes may sit committed in the worktree, invisible without a base.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockRun.mockImplementation((_cwd: string, args: string[]) => {
      if (args[0] === 'status') return '';
      if (args[0] === 'rev-parse' && args[2] === 'base^{commit}') return 'base\n';
      if (args[0] === 'diff') throw new Error("fatal: bad revision 'base..HEAD'");
      return '';
    });

    await expect(probeWorktreeChanges(makeContext())).resolves.toBe('unknown');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[pipeline] worktree change probe failed'),
    );
  });

  it("reports 'unknown' when a rejected git promise escapes the probe", async () => {
    // Async conversion moved failures from a synchronous throw to a rejected
    // promise — the catch must still swallow them and report 'unknown'.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockRun.mockRejectedValue(
      new Error('git unavailable\nfull stack should stay out of renderer-sized logs'),
    );

    await expect(probeWorktreeChanges(makeContext())).resolves.toBe('unknown');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[pipeline] worktree change probe failed'),
    );
    // Error is clamped to the first line — full stack never reaches renderer logs.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('git unavailable'));
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('full stack'));
  });
});

describe('resolveWorktreeDiffBase', () => {
  beforeEach(() => {
    mockRun.mockReset();
  });

  it('returns the verified fork-point SHA when it resolves', async () => {
    mockRun.mockImplementation((_cwd: string, args: string[]) =>
      args[0] === 'rev-parse' && args[1] === '--verify' ? 'base\n' : '',
    );

    await expect(resolveWorktreeDiffBase(makeContext({ forkPointSha: 'base' }))).resolves.toBe(
      'base',
    );
  });

  it('falls back to the branch merge-base when the fork point is missing', async () => {
    // No fork point → skip verify; the first merge-base candidate resolves.
    mockRun.mockImplementation((_cwd: string, args: string[]) => {
      if (args[0] === 'merge-base') return 'merge-base-sha\n';
      throw new Error('unexpected');
    });

    await expect(
      resolveWorktreeDiffBase(makeContext({ forkPointSha: undefined, baseBranch: 'main' })),
    ).resolves.toBe('merge-base-sha');
  });

  it('falls through rejected candidates rather than surfacing the rejection', async () => {
    // Each fallback used to be guarded against a sync throw; as promises they
    // must still be caught one candidate at a time.
    mockRun.mockImplementation(async (_cwd: string, args: string[]) => {
      if (args[0] === 'merge-base' && args[1] === 'origin/main') return 'origin-merge-base\n';
      throw new Error('fatal: not a valid object name');
    });

    await expect(resolveWorktreeDiffBase(makeContext({ baseBranch: 'main' }))).resolves.toBe(
      'origin-merge-base',
    );
  });

  it('returns null when no fork point, base branch, or HEAD~1 is resolvable', async () => {
    // Every git probe rejects and there is no base branch, so the final HEAD~1
    // fallback also fails — the diff base is genuinely unknown.
    mockRun.mockRejectedValue(new Error('fatal: ambiguous argument'));

    await expect(
      resolveWorktreeDiffBase(makeContext({ forkPointSha: undefined, baseBranch: undefined })),
    ).resolves.toBeNull();
  });
});

describe('execute-path git transport', () => {
  it('performs no synchronous git', () => {
    // Sync git subprocesses freeze the Electron main event loop for the whole
    // subprocess — `git add -A` on a large worktree is not fast — stalling the
    // UI, IPC, and the pipeline heartbeat. These helpers run once per node on
    // the execute path and again per fan-out worker.
    const source = readFileSync(
      fileURLToPath(new URL('./execution-phase-utils.ts', import.meta.url)),
      'utf-8',
    );
    expect(source).not.toContain('execFileSync');
    expect(source).not.toContain('execSync');
    expect(source).not.toContain('child_process');
  });
});
