import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildScopedGitEnv, runGit, runGitUnlocked, withGitLock } from './git-exec';

const { mockRaw, mockEnv, mockSimpleGit } = vi.hoisted(() => {
  const mockRaw = vi.fn();
  const mockEnv = vi.fn();
  const mockSimpleGit = vi.fn();
  return { mockRaw, mockEnv, mockSimpleGit };
});

vi.mock('simple-git', () => ({ simpleGit: mockSimpleGit }));

beforeEach(() => {
  mockRaw.mockReset();
  mockEnv.mockReset();
  mockSimpleGit.mockReset();
  mockRaw.mockResolvedValue('');
  const client = { raw: mockRaw, env: mockEnv };
  mockEnv.mockReturnValue(client);
  mockSimpleGit.mockReturnValue(client);
});

describe('runGitUnlocked', () => {
  it('returns trimmed stdout and leaves the ambient env untouched without overrides', async () => {
    mockRaw.mockResolvedValue('  abc123\n');

    await expect(runGitUnlocked('/repo', ['rev-parse', 'HEAD'])).resolves.toBe('abc123');

    expect(mockSimpleGit).toHaveBeenCalledWith('/repo');
    // simple-git's unsafe-env guard only scans an explicit .env() object, so
    // skipping it preserves the ambient environment exactly.
    expect(mockEnv).not.toHaveBeenCalled();
    expect(mockRaw).toHaveBeenCalledWith(['rev-parse', 'HEAD']);
  });

  it('scopes the child environment when overrides are supplied', async () => {
    await runGitUnlocked('/repo', ['write-tree'], { GIT_INDEX_FILE: '/tmp/i' });

    const passed = mockEnv.mock.calls[0][0] as Record<string, string>;
    expect(passed.GIT_INDEX_FILE).toBe('/tmp/i');
    expect(passed.PATH).toBe(process.env.PATH);
  });

  it('rejects rather than throwing synchronously when git fails', async () => {
    mockRaw.mockRejectedValue(new Error('fatal: not a git repository'));

    await expect(runGitUnlocked('/repo', ['status'])).rejects.toThrow('not a git repository');
  });
});

describe('buildScopedGitEnv', () => {
  it("drops the keys simple-git's unsafe-operations guard rejects", () => {
    vi.stubEnv('GIT_SSH_COMMAND', 'ssh -o Foo=bar');
    vi.stubEnv('PAGER', 'less');

    const env = buildScopedGitEnv({ GIT_AUTHOR_NAME: 'ShipCode' });

    expect(env.GIT_SSH_COMMAND).toBeUndefined();
    expect(env.PAGER).toBeUndefined();
    expect(env.GIT_AUTHOR_NAME).toBe('ShipCode');
    vi.unstubAllEnvs();
  });
});

describe('withGitLock', () => {
  it('serializes overlapping sequences on the same working tree', async () => {
    // The regression this guards: awaiting between `add -A` and `commit` lets a
    // second caller stage into the same index mid-sequence. execFileSync made
    // that impossible for free; the lock has to give it back.
    const order: string[] = [];
    mockRaw.mockImplementation(async (args: string[]) => {
      order.push(args[0]);
      await new Promise((resolve) => setTimeout(resolve, 1));
      return '';
    });

    const sequence = (tag: string) =>
      withGitLock('/repo', async (run) => {
        await run([`${tag}-add`]);
        await run([`${tag}-commit`]);
      });

    await Promise.all([sequence('a'), sequence('b')]);

    expect(order).toEqual(['a-add', 'a-commit', 'b-add', 'b-commit']);
  });

  it('runs different working trees in parallel', async () => {
    // Fan-out workers each own a distinct worktree (and therefore a distinct
    // index), so they must not queue behind one another.
    let active = 0;
    let peak = 0;
    mockRaw.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return '';
    });

    await Promise.all([
      withGitLock('/worker-1', (run) => run(['status'])),
      withGitLock('/worker-2', (run) => run(['status'])),
    ]);

    expect(peak).toBe(2);
  });

  it('keys the lock by resolved path so path spellings cannot alias apart', async () => {
    const order: string[] = [];
    mockRaw.mockImplementation(async (args: string[]) => {
      order.push(args[0]);
      await new Promise((resolve) => setTimeout(resolve, 1));
      return '';
    });

    await Promise.all([
      withGitLock('/repo/worktree', async (run) => {
        await run(['first-add']);
        await run(['first-commit']);
      }),
      withGitLock('/repo/nested/../worktree', (run) => run(['second'])),
    ]);

    expect(order).toEqual(['first-add', 'first-commit', 'second']);
  });

  it('does not let a rejected sequence poison or stall the queue', async () => {
    const failing = withGitLock('/repo', async () => {
      throw new Error('boom');
    });

    await expect(failing).rejects.toThrow('boom');

    mockRaw.mockResolvedValue('ok\n');
    await expect(withGitLock('/repo', (run) => run(['status']))).resolves.toBe('ok');
  });

  it('releases the lock even when the callback rejects mid-sequence', async () => {
    mockRaw.mockRejectedValueOnce(new Error('index.lock exists'));

    await expect(
      withGitLock('/repo', async (run) => {
        await run(['add']);
        await run(['commit']);
      }),
    ).rejects.toThrow('index.lock exists');

    expect(mockRaw).toHaveBeenCalledTimes(1); // the commit never ran
    mockRaw.mockResolvedValue('after\n');
    await expect(runGit('/repo', ['status'])).resolves.toBe('after');
  });
});
