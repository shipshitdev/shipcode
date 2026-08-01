import { EventEmitter } from 'node:events';
import { vi } from 'vitest';

type FakeStdin = EventEmitter & { write: (chunk: string) => boolean; end: () => void };

export function createFakeProc(options: { captureStdin?: boolean; kill?: boolean } = {}) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: FakeStdin;
    kill?: (signal: string) => void;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  const stdinWrites: string[] = [];
  let stdinEnded = false;
  // `writeThrows` reproduces a pipe that is already destroyed when we write.
  let writeThrows: Error | null = null;
  // An EventEmitter, not a plain object: the shared stdin pipe attaches an
  // 'error' listener before writing, which is the whole point of the helper.
  const stdin = new EventEmitter() as FakeStdin;
  stdin.write = (chunk: string) => {
    if (writeThrows) throw writeThrows;
    if (options.captureStdin) stdinWrites.push(chunk);
    return true;
  };
  stdin.end = () => {
    stdinEnded = true;
  };
  proc.stdin = stdin;
  if (options.kill) proc.kill = vi.fn();

  return {
    proc,
    stdinWrites,
    isStdinEnded: () => stdinEnded,
    /** Emit a stdin failure, as a child that exits before draining stdin does. */
    failStdin: (err: Error) => proc.stdin.emit('error', err),
    /** Make the next `stdin.write` throw synchronously (ERR_STREAM_DESTROYED). */
    throwOnWrite: (err: Error) => {
      writeThrows = err;
    },
    close: (code: number, output?: { stdout?: string; stderr?: string }) => {
      if (output?.stdout) proc.stdout.emit('data', output.stdout);
      if (output?.stderr) proc.stderr.emit('data', output.stderr);
      proc.emit('close', code);
    },
  };
}
