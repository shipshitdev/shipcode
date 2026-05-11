import { afterEach, describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('./health-check', () => ({
  shellExecEnv: () => ({ PATH: '/usr/bin' }),
}));

import { runCliWithStdin } from './cli-stdin-runner';
import { createFakeProc } from './test-fake-proc';

describe('runCliWithStdin', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('pipes stdin and surfaces a short stdout-derived error when stderr is empty', async () => {
    const fake = createFakeProc({ captureStdin: true, kill: true });
    mockSpawn.mockReturnValueOnce(fake.proc);

    const promise = runCliWithStdin({
      cli: 'claude',
      args: ['-p', '--output-format', 'json'],
      input: 'PROMPT',
      cwd: '/repo',
      timeoutMs: 5_000,
    });

    await Promise.resolve();

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      ['-p', '--output-format', 'json'],
      expect.objectContaining({ cwd: '/repo', stdio: ['pipe', 'pipe', 'pipe'] }),
    );
    expect(fake.stdinWrites).toEqual(['PROMPT']);
    expect(fake.isStdinEnded()).toBe(true);

    fake.close(1, {
      stdout:
        '{"type":"result","subtype":"success","is_error":true,"result":"You\\u2019ve hit your limit"}',
    });

    await expect(promise).rejects.toThrow('Claude CLI exited 1: You’ve hit your limit');
  });

  it('resolves stdout on successful exits', async () => {
    const fake = createFakeProc();
    mockSpawn.mockReturnValueOnce(fake.proc);

    const promise = runCliWithStdin({
      cli: 'codex',
      args: ['exec', '--json'],
      input: 'PROMPT',
      cwd: '/repo',
      timeoutMs: 5_000,
    });

    fake.close(0, { stdout: 'done' });

    await expect(promise).resolves.toBe('done');
  });

  it('wraps spawn errors with a clamped first-line message', async () => {
    const fake = createFakeProc();
    mockSpawn.mockReturnValueOnce(fake.proc);

    const promise = runCliWithStdin({
      cli: 'codex',
      args: ['exec'],
      input: 'PROMPT',
      cwd: '/repo',
      timeoutMs: 5_000,
    });

    fake.proc.emit('error', new Error('spawn failed\nprompt should not leak'));

    await expect(promise).rejects.toThrow('Codex CLI spawn failed: spawn failed');
  });

  it('terminates timed-out CLI processes', async () => {
    vi.useFakeTimers();
    const fake = createFakeProc({ kill: true });
    mockSpawn.mockReturnValueOnce(fake.proc);

    const promise = runCliWithStdin({
      cli: 'claude',
      args: ['-p'],
      input: 'PROMPT',
      cwd: '/repo',
      timeoutMs: 250,
    });

    vi.advanceTimersByTime(250);

    await expect(promise).rejects.toThrow('Claude CLI timed out after 250ms');
    expect(fake.proc.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
