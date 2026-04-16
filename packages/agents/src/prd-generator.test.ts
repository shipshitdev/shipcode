import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

import { enhancePrdDraft } from './prd-generator';

function createFakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: (chunk: string) => boolean; end: () => void };
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  const stdinWrites: string[] = [];
  let stdinEnded = false;
  proc.stdin = {
    write: (chunk: string) => {
      stdinWrites.push(chunk);
      return true;
    },
    end: () => {
      stdinEnded = true;
    },
  };
  return {
    proc,
    stdinWrites,
    isStdinEnded: () => stdinEnded,
    close: (code: number, options?: { stdout?: string; stderr?: string }) => {
      if (options?.stdout) proc.stdout.emit('data', options.stdout);
      if (options?.stderr) proc.stderr.emit('data', options.stderr);
      proc.emit('close', code);
    },
  };
}

describe('enhancePrdDraft', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces Claude stdout result when the CLI exits non-zero with empty stderr', async () => {
    const fake = createFakeProc();
    mockSpawn.mockReturnValueOnce(fake.proc);

    const promise = enhancePrdDraft({
      draftBody: '',
      skillContent: 'skill contents',
      cwd: '/repo',
    });

    await Promise.resolve();

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['-p', '--output-format', 'json']),
      expect.objectContaining({ cwd: '/repo', stdio: ['pipe', 'pipe', 'pipe'] }),
    );
    expect(fake.stdinWrites).toHaveLength(1);
    expect(fake.isStdinEnded()).toBe(true);

    fake.close(1, {
      stdout:
        '{"type":"result","subtype":"success","is_error":true,"result":"You\\u2019ve hit your limit \\u00b7 resets 6am (Europe/Malta)"}',
    });

    await expect(promise).rejects.toThrow(
      'Claude CLI exited 1: You’ve hit your limit · resets 6am (Europe/Malta)',
    );
  });
});
