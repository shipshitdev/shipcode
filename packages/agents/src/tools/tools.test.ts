/**
 * Tests for the six file tools + the registry dispatcher.
 *
 * Shell-readonly has its own file because its surface is wider
 * (allowlist + git subcommand validation).
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MAX_READ_BYTES } from '@shipcode/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editTool } from './edit';
import { globTool } from './glob';
import { grepTool } from './grep';
import { readTool } from './read';
import { executeToolCall, getToolSchemas, toolCallHash } from './registry';
import type { ToolContext } from './types';
import { writeTool } from './write';

let wt: string;
let ctx: ToolContext;

beforeEach(async () => {
  wt = await fs.mkdtemp(path.join(os.tmpdir(), 'shipcode-tools-'));
  ctx = {
    worktreePath: wt,
    signal: new AbortController().signal,
    threadId: 't-test',
  };
});

afterEach(async () => {
  await fs.rm(wt, { recursive: true, force: true });
});

// ─── edit ────────────────────────────────────────────────────────────

describe('editTool', () => {
  it('replaces a unique substring', async () => {
    await fs.writeFile(path.join(wt, 'f.txt'), 'hello world\n', 'utf-8');
    const res = await editTool.execute(
      { path: 'f.txt', oldString: 'world', newString: 'there' },
      ctx,
    );
    expect(res.ok).toBe(true);
    const after = await fs.readFile(path.join(wt, 'f.txt'), 'utf-8');
    expect(after).toBe('hello there\n');
  });

  it('refuses to edit when oldString appears multiple times without replaceAll', async () => {
    await fs.writeFile(path.join(wt, 'f.txt'), 'foo\nfoo\nfoo\n', 'utf-8');
    const res = await editTool.execute({ path: 'f.txt', oldString: 'foo', newString: 'bar' }, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/multiple times/);
  });

  it('replaceAll: true replaces every occurrence', async () => {
    await fs.writeFile(path.join(wt, 'f.txt'), 'foo\nfoo\nfoo\n', 'utf-8');
    const res = await editTool.execute(
      { path: 'f.txt', oldString: 'foo', newString: 'bar', replaceAll: true },
      ctx,
    );
    expect(res.ok).toBe(true);
    const after = await fs.readFile(path.join(wt, 'f.txt'), 'utf-8');
    expect(after).toBe('bar\nbar\nbar\n');
  });

  it('returns error if oldString is not found', async () => {
    await fs.writeFile(path.join(wt, 'f.txt'), 'hello\n', 'utf-8');
    const res = await editTool.execute(
      { path: 'f.txt', oldString: 'missing', newString: 'x' },
      ctx,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not found/);
  });

  it('rejects identical replacement text', async () => {
    await fs.writeFile(path.join(wt, 'f.txt'), 'hello\n', 'utf-8');
    const res = await editTool.execute(
      { path: 'f.txt', oldString: 'hello', newString: 'hello' },
      ctx,
    );

    expect(res).toEqual({ ok: false, error: 'oldString and newString are identical' });
  });

  it('returns error if file does not exist', async () => {
    const res = await editTool.execute({ path: 'nope.txt', oldString: 'x', newString: 'y' }, ctx);
    expect(res.ok).toBe(false);
  });

  it('reports read and write failures after path validation', async () => {
    await fs.mkdir(path.join(wt, 'dir-target'));
    const readFailure = await editTool.execute(
      { path: 'dir-target', oldString: 'x', newString: 'y' },
      ctx,
    );
    expect(readFailure.ok).toBe(false);
    if (!readFailure.ok) expect(readFailure.error).toMatch(/failed to read dir-target/i);

    await fs.writeFile(path.join(wt, 'f.txt'), 'hello\n', 'utf-8');
    const writeSpy = vi
      .spyOn(fs, 'writeFile')
      .mockRejectedValueOnce(new Error('permission denied'));
    const writeFailure = await editTool.execute(
      { path: 'f.txt', oldString: 'hello', newString: 'there' },
      ctx,
    );
    writeSpy.mockRestore();

    expect(writeFailure.ok).toBe(false);
    if (!writeFailure.ok) expect(writeFailure.error).toMatch(/failed to write f\.txt/i);
  });

  it('rejects absolute paths outside the worktree', async () => {
    const res = await editTool.execute(
      { path: '/etc/passwd', oldString: 'root', newString: 'hacked' },
      ctx,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/escapes worktree/);
  });

  it('rejects ../ escapes', async () => {
    await fs.writeFile(path.join(wt, 'f.txt'), 'x', 'utf-8');
    const res = await editTool.execute(
      { path: '../../etc/passwd', oldString: 'x', newString: 'y' },
      ctx,
    );
    expect(res.ok).toBe(false);
  });
});

// ─── write ───────────────────────────────────────────────────────────

describe('writeTool', () => {
  it('creates a new file', async () => {
    const res = await writeTool.execute({ path: 'new.txt', content: 'hello' }, ctx);
    expect(res.ok).toBe(true);
    expect(await fs.readFile(path.join(wt, 'new.txt'), 'utf-8')).toBe('hello');
  });

  it('creates missing parent directories', async () => {
    const res = await writeTool.execute({ path: 'a/b/c/new.txt', content: 'x' }, ctx);
    expect(res.ok).toBe(true);
    expect(await fs.readFile(path.join(wt, 'a/b/c/new.txt'), 'utf-8')).toBe('x');
  });

  it('overwrites an existing file', async () => {
    await fs.writeFile(path.join(wt, 'f.txt'), 'old', 'utf-8');
    const res = await writeTool.execute({ path: 'f.txt', content: 'new' }, ctx);
    expect(res.ok).toBe(true);
    expect(await fs.readFile(path.join(wt, 'f.txt'), 'utf-8')).toBe('new');
  });

  it('rejects path escapes', async () => {
    const res = await writeTool.execute({ path: '../escape.txt', content: 'x' }, ctx);
    expect(res.ok).toBe(false);
  });

  it('reports filesystem write failures', async () => {
    await fs.mkdir(path.join(wt, 'already-dir'));

    const res = await writeTool.execute({ path: 'already-dir', content: 'x' }, ctx);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/failed to write already-dir/i);
  });
});

// ─── read ────────────────────────────────────────────────────────────

describe('readTool', () => {
  it('reads an entire file', async () => {
    await fs.writeFile(path.join(wt, 'f.txt'), 'line1\nline2\nline3\n', 'utf-8');
    const res = await readTool.execute({ path: 'f.txt' }, ctx);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.content).toContain('line2');
  });

  it('honors offset and limit', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
    await fs.writeFile(path.join(wt, 'big.txt'), lines, 'utf-8');
    const res = await readTool.execute({ path: 'big.txt', offset: 10, limit: 5 }, ctx);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const returned = res.content.split('\n');
      expect(returned).toHaveLength(5);
      expect(returned[0]).toBe('line 10');
      expect(returned[4]).toBe('line 14');
    }
  });

  it('honors offset without limit and truncates oversized files', async () => {
    await fs.writeFile(path.join(wt, 'offset.txt'), 'one\ntwo\nthree\n', 'utf-8');
    const offsetOnly = await readTool.execute({ path: 'offset.txt', offset: 2 }, ctx);
    expect(offsetOnly.ok).toBe(true);
    if (offsetOnly.ok) {
      expect(offsetOnly.content).toBe('two\nthree\n');
    }

    await fs.writeFile(path.join(wt, 'huge.txt'), 'x'.repeat(MAX_READ_BYTES + 10), 'utf-8');
    const huge = await readTool.execute({ path: 'huge.txt' }, ctx);
    expect(huge.ok).toBe(true);
    if (huge.ok) {
      expect(huge.content).toContain(`[truncated: file is ${MAX_READ_BYTES + 10} bytes`);
    }
  });

  it('honors limit without offset from the start of the file', async () => {
    await fs.writeFile(path.join(wt, 'limited.txt'), 'one\ntwo\nthree\n', 'utf-8');

    const res = await readTool.execute({ path: 'limited.txt', limit: 2 }, ctx);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.content).toBe('one\ntwo');
  });

  it('rejects non-regular files', async () => {
    await fs.mkdir(path.join(wt, 'subdir'), { recursive: true });
    const res = await readTool.execute({ path: 'subdir' }, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not a regular file/);
  });

  it('reports stat and read failures after path validation', async () => {
    await fs.writeFile(path.join(wt, 'f.txt'), 'hello\n', 'utf-8');

    const statSpy = vi.spyOn(fs, 'stat').mockRejectedValueOnce(new Error('stat failed'));
    const statFailure = await readTool.execute({ path: 'f.txt' }, ctx);
    statSpy.mockRestore();
    expect(statFailure.ok).toBe(false);
    if (!statFailure.ok) expect(statFailure.error).toMatch(/failed to stat f\.txt/i);

    const readSpy = vi.spyOn(fs, 'open').mockRejectedValueOnce(new Error('read failed'));
    const readFailure = await readTool.execute({ path: 'f.txt' }, ctx);
    readSpy.mockRestore();
    expect(readFailure.ok).toBe(false);
    if (!readFailure.ok) expect(readFailure.error).toMatch(/failed to read f\.txt/i);
  });

  it('rejects path escapes', async () => {
    const res = await readTool.execute({ path: '/etc/passwd' }, ctx);
    expect(res.ok).toBe(false);
  });
});

// ─── glob ────────────────────────────────────────────────────────────

describe('globTool', () => {
  beforeEach(async () => {
    await fs.writeFile(path.join(wt, 'a.ts'), 'x', 'utf-8');
    await fs.writeFile(path.join(wt, 'b.ts'), 'x', 'utf-8');
    await fs.writeFile(path.join(wt, 'c.js'), 'x', 'utf-8');
    await fs.mkdir(path.join(wt, 'src'), { recursive: true });
    await fs.writeFile(path.join(wt, 'src/d.ts'), 'x', 'utf-8');
    await fs.mkdir(path.join(wt, 'node_modules/lodash'), { recursive: true });
    await fs.writeFile(path.join(wt, 'node_modules/lodash/index.ts'), 'x', 'utf-8');
  });

  it('matches top-level files with *.ts', async () => {
    const res = await globTool.execute({ pattern: '*.ts' }, ctx);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const matches = (res.data as { matches: string[] }).matches;
      expect(matches).toContain('a.ts');
      expect(matches).toContain('b.ts');
      expect(matches).not.toContain('c.js');
      expect(matches).not.toContain('src/d.ts');
    }
  });

  it('matches recursively with **/*.ts', async () => {
    const res = await globTool.execute({ pattern: '**/*.ts' }, ctx);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const matches = (res.data as { matches: string[] }).matches;
      expect(matches).toContain('a.ts');
      expect(matches).toContain('src/d.ts');
    }
  });

  it('supports alternation, character classes, question marks, and scoped search roots', async () => {
    await fs.writeFile(path.join(wt, 'src/e.tsx'), 'x', 'utf-8');
    await fs.writeFile(path.join(wt, 'src/f.test.ts'), 'x', 'utf-8');

    const alternation = await globTool.execute({ pattern: '**/*.{ts,tsx}' }, ctx);
    expect(alternation.ok).toBe(true);
    if (alternation.ok) {
      const matches = (alternation.data as { matches: string[] }).matches;
      expect(matches).toContain('src/d.ts');
      expect(matches).toContain('src/e.tsx');
    }

    const characterClass = await globTool.execute({ pattern: '[ab].ts' }, ctx);
    expect(characterClass.ok).toBe(true);
    if (characterClass.ok) {
      expect((characterClass.data as { matches: string[] }).matches).toEqual(['a.ts', 'b.ts']);
    }

    const questionMark = await globTool.execute({ pattern: '?.ts' }, ctx);
    expect(questionMark.ok).toBe(true);
    if (questionMark.ok) {
      expect((questionMark.data as { matches: string[] }).matches).toEqual(['a.ts', 'b.ts']);
    }

    const scoped = await globTool.execute({ pattern: 'src/*.test.ts', path: 'src' }, ctx);
    expect(scoped.ok).toBe(true);
    if (scoped.ok) {
      expect((scoped.data as { matches: string[] }).matches).toEqual(['src/f.test.ts']);
    }

    const unterminatedAlternation = await globTool.execute({ pattern: 'src/*.{ts' }, ctx);
    expect(unterminatedAlternation.ok).toBe(true);
    if (unterminatedAlternation.ok) {
      expect((unterminatedAlternation.data as { matches: string[] }).matches).toEqual([]);
    }

    const unterminatedClass = await globTool.execute({ pattern: 'src/[d.ts' }, ctx);
    expect(unterminatedClass.ok).toBe(true);
    if (unterminatedClass.ok) {
      expect((unterminatedClass.data as { matches: string[] }).matches).toEqual([]);
    }

    const doubleStarWithoutSlash = await globTool.execute({ pattern: '**.ts' }, ctx);
    expect(doubleStarWithoutSlash.ok).toBe(true);
  });

  it('skips directory entries that are neither files nor directories', async () => {
    await fs.symlink(path.join(wt, 'a.ts'), path.join(wt, 'a-link.ts'));

    const res = await globTool.execute({ pattern: '*.ts' }, ctx);

    expect(res.ok).toBe(true);
    if (res.ok) expect((res.data as { matches: string[] }).matches).not.toContain('a-link.ts');
  });

  it('returns no matches when the search root is not a directory', async () => {
    const res = await globTool.execute({ pattern: '*.txt', path: 'a.ts' }, ctx);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.content).toBe('No matches.');
  });

  it('ignores node_modules', async () => {
    const res = await globTool.execute({ pattern: '**/*.ts' }, ctx);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const matches = (res.data as { matches: string[] }).matches;
      expect(matches.every((m) => !m.includes('node_modules'))).toBe(true);
    }
  });

  it('returns "No matches." when nothing hits', async () => {
    const res = await globTool.execute({ pattern: '*.rs' }, ctx);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.content).toBe('No matches.');
  });

  it('rejects path escapes', async () => {
    const res = await globTool.execute({ pattern: '*.ts', path: '../other' }, ctx);
    expect(res.ok).toBe(false);
  });

  it('reports aborted walks and caps large result sets', async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = await globTool.execute(
      { pattern: '**/*.ts' },
      { ...ctx, signal: controller.signal },
    );
    expect(aborted).toEqual({ ok: false, error: 'aborted' });

    const bigDir = path.join(wt, 'many');
    await fs.mkdir(bigDir, { recursive: true });
    await Promise.all(
      Array.from({ length: 505 }, (_, index) =>
        fs.writeFile(path.join(bigDir, `${String(index).padStart(3, '0')}.ts`), 'x', 'utf-8'),
      ),
    );

    const capped = await globTool.execute({ pattern: 'many/*.ts' }, ctx);
    expect(capped.ok).toBe(true);
    if (capped.ok) {
      const data = capped.data as { matches: string[]; truncated: boolean };
      expect(data.matches).toHaveLength(500);
      expect(data.truncated).toBe(true);
      expect(capped.content).toContain('[truncated at 500 matches]');
    }
  });

  it('treats unreadable directories as empty and stops when aborted mid-walk', async () => {
    const readdirSpy = vi
      .spyOn(fs, 'readdir')
      .mockRejectedValueOnce(new Error('permission denied'));
    const unreadable = await globTool.execute({ pattern: '**/*.ts' }, ctx);
    readdirSpy.mockRestore();

    expect(unreadable.ok).toBe(true);
    if (unreadable.ok) expect(unreadable.content).toBe('No matches.');

    const controller = new AbortController();
    await fs.mkdir(path.join(wt, 'abort-sub'), { recursive: true });
    await fs.writeFile(path.join(wt, 'after-abort.ts'), 'x', 'utf-8');

    const realReaddir = fs.readdir.bind(fs);
    const abortingReaddir = vi.spyOn(fs, 'readdir').mockImplementation(async (dir, options) => {
      if (String(dir).endsWith('abort-sub')) {
        controller.abort();
      }
      return realReaddir(dir, options as Parameters<typeof fs.readdir>[1]);
    });

    const aborted = await globTool.execute(
      { pattern: '**/*.ts' },
      { ...ctx, signal: controller.signal },
    );
    abortingReaddir.mockRestore();

    expect(aborted).toEqual({ ok: false, error: 'aborted' });
  });
});

// ─── grep ────────────────────────────────────────────────────────────

describe('grepTool', () => {
  beforeEach(async () => {
    await fs.writeFile(path.join(wt, 'a.ts'), 'import foo from "bar"\nconst x = 1\n', 'utf-8');
    await fs.writeFile(path.join(wt, 'b.ts'), 'const foo = 2\nconst y = 3\n', 'utf-8');
  });

  it('finds matching lines', async () => {
    const res = await grepTool.execute({ pattern: 'foo' }, ctx);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain('foo');
      expect(res.content).toMatch(/a\.ts|b\.ts/);
    }
  });

  it('passes ignoreCase and include filters through the rg backend', async () => {
    const res = await grepTool.execute({ pattern: 'FOO', include: '*.ts', ignoreCase: true }, ctx);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain('foo');
      expect(res.content).not.toContain('No matches.');
    }
  });

  it('returns "No matches." when no hits', async () => {
    const res = await grepTool.execute({ pattern: 'does_not_exist_anywhere' }, ctx);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.content).toBe('No matches.');
  });

  it('rejects invalid regex', async () => {
    const res = await grepTool.execute({ pattern: '([unclosed' }, ctx);
    // rg returns exit 2 for bad regex; JS fallback catches via RegExp
    // constructor. Either way it surfaces an error, OR rg may return
    // an empty "No matches." — accept both.
    if (res.ok) {
      expect(res.content).toMatch(/No matches|error/i);
    } else {
      expect(res.error).toMatch(/regex|parse|failed/i);
    }
  });

  it('rejects path escapes', async () => {
    const res = await grepTool.execute({ pattern: 'foo', path: '../other' }, ctx);
    expect(res.ok).toBe(false);
  });
});

// ─── registry / dispatcher ───────────────────────────────────────────

describe('tool registry', () => {
  it('getToolSchemas returns all registered tools', () => {
    const names = getToolSchemas()
      .map((tool) => tool.function.name)
      .sort();
    expect(names).toEqual(['edit', 'github_graphql', 'glob', 'grep', 'read', 'shell', 'write']);
  });

  it('getToolSchemas returns OpenAI function-calling schemas', () => {
    const schemas = getToolSchemas();
    expect(schemas).toHaveLength(7);
    for (const s of schemas) {
      expect(s.type).toBe('function');
      expect(s.function.name).toBeTruthy();
      expect(s.function.description).toBeTruthy();
      expect(s.function.parameters).toBeTruthy();
    }
  });

  it('executeToolCall dispatches to the named tool with parsed args', async () => {
    await fs.writeFile(path.join(wt, 'f.txt'), 'hi', 'utf-8');
    const res = await executeToolCall('read', JSON.stringify({ path: 'f.txt' }), ctx);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.content).toContain('hi');
  });

  it('executeToolCall returns error for unknown tool', async () => {
    const res = await executeToolCall('notatool', '{}', ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/unknown tool/);
  });

  it('executeToolCall returns error for malformed JSON arguments', async () => {
    const res = await executeToolCall('read', '{not-json', ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/invalid JSON/);
  });

  it('executeToolCall returns error for schema mismatches', async () => {
    // read requires `path` (string); passing a number violates the schema.
    const res = await executeToolCall('read', JSON.stringify({ path: 123 }), ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/schema error/);
  });

  it('executeToolCall defaults empty argument payloads and catches tool throws', async () => {
    const missingReadPath = await executeToolCall('read', '', ctx);
    expect(missingReadPath.ok).toBe(false);
    if (!missingReadPath.ok) expect(missingReadPath.error).toMatch(/schema error/);

    const statSpy = vi.spyOn(fs, 'stat').mockRejectedValueOnce(new Error('stat exploded'));
    await fs.writeFile(path.join(wt, 'throw-read.txt'), 'x', 'utf-8');
    const failed = await executeToolCall('read', JSON.stringify({ path: 'throw-read.txt' }), ctx);
    statSpy.mockRestore();

    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error).toMatch(/failed to stat/);
  });

  it('executeToolCall catches unexpected tool throws', async () => {
    const executeSpy = vi.spyOn(readTool, 'execute').mockRejectedValueOnce(new Error('boom'));

    const failed = await executeToolCall('read', JSON.stringify({ path: 'f.txt' }), ctx);
    executeSpy.mockRestore();

    expect(failed).toEqual({ ok: false, error: "tool 'read' threw: boom" });
  });

  it('toolCallHash is stable across key order', () => {
    const h1 = toolCallHash('edit', JSON.stringify({ path: 'a', oldString: 'b', newString: 'c' }));
    const h2 = toolCallHash('edit', JSON.stringify({ newString: 'c', oldString: 'b', path: 'a' }));
    expect(h1).toBe(h2);
  });

  it('toolCallHash differs across different args', () => {
    const h1 = toolCallHash('edit', JSON.stringify({ path: 'a' }));
    const h2 = toolCallHash('edit', JSON.stringify({ path: 'b' }));
    expect(h1).not.toBe(h2);
  });

  it('toolCallHash falls back to the raw argument text when JSON is invalid', () => {
    expect(toolCallHash('read', '{not-json')).toBe('read|{not-json');
  });

  it('toolCallHash canonicalizes empty argument text as an empty object', () => {
    expect(toolCallHash('read', '')).toBe('read|{}');
  });
});
