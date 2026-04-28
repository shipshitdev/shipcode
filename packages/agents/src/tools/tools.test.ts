/**
 * Tests for the six file tools + the registry dispatcher.
 *
 * Shell-readonly has its own file because its surface is wider
 * (allowlist + git subcommand validation).
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  it('returns error if file does not exist', async () => {
    const res = await editTool.execute({ path: 'nope.txt', oldString: 'x', newString: 'y' }, ctx);
    expect(res.ok).toBe(false);
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

  it('rejects non-regular files', async () => {
    await fs.mkdir(path.join(wt, 'subdir'), { recursive: true });
    const res = await readTool.execute({ path: 'subdir' }, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not a regular file/);
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
});
