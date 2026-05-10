import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from './types';

const { mockExecFileAsync } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(async () => {
    throw new Error('rg unavailable');
  }),
}));

vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: mockExecFileAsync,
  }),
}));

import { grepTool } from './grep';

let wt: string;
let ctx: ToolContext;

beforeEach(async () => {
  wt = await fs.mkdtemp(path.join(os.tmpdir(), 'shipcode-grep-js-'));
  ctx = {
    worktreePath: wt,
    signal: new AbortController().signal,
    threadId: 't-grep',
  };
});

afterEach(async () => {
  await fs.rm(wt, { recursive: true, force: true });
});

describe('grepTool JS fallback', () => {
  it('walks files recursively, supports include alternation, and ignores skipped directories', async () => {
    await fs.mkdir(path.join(wt, 'src'), { recursive: true });
    await fs.mkdir(path.join(wt, 'nested/deep'), { recursive: true });
    await fs.mkdir(path.join(wt, 'node_modules/pkg'), { recursive: true });
    await fs.writeFile(path.join(wt, 'src/a.ts'), 'Alpha\n', 'utf-8');
    await fs.writeFile(path.join(wt, 'src/b.tsx'), 'beta\n', 'utf-8');
    await fs.writeFile(path.join(wt, 'src/c.js'), 'Alpha\n', 'utf-8');
    await fs.writeFile(path.join(wt, 'nested/deep/exact.name'), 'Alpha\n', 'utf-8');
    await fs.writeFile(path.join(wt, 'node_modules/pkg/index.ts'), 'Alpha\n', 'utf-8');
    await fs.symlink(path.join(wt, 'src/a.ts'), path.join(wt, 'src/a-link.ts'));

    const res = await grepTool.execute(
      { pattern: 'alpha', path: 'src', include: '*.{ts,tsx}', ignoreCase: true },
      ctx,
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual({ matches: 1, truncated: false, backend: 'js' });
      expect(res.content).toContain('a.ts:1:Alpha');
      expect(res.content).not.toContain('c.js');
      expect(res.content).not.toContain('node_modules');
    }

    const exact = await grepTool.execute({ pattern: 'Alpha', include: 'exact.name' }, ctx);
    expect(exact.ok).toBe(true);
    if (exact.ok) {
      expect(exact.content).toContain('nested/deep/exact.name:1:Alpha');
    }
  });

  it('handles aborted walks and missing roots', async () => {
    await fs.writeFile(path.join(wt, 'a.txt'), 'Alpha\n', 'utf-8');

    const aborted = new AbortController();
    aborted.abort();
    const abortedRes = await grepTool.execute(
      { pattern: 'Alpha' },
      { ...ctx, signal: aborted.signal },
    );
    expect(abortedRes).toEqual({
      ok: true,
      content: 'No matches.',
      data: { matches: 0, truncated: false, backend: 'js' },
    });

    const missingRoot = await grepTool.execute({ pattern: 'Alpha', path: 'missing' }, ctx);
    expect(missingRoot.ok).toBe(false);
  });

  it('reports invalid regex patterns in the fallback backend', async () => {
    const res = await grepTool.execute({ pattern: '([unclosed' }, ctx);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/invalid regex/);
  });

  it('skips unreadable directories and stops when aborted mid-walk', async () => {
    const readdirSpy = vi
      .spyOn(fs, 'readdir')
      .mockRejectedValueOnce(new Error('permission denied'));
    const unreadable = await grepTool.execute({ pattern: 'Alpha' }, ctx);
    readdirSpy.mockRestore();

    expect(unreadable).toEqual({
      ok: true,
      content: 'No matches.',
      data: { matches: 0, truncated: false, backend: 'js' },
    });

    const controller = new AbortController();
    await fs.mkdir(path.join(wt, 'abort-sub'), { recursive: true });
    await fs.writeFile(path.join(wt, 'after-abort.txt'), 'Alpha\n', 'utf-8');

    const realReaddir = fs.readdir.bind(fs);
    const abortingReaddir = vi.spyOn(fs, 'readdir').mockImplementation(async (dir, options) => {
      if (String(dir).endsWith('abort-sub')) {
        controller.abort();
      }
      return realReaddir(dir, options as Parameters<typeof fs.readdir>[1]);
    });

    const aborted = await grepTool.execute(
      { pattern: 'Alpha' },
      { ...ctx, signal: controller.signal },
    );
    abortingReaddir.mockRestore();

    expect(aborted.ok).toBe(true);
    if (aborted.ok) expect(aborted.data).toEqual({ matches: 0, truncated: false, backend: 'js' });
  });

  it('caps long lines and match counts in fallback results', async () => {
    const longLine = `${'x'.repeat(520)} needle`;
    await fs.writeFile(path.join(wt, 'long.txt'), `${longLine}\n`, 'utf-8');

    const long = await grepTool.execute({ pattern: 'needle', include: '*.txt' }, ctx);
    expect(long.ok).toBe(true);
    if (long.ok) {
      expect(long.content).toContain('\u2026');
      expect(long.content.length).toBeLessThan(longLine.length + 50);
    }

    await fs.mkdir(path.join(wt, 'many'), { recursive: true });
    await Promise.all(
      Array.from({ length: 205 }, (_, index) =>
        fs.writeFile(path.join(wt, 'many', `${index}.txt`), 'needle\n', 'utf-8'),
      ),
    );
    const capped = await grepTool.execute({ pattern: 'needle', path: 'many' }, ctx);

    expect(capped.ok).toBe(true);
    if (capped.ok) {
      expect(capped.data).toEqual({ matches: 200, truncated: true, backend: 'js' });
      expect(capped.content).toContain('[truncated at 200 matches]');
    }
  });
});
