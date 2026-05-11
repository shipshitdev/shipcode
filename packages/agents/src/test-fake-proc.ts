import { EventEmitter } from 'node:events';
import { vi } from 'vitest';

export function createFakeProc(options: { captureStdin?: boolean; kill?: boolean } = {}) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: (chunk: string) => boolean; end: () => void };
    kill?: (signal: string) => void;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  const stdinWrites: string[] = [];
  let stdinEnded = false;
  proc.stdin = {
    write: (chunk: string) => {
      if (options.captureStdin) stdinWrites.push(chunk);
      return true;
    },
    end: () => {
      stdinEnded = true;
    },
  };
  if (options.kill) proc.kill = vi.fn();

  return {
    proc,
    stdinWrites,
    isStdinEnded: () => stdinEnded,
    close: (code: number, output?: { stdout?: string; stderr?: string }) => {
      if (output?.stdout) proc.stdout.emit('data', output.stdout);
      if (output?.stderr) proc.stderr.emit('data', output.stderr);
      proc.emit('close', code);
    },
  };
}
