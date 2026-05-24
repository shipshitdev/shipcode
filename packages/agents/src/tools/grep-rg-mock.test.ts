import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from './types';

const mockExecFileAsync = vi.hoisted(() => vi.fn());
const mockRipgrepResponses = vi.hoisted(() => [] as unknown[]);

vi.mock('node:child_process', async () => {
  const execFile = vi.fn();
  Object.assign(execFile, { [promisify.custom]: mockExecFileAsync });
  return { execFile };
});

import { grepTool } from './grep';

let wt: string;
let ctx: ToolContext;

beforeEach(async () => {
  wt = await fs.mkdtemp(path.join(os.tmpdir(), 'shipcode-grep-rg-'));
  ctx = {
    worktreePath: wt,
    signal: new AbortController().signal,
    threadId: 't-grep-rg',
  };
  mockExecFileAsync.mockReset();
  mockRipgrepResponses.length = 0;
  mockExecFileAsync.mockImplementation(async (_command, args) => {
    if (Array.isArray(args) && args.includes('--version')) {
      return { stdout: 'rg 14.0.0\n', stderr: '' };
    }
    const next = mockRipgrepResponses.shift();
    if (next instanceof Error) throw next;
    if (next !== undefined) return next;
    return { stdout: '', stderr: '' };
  });
});

afterEach(async () => {
  await fs.rm(wt, { recursive: true, force: true });
});

describe('grepTool rg backend formatting', () => {
  it('caps long rg lines and marks max-count output as truncated', async () => {
    const longLine = `file.txt:1:${'x'.repeat(520)}`;
    const lines = Array.from({ length: 200 }, (_, index) =>
      index === 0 ? longLine : `file.txt:${index + 1}:needle`,
    );
    mockRipgrepResponses.push({ stdout: `${lines.join('\n')}\n`, stderr: '' });

    const res = await grepTool.execute({ pattern: 'needle' }, ctx);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain('…');
      expect(res.content).toContain('[truncated at 200 matches]');
      expect(res.data).toEqual({ matches: 200, truncated: true, backend: 'rg' });
    }
  });

  it('normalizes empty successful rg output and unknown failures', async () => {
    mockRipgrepResponses.push({ stdout: '', stderr: '' });

    const empty = await grepTool.execute({ pattern: 'needle' }, ctx);
    expect(empty).toEqual({
      ok: true,
      content: 'No matches.',
      data: { matches: 0, truncated: false, backend: 'rg' },
    });

    mockExecFileAsync.mockImplementation(async (_command, args) => {
      if (Array.isArray(args) && args.includes('--version')) {
        return { stdout: 'rg 14.0.0\n', stderr: '' };
      }
      throw { code: 1 };
    });
    const noStdout = await grepTool.execute({ pattern: 'needle' }, ctx);
    expect(noStdout).toEqual({
      ok: true,
      content: 'No matches.',
      data: { matches: 0, truncated: false, backend: 'rg' },
    });

    mockExecFileAsync.mockImplementation(async (_command, args) => {
      if (Array.isArray(args) && args.includes('--version')) {
        return { stdout: 'rg 14.0.0\n', stderr: '' };
      }
      throw {};
    });
    const failed = await grepTool.execute({ pattern: 'needle' }, ctx);
    expect(failed).toEqual({ ok: false, error: 'rg failed: unknown' });
  });
});
