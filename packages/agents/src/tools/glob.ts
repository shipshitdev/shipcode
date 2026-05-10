/**
 * Glob tool — find files by pattern, worktree-confined.
 *
 * Uses a simple recursive walker rather than fs.glob (which has
 * platform variance) to keep behavior predictable in tests.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { IGNORED_DIRECTORIES } from '@shipcode/shared';
import { z } from 'zod';
import { assertPathInWorktree, PathGuardError } from './path-guard';
import type { Tool, ToolContext, ToolResult } from './types';

const GlobInput = z.object({
  pattern: z.string().min(1),
  /** Root to search from, relative to the worktree. Defaults to '.'. */
  path: z.string().optional(),
});

type GlobInput = z.infer<typeof GlobInput>;

const MAX_MATCHES = 500;

export const globTool: Tool<GlobInput> = {
  name: 'glob',
  description:
    'Find files whose paths match a glob-like pattern, searching recursively from the given root. ' +
    'Supports *, **, and ? wildcards. Ignores node_modules, .git, dist, build, .next, .turbo, .shipcode.',
  schema: GlobInput,
  parameters: {
    type: 'object',
    required: ['pattern'],
    properties: {
      pattern: { type: 'string', description: 'Glob pattern, e.g. "**/*.ts" or "src/*.test.ts".' },
      path: { type: 'string', description: 'Optional search root, relative to the worktree.' },
    },
    additionalProperties: false,
  },

  async execute(input: GlobInput, ctx: ToolContext): Promise<ToolResult> {
    const searchRoot = input.path ?? '.';
    let rootAbs: string;
    try {
      rootAbs = await assertPathInWorktree(searchRoot, ctx.worktreePath, { mustExist: true });
    } catch (err) {
      /* v8 ignore next -- assertPathInWorktree reports validation failures as PathGuardError */
      if (err instanceof PathGuardError) return { ok: false, error: err.message };
      /* v8 ignore next -- assertPathInWorktree reports validation failures as PathGuardError */
      throw err;
    }

    const regex = globToRegex(input.pattern);
    const matches: string[] = [];

    async function walk(dir: string, rel: string): Promise<void> {
      /* v8 ignore next -- MAX_MATCHES is enforced in the caller loop before recursive re-entry */
      if (matches.length >= MAX_MATCHES) return;
      if (ctx.signal.aborted) return;

      let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (matches.length >= MAX_MATCHES) break;
        if (ctx.signal.aborted) break;
        if (IGNORED_DIRECTORIES.includes(entry.name)) continue;

        const childRel = rel === '.' ? entry.name : path.join(rel, entry.name);
        const childAbs = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await walk(childAbs, childRel);
        } else if (entry.isFile()) {
          if (regex.test(childRel)) matches.push(childRel);
        }
      }
    }

    await walk(rootAbs, searchRoot === '.' ? '.' : searchRoot);

    if (ctx.signal.aborted) return { ok: false, error: 'aborted' };

    matches.sort();
    const truncated = matches.length >= MAX_MATCHES;

    return {
      ok: true,
      content:
        matches.length === 0
          ? 'No matches.'
          : matches.join('\n') + (truncated ? `\n\n[truncated at ${MAX_MATCHES} matches]` : ''),
      data: { matches, truncated },
    };
  },
};

/**
 * Translate a subset of glob syntax to a RegExp.
 *
 * Supports: * (any chars except /), ** (any chars including /),
 * ? (single char except /), {a,b} alternation, [abc] character classes.
 */
function globToRegex(pattern: string): RegExp {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i += 2;
        // Consume an optional trailing slash after `**/`
        if (pattern[i] === '/') i++;
      } else {
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if (c === '{') {
      const end = pattern.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
        i++;
      } else {
        const alts = pattern
          .slice(i + 1, end)
          .split(',')
          .map(escapeRegex);
        re += `(?:${alts.join('|')})`;
        i = end + 1;
      }
    } else if (c === '[') {
      const end = pattern.indexOf(']', i);
      if (end === -1) {
        re += '\\[';
        i++;
      } else {
        re += pattern.slice(i, end + 1);
        i = end + 1;
      }
    } else {
      re += escapeRegex(c);
      i++;
    }
  }
  return new RegExp(`^${re}$`);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
