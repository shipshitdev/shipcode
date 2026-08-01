import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';

/**
 * Shared spawn-with-stdin primitives.
 *
 * Three call sites pipe a payload into a child process: the long-lived managed
 * processes in `process-manager.ts`, the one-shot CLI generators in
 * `cli-stdin-runner.ts`, and the GitHub writes in `github/gh-cli.ts`. Each used
 * to carry its own copy of the write logic, and only one attached the stdin
 * `'error'` listener that keeps an EPIPE — a child exiting before it drains the
 * payload — from surfacing as an unhandled stream error that takes down the
 * Electron main process.
 *
 * The layering follows the real difference between the callers rather than
 * forcing them into one API:
 * - {@link pipeStdin} owns the write and stdin failure handling. Every caller
 *   uses it, including the process manager, which layers its own lifecycle
 *   tracking (state transitions, output events, registry) on top.
 * - {@link runWithStdin} adds spawn, bounded output collection, and
 *   single-settle promise semantics for the one-shot request/response callers.
 */

/**
 * Per-stream cap on output collected from a one-shot child. Without it a
 * long-running agent run accumulates an unbounded string in memory. Matches the
 * 2 MiB `maxBuffer` the repo already uses for `ps` and `rg` output.
 */
export const MAX_COLLECTED_OUTPUT_CHARS = 2 * 1024 * 1024;

export interface StdinPipeOptions {
  /**
   * Leave stdin writable after the payload drains, for transports that accept
   * later steering input. Those writes own their own failures, so the initial
   * write's `onError` stops firing once the payload is through.
   */
  keepOpen?: boolean;
  /** Called at most once, with the first stdin failure. */
  onError?: (err: Error) => void;
}

export interface StdinPipe {
  /** First stdin failure observed, or `null` if the payload went through. */
  readonly error: Error | null;
}

/**
 * Write `input` to a child's stdin with the failure handling that makes an
 * early child exit survivable.
 *
 * The `'error'` listener is attached *before* the write and stays attached for
 * the life of the stream: a child that exits early fails the pending write with
 * EPIPE, and an unlistened stream error is fatal to the process. Backpressure is
 * honored so large payloads are not silently dropped, and a synchronous throw
 * (`ERR_STREAM_DESTROYED`, when the pipe is already gone) is folded into the
 * same reporting path instead of escaping to the caller.
 */
export function pipeStdin(
  stdin: NodeJS.WritableStream,
  input: string,
  options: StdinPipeOptions = {},
): StdinPipe {
  const pipe: { error: Error | null } = { error: null };
  let reported = false;

  const fail = (err: Error) => {
    pipe.error ??= err;
    if (reported) return;
    reported = true;
    options.onError?.(err);
  };

  stdin.on('error', fail);

  const finish = () => {
    // Steering transports keep the pipe open; later writes report their own
    // failures, but the listener above stays so a late EPIPE remains handled.
    if (options.keepOpen) {
      reported = true;
      return;
    }
    stdin.end();
  };

  try {
    if (stdin.write(input) !== false) finish();
    else stdin.once('drain', finish);
  } catch (err) {
    fail(err instanceof Error ? err : new Error(String(err)));
  }

  return pipe;
}

export interface StdinRunFailure {
  command: string;
  args: readonly string[];
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** First stdin failure, when the child died before draining the payload. */
  stdinError: Error | null;
  /** True when either stream hit the cap and lost trailing output. */
  truncated: boolean;
}

export interface RunWithStdinOptions {
  command: string;
  args: readonly string[];
  input: string;
  cwd: string;
  /** Replaces the inherited environment when provided. */
  env?: Record<string, string>;
  /** Kill the child and reject after this many ms. Omit to wait indefinitely. */
  timeoutMs?: number;
  /** Per-stream collection cap. Defaults to {@link MAX_COLLECTED_OUTPUT_CHARS}. */
  maxOutputChars?: number;
  /** Wrap a spawn failure or a child `'error'` event. */
  formatSpawnError: (err: Error) => Error;
  /** Build the rejection for a non-zero exit. */
  formatExitError: (failure: StdinRunFailure) => Error;
  formatTimeoutError?: (timeoutMs: number) => Error;
  /**
   * When set, a *successful* run whose output was truncated rejects with this
   * instead of resolving. Callers that parse the output (JSON envelopes) want
   * the cap reported plainly rather than a downstream parse error; callers whose
   * output is incidental can leave it unset and take the truncated text.
   */
  formatTruncatedOutputError?: (failure: StdinRunFailure) => Error;
}

interface BoundedCollector {
  push(chunk: unknown): void;
  readonly text: string;
  readonly truncated: boolean;
}

/**
 * Collect up to `maxChars`, then drop the rest. Keeps the head: the callers
 * parse structured output from the start of the stream, and a run that blows
 * past the cap has already failed in a way the tail would not explain.
 */
function createBoundedCollector(maxChars: number): BoundedCollector {
  let text = '';
  let truncated = false;
  return {
    push(chunk: unknown) {
      const room = maxChars - text.length;
      if (room <= 0) {
        truncated = true;
        return;
      }
      const value = String(chunk);
      if (value.length > room) {
        text += value.slice(0, room);
        truncated = true;
        return;
      }
      text += value;
    },
    get text() {
      return text;
    },
    get truncated() {
      return truncated;
    },
  };
}

/**
 * Spawn a command, pipe `input` to its stdin, and resolve its stdout.
 *
 * Resolves on exit 0 — including when stdin failed late, because the child
 * reported the work done and these operations (GitHub writes especially) are not
 * safe to retry. Every other outcome rejects exactly once, through the caller's
 * formatters, with the exit code, stderr, and any stdin failure carried along.
 */
export function runWithStdin(options: RunWithStdinOptions): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(options.command, [...options.args], {
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        ...(options.env ? { env: options.env } : {}),
      });
    } catch (err) {
      reject(options.formatSpawnError(err instanceof Error ? err : new Error(String(err))));
      return;
    }

    const maxChars = options.maxOutputChars ?? MAX_COLLECTED_OUTPUT_CHARS;
    const stdout = createBoundedCollector(maxChars);
    const stderr = createBoundedCollector(maxChars);

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = (err: Error | null, value = '') => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));

    const stdin = pipeStdin(child.stdin, options.input);

    child.on('error', (err) => settle(options.formatSpawnError(err)));
    child.on('close', (code, signal) => {
      const failure: StdinRunFailure = {
        command: options.command,
        args: options.args,
        code,
        signal,
        stdout: stdout.text,
        stderr: stderr.text,
        stdinError: stdin.error,
        truncated: stdout.truncated || stderr.truncated,
      };
      if (code !== 0) {
        settle(options.formatExitError(failure));
        return;
      }
      const truncatedError = failure.truncated
        ? options.formatTruncatedOutputError?.(failure)
        : null;
      settle(truncatedError ?? null, stdout.text);
    });

    if (options.timeoutMs !== undefined) {
      const timeoutMs = options.timeoutMs;
      timer = setTimeout(() => {
        child.kill('SIGTERM');
        settle(
          options.formatTimeoutError?.(timeoutMs) ??
            new Error(`${options.command} timed out after ${timeoutMs}ms`),
        );
      }, timeoutMs);
    }
  });
}
