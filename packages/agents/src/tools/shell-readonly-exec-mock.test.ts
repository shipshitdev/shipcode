import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from './types';

const mockExecFileAsync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async () => {
  const execFile = vi.fn();
  Object.assign(execFile, { [promisify.custom]: mockExecFileAsync });
  return { execFile };
});

import { shellReadOnlyTool } from './shell-readonly';

let wt: string;
let ctx: ToolContext;

beforeEach(async () => {
  wt = await fs.mkdtemp(path.join(os.tmpdir(), 'shipcode-shell-mocked-'));
  ctx = {
    worktreePath: wt,
    signal: new AbortController().signal,
    threadId: 't-shell-mocked',
  };
  mockExecFileAsync.mockReset();
});

afterEach(async () => {
  await fs.rm(wt, { recursive: true, force: true });
});

describe('shellReadOnlyTool mocked exec output formatting', () => {
  it('combines stdout and stderr for successful commands', async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: 'out\n', stderr: 'err\n' });

    const res = await shellReadOnlyTool.execute({ command: 'ls', args: [] }, ctx);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toBe('stdout:\nout\n\nstderr:\nerr\n');
      expect(res.data).toEqual({ exitCode: 0, stdout: 'out\n', stderr: 'err\n' });
    }
  });

  it('formats stderr-only successful commands without a leading separator', async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: 'err\n' });

    const res = await shellReadOnlyTool.execute({ command: 'ls', args: [] }, ctx);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toBe('stderr:\nerr\n');
      expect(res.data).toEqual({ exitCode: 0, stdout: '', stderr: 'err\n' });
    }
  });

  it('reports timeouts as errors', async () => {
    mockExecFileAsync.mockRejectedValueOnce({
      killed: true,
      signal: 'SIGTERM',
    });

    const res = await shellReadOnlyTool.execute({ command: 'ls', args: [] }, ctx);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/timed out/);
  });

  it('formats non-zero exits with default stdout, stderr, and exit code fallbacks', async () => {
    mockExecFileAsync.mockRejectedValueOnce({
      message: 'plain failure',
    });

    const res = await shellReadOnlyTool.execute({ command: 'ls', args: [] }, ctx);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toBe('exit 1\nplain failure');
      expect(res.data).toEqual({ exitCode: 1, stdout: '', stderr: '' });
    }
  });

  it('formats non-zero exits with stdout and no fallback message', async () => {
    mockExecFileAsync.mockRejectedValueOnce({
      code: 2,
      stdout: 'out\n',
    });

    const res = await shellReadOnlyTool.execute({ command: 'ls', args: [] }, ctx);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toBe('exit 2\nstdout:\nout\n\n');
      expect(res.data).toEqual({ exitCode: 2, stdout: 'out\n', stderr: '' });
    }
  });

  it('formats non-zero exits without output or message', async () => {
    mockExecFileAsync.mockRejectedValueOnce({});

    const res = await shellReadOnlyTool.execute({ command: 'ls', args: [] }, ctx);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toBe('exit 1\nno output');
      expect(res.data).toEqual({ exitCode: 1, stdout: '', stderr: '' });
    }
  });
});
