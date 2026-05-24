import type { SpawnSyncReturns } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

import {
  __resetForTests,
  __TEST_INTERNALS,
  fixMainProcessPath,
  type SpawnSyncFn,
} from './path-fix';

const SENTINEL = __TEST_INTERNALS.SENTINEL;
const originalPlatform = process.platform;
const originalPath = process.env.PATH;
const originalShell = process.env.SHELL;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

function okStdout(p: string): string {
  return `${SENTINEL}${p}${SENTINEL}\n`;
}

function makeSpawn(value: Partial<SpawnSyncReturns<string>>): SpawnSyncFn {
  return vi.fn().mockReturnValue({
    status: 0,
    stdout: '',
    stderr: '',
    pid: 1,
    output: [],
    signal: null,
    ...value,
  }) as unknown as SpawnSyncFn;
}

describe('fixMainProcessPath', () => {
  beforeEach(() => {
    __resetForTests();
    process.env.PATH = '/usr/bin:/bin';
    process.env.SHELL = '/bin/zsh';
    setPlatform('darwin');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setPlatform(originalPlatform);
    process.env.PATH = originalPath;
    process.env.SHELL = originalShell;
  });

  it('prepends login-shell PATH entries onto process.env.PATH', () => {
    const spawn = makeSpawn({
      stdout: okStdout('/opt/homebrew/bin:/Users/x/.bun/bin:/usr/bin:/bin'),
    });
    const result = fixMainProcessPath({ isPackaged: true, spawnSyncImpl: spawn });
    expect(result.applied).toBe(true);
    expect(result.reason).toBe('ok');
    expect(process.env.PATH).toBe('/opt/homebrew/bin:/Users/x/.bun/bin:/usr/bin:/bin');
    expect(spawn).toHaveBeenCalledWith(
      '/bin/zsh',
      ['-ilc', expect.stringContaining(SENTINEL)],
      expect.objectContaining({ timeout: 5_000 }),
    );
  });

  it('is idempotent — second call without force is a no-op', () => {
    const spawn = makeSpawn({ stdout: okStdout('/opt/homebrew/bin:/usr/bin') });
    fixMainProcessPath({ isPackaged: true, spawnSyncImpl: spawn });
    const second = fixMainProcessPath({ isPackaged: true, spawnSyncImpl: spawn });
    expect(second.applied).toBe(false);
    expect(second.reason).toBe('already_applied');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('skips on Windows', () => {
    setPlatform('win32');
    const spawn = makeSpawn({});
    const result = fixMainProcessPath({ isPackaged: true, spawnSyncImpl: spawn });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('not_supported_platform');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('skips when not packaged unless forced', () => {
    const spawn = makeSpawn({});
    const result = fixMainProcessPath({ isPackaged: false, spawnSyncImpl: spawn });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('not_packaged');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('reports shell_failed when spawn errors', () => {
    const spawn = makeSpawn({ status: 1, error: new Error('shell crashed'), stdout: '' });
    const result = fixMainProcessPath({ isPackaged: true, spawnSyncImpl: spawn });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('shell_failed');
    expect(result.shellError).toContain('shell crashed');
  });

  it('reports shell_failed when sentinel not found in stdout', () => {
    const spawn = makeSpawn({ status: 0, stdout: 'malformed output without sentinels' });
    const result = fixMainProcessPath({ isPackaged: true, spawnSyncImpl: spawn });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('shell_failed');
  });

  it('deduplicates entries that already exist in process.env.PATH', () => {
    process.env.PATH = '/usr/bin:/bin:/opt/homebrew/bin';
    const spawn = makeSpawn({ stdout: okStdout('/opt/homebrew/bin:/Users/x/.bun/bin') });
    fixMainProcessPath({ isPackaged: true, spawnSyncImpl: spawn });
    expect(process.env.PATH).toBe('/opt/homebrew/bin:/Users/x/.bun/bin:/usr/bin:/bin');
  });

  it('honours custom shell override', () => {
    const spawn = makeSpawn({ stdout: okStdout('/custom/bin') });
    fixMainProcessPath({ isPackaged: true, shell: '/bin/bash', spawnSyncImpl: spawn });
    expect(spawn).toHaveBeenCalledWith('/bin/bash', expect.any(Array), expect.any(Object));
  });
});
