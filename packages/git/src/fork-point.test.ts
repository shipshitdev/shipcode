import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveForkPointSha } from './fork-point';

const { mockRaw, mockSimpleGit } = vi.hoisted(() => ({
  mockRaw: vi.fn(),
  mockSimpleGit: vi.fn(),
}));

vi.mock('simple-git', () => ({ simpleGit: mockSimpleGit }));

/** Resolve only the listed refs; every other rev-parse fails like real git. */
function onlyRefsExist(refs: Record<string, string>) {
  mockRaw.mockImplementation(async (args: string[]) => {
    const target = args[args.length - 1].replace('^{commit}', '');
    const sha = refs[target];
    if (!sha) throw new Error(`fatal: Needed a single revision: ${target}`);
    return `${sha}\n`;
  });
}

beforeEach(() => {
  mockRaw.mockReset();
  mockSimpleGit.mockReset();
  mockSimpleGit.mockReturnValue({ raw: mockRaw, env: vi.fn() });
});

describe('resolveForkPointSha', () => {
  it('prefers the local base branch when it exists', async () => {
    onlyRefsExist({ master: 'local-sha', 'origin/master': 'remote-sha' });

    await expect(resolveForkPointSha('/repo', 'master')).resolves.toBe('local-sha');

    expect(mockSimpleGit).toHaveBeenCalledWith('/repo');
    expect(mockRaw).toHaveBeenCalledTimes(1);
    expect(mockRaw).toHaveBeenCalledWith(['rev-parse', '--verify', 'master^{commit}']);
  });

  it('falls back to origin/<base> for a clone with no local trunk', async () => {
    onlyRefsExist({ 'origin/master': 'remote-sha' });

    await expect(resolveForkPointSha('/repo', 'master')).resolves.toBe('remote-sha');

    expect(mockRaw).toHaveBeenNthCalledWith(1, ['rev-parse', '--verify', 'master^{commit}']);
    expect(mockRaw).toHaveBeenNthCalledWith(2, ['rev-parse', '--verify', 'origin/master^{commit}']);
  });

  it('uses an already remote-qualified base exactly once', async () => {
    onlyRefsExist({ 'origin/master': 'remote-sha' });

    await expect(resolveForkPointSha('/repo', 'origin/master')).resolves.toBe('remote-sha');

    expect(mockRaw).toHaveBeenCalledTimes(1);
    expect(mockRaw).toHaveBeenCalledWith(['rev-parse', '--verify', 'origin/master^{commit}']);
  });

  it('returns an empty sha when neither form resolves', async () => {
    onlyRefsExist({});

    await expect(resolveForkPointSha('/repo', 'master')).resolves.toBe('');

    expect(mockRaw).toHaveBeenCalledTimes(2);
  });

  it('skips git entirely for a blank base branch', async () => {
    await expect(resolveForkPointSha('/repo', '  ')).resolves.toBe('');

    expect(mockRaw).not.toHaveBeenCalled();
  });
});
