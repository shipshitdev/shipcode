import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

import { MAX_COLLECTED_OUTPUT_CHARS, pipeStdin, runWithStdin } from './spawn-with-stdin';
import { createFakeProc } from './test-fake-proc';

type FakeStdin = EventEmitter & {
  write: (chunk: string) => boolean;
  end: () => void;
  writes: string[];
  ended: boolean;
};

/** `pipeStdin` only touches `on`/`once`/`write`/`end`, so the fake is enough. */
function pipe(stdin: FakeStdin, input: string, options?: Parameters<typeof pipeStdin>[2]) {
  return pipeStdin(stdin as unknown as NodeJS.WritableStream, input, options);
}

function createStdin(options: { backpressure?: boolean; throwOnWrite?: Error } = {}): FakeStdin {
  const stdin = new EventEmitter() as FakeStdin;
  stdin.writes = [];
  stdin.ended = false;
  stdin.write = (chunk: string) => {
    if (options.throwOnWrite) throw options.throwOnWrite;
    stdin.writes.push(chunk);
    return !options.backpressure;
  };
  stdin.end = () => {
    stdin.ended = true;
  };
  return stdin;
}

function runWithStdinOn(
  proc: ReturnType<typeof createFakeProc>['proc'],
  overrides: Partial<Parameters<typeof runWithStdin>[0]> = {},
) {
  mockSpawn.mockReturnValueOnce(proc);
  return runWithStdin({
    command: 'tool',
    args: ['--flag'],
    input: 'PAYLOAD',
    cwd: '/repo',
    formatSpawnError: (err) => new Error(`spawn failed: ${err.message}`),
    formatExitError: ({ code, stderr, stdinError, truncated }) =>
      new Error(
        `exited ${code}: ${stderr.trim()}${stdinError ? ` (stdin write failed: ${stdinError.message})` : ''}${
          truncated ? ' (truncated)' : ''
        }`,
      ),
    ...overrides,
  });
}

describe('pipeStdin', () => {
  it('writes, ends, and reports no error on a healthy pipe', () => {
    const stdin = createStdin();

    const result = pipe(stdin, 'PAYLOAD');

    expect(stdin.writes).toEqual(['PAYLOAD']);
    expect(stdin.ended).toBe(true);
    expect(result.error).toBeNull();
  });

  it('waits for drain before ending when the write is backpressured', () => {
    const stdin = createStdin({ backpressure: true });

    pipe(stdin, 'PAYLOAD');
    expect(stdin.ended).toBe(false);

    stdin.emit('drain');
    expect(stdin.ended).toBe(true);
  });

  it('reports a stream error once instead of leaving it unhandled', () => {
    const stdin = createStdin();
    const onError = vi.fn();

    const result = pipe(stdin, 'PAYLOAD', { onError });

    // No listener here is a fatal unhandled stream error in production.
    expect(() => stdin.emit('error', new Error('EPIPE'))).not.toThrow();
    stdin.emit('error', new Error('second'));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'EPIPE' }));
    expect(result.error?.message).toBe('EPIPE');
  });

  it('folds a synchronous write throw into the same reporting path', () => {
    const stdin = createStdin({ throwOnWrite: new Error('ERR_STREAM_DESTROYED') });
    const onError = vi.fn();

    const result = pipe(stdin, 'PAYLOAD', { onError });

    expect(result.error?.message).toBe('ERR_STREAM_DESTROYED');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(stdin.ended).toBe(false);
  });

  it('leaves stdin open for steering transports', () => {
    const stdin = createStdin();

    pipe(stdin, 'PAYLOAD', { keepOpen: true });

    expect(stdin.writes).toEqual(['PAYLOAD']);
    expect(stdin.ended).toBe(false);
  });
});

describe('runWithStdin', () => {
  it('resolves collected stdout on a clean exit', async () => {
    const fake = createFakeProc({ captureStdin: true });
    const promise = runWithStdinOn(fake.proc);

    fake.close(0, { stdout: 'ok' });

    await expect(promise).resolves.toBe('ok');
    expect(fake.stdinWrites).toEqual(['PAYLOAD']);
    expect(fake.isStdinEnded()).toBe(true);
  });

  it('rejects with exit code, stderr, and the stdin failure when the child exits early', async () => {
    const fake = createFakeProc();
    const promise = runWithStdinOn(fake.proc);

    fake.failStdin(new Error('write EPIPE'));
    fake.close(4, { stderr: 'authentication required\n' });

    await expect(promise).rejects.toThrow(
      'exited 4: authentication required (stdin write failed: write EPIPE)',
    );
  });

  it('resolves despite a late stdin failure when the child still exited 0', async () => {
    const fake = createFakeProc();
    const promise = runWithStdinOn(fake.proc);

    fake.failStdin(new Error('write EPIPE'));
    fake.close(0, { stdout: 'done' });

    await expect(promise).resolves.toBe('done');
  });

  it('settles once when a child error is followed by close', async () => {
    const fake = createFakeProc();
    const promise = runWithStdinOn(fake.proc);
    const onRejected = vi.fn();
    promise.catch(onRejected);

    fake.proc.emit('error', new Error('ENOENT'));
    fake.close(1, { stderr: 'ignored' });

    await expect(promise).rejects.toThrow('spawn failed: ENOENT');
    expect(onRejected).toHaveBeenCalledTimes(1);
  });

  it('rejects when spawn throws synchronously', async () => {
    mockSpawn.mockImplementationOnce(() => {
      throw new Error('EACCES');
    });

    await expect(
      runWithStdin({
        command: 'tool',
        args: [],
        input: 'PAYLOAD',
        cwd: '/repo',
        formatSpawnError: (err) => new Error(`spawn failed: ${err.message}`),
        formatExitError: () => new Error('unreachable'),
      }),
    ).rejects.toThrow('spawn failed: EACCES');
  });

  it('caps collected output instead of accumulating without limit', async () => {
    const fake = createFakeProc();
    const promise = runWithStdinOn(fake.proc, { maxOutputChars: 8 });

    fake.proc.stdout.emit('data', 'abcdefghij');
    fake.proc.stdout.emit('data', 'klmnop');
    fake.close(0);

    await expect(promise).resolves.toBe('abcdefgh');
  });

  it('rejects a truncated success when the caller parses the output', async () => {
    const fake = createFakeProc();
    const promise = runWithStdinOn(fake.proc, {
      maxOutputChars: 8,
      formatTruncatedOutputError: () => new Error('output too large'),
    });

    fake.proc.stdout.emit('data', 'abcdefghij');
    fake.close(0);

    await expect(promise).rejects.toThrow('output too large');
  });

  it('defaults the cap to the shared 2 MiB limit', () => {
    expect(MAX_COLLECTED_OUTPUT_CHARS).toBe(2 * 1024 * 1024);
  });
});
