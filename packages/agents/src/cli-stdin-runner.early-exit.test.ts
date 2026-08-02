import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCliWithStdin } from './cli-stdin-runner';

/**
 * Unlike cli-stdin-runner.test.ts this suite spawns a real child process, so
 * node:child_process is deliberately NOT mocked. `PATH` is stubbed to a stub
 * CLI that exits without reading stdin — the shape of a real auth failure or
 * bad-args exit, which fails the pending write with EPIPE.
 */

// Comfortably larger than the OS pipe buffer (64 KB on macOS and Linux), so the
// write cannot complete before the child is gone.
const OVERSIZED_PROMPT = 'x'.repeat(4 * 1024 * 1024);

describe('runCliWithStdin against a child that exits before draining stdin', () => {
  let tempDir: string;
  let uncaught: Error[];
  const captureUncaught = (err: Error) => {
    uncaught.push(err);
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-cli-stdin-'));
    const stub = path.join(tempDir, 'codex');
    fs.writeFileSync(stub, '#!/bin/sh\necho "codex: not logged in" >&2\nexit 3\n');
    fs.chmodSync(stub, 0o755);
    vi.stubEnv('PATH', tempDir);

    uncaught = [];
    process.on('uncaughtException', captureUncaught);
  });

  afterEach(() => {
    process.off('uncaughtException', captureUncaught);
    vi.unstubAllEnvs();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects cleanly instead of crashing on the unhandled stdin error', async () => {
    const promise = runCliWithStdin({
      cli: 'codex',
      args: ['exec'],
      input: OVERSIZED_PROMPT,
      cwd: tempDir,
      timeoutMs: 30_000,
    });

    await expect(promise).rejects.toThrow(/Codex CLI exited 3/);

    // Let any stray stream error reach the uncaughtException handler before we
    // assert none arrived — an unhandled EPIPE here kills the Electron main
    // process in production.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(uncaught).toEqual([]);
  });

  it('carries the stdin failure into the rejection alongside stderr', async () => {
    await expect(
      runCliWithStdin({
        cli: 'codex',
        args: ['exec'],
        input: OVERSIZED_PROMPT,
        cwd: tempDir,
        timeoutMs: 30_000,
      }),
    ).rejects.toThrow(/stdin write failed/);
  });
});
