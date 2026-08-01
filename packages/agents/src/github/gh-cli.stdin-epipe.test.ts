import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unlike gh-cli.test.ts this suite spawns a real child process, so
 * node:child_process is deliberately NOT mocked. Only the environment is
 * stubbed, so that `gh` resolves to a stub that exits without reading stdin —
 * the shape of a real auth failure, rate limit, or bad-args exit.
 */
const mockEnv = vi.hoisted(() => ({ PATH: '' }));
vi.mock('../health-check', () => ({
  shellExecEnv: () => mockEnv,
}));

import { GhCli } from './gh-cli';

// Comfortably larger than the OS pipe buffer (64 KB on macOS and Linux), so
// the write cannot complete before the child is gone.
const OVERSIZED_BODY = 'x'.repeat(4 * 1024 * 1024);

describe('spawnWithStdin EPIPE handling', () => {
  let tempDir: string;
  let uncaught: Error[];
  const captureUncaught = (err: Error) => {
    uncaught.push(err);
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-gh-stdin-'));
    const stub = path.join(tempDir, 'gh');
    fs.writeFileSync(stub, '#!/bin/sh\necho "gh: authentication required" >&2\nexit 4\n');
    fs.chmodSync(stub, 0o755);
    mockEnv.PATH = tempDir;

    uncaught = [];
    process.on('uncaughtException', captureUncaught);
  });

  afterEach(() => {
    process.off('uncaughtException', captureUncaught);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects instead of crashing when gh exits before draining stdin', async () => {
    const gh = new GhCli(tempDir);

    await expect(gh.editIssueBody(42, OVERSIZED_BODY)).rejects.toThrow(/exited with code 4/);

    // Let any stray stream error reach the uncaughtException handler before we
    // assert none arrived — an unhandled EPIPE here kills the Electron main
    // process in production.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(uncaught).toEqual([]);
  });

  it('surfaces gh stderr on the rejection', async () => {
    const gh = new GhCli(tempDir);

    await expect(gh.addIssueComment(42, OVERSIZED_BODY)).rejects.toThrow(
      /gh: authentication required/,
    );
  });
});
