/**
 * Grep tool — regex content search across the worktree.
 *
 * Uses ripgrep (`rg`) only (fast, respects .gitignore). Results capped
 * to avoid flooding the model's context.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { assertPathInWorktree, PathGuardError } from './path-guard';
import type { Tool, ToolContext, ToolResult } from './types';

const execFileAsync = promisify(execFile);

const GrepInput = z.object({
  pattern: z.string().min(1),
  /** Search root, relative to the worktree. Defaults to '.'. */
  path: z.string().optional(),
  /** Only match files matching this glob-ish include (e.g. "*.ts"). */
  include: z.string().optional(),
  /** Case-insensitive matching. */
  ignoreCase: z.boolean().optional(),
});

type GrepInput = z.infer<typeof GrepInput>;

const MAX_MATCHES = 200;
const MAX_LINE_LENGTH = 500;

export const grepTool: Tool<GrepInput> = {
  name: 'grep',
  description:
    'Search file contents for a regex pattern, worktree-confined. ' +
    'Uses ripgrep when available. Returns up to 200 matches, each line capped at 500 chars.',
  schema: GrepInput,
  parameters: {
    type: 'object',
    required: ['pattern'],
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for.' },
      path: { type: 'string', description: 'Search root, relative to the worktree.' },
      include: {
        type: 'string',
        description: 'Optional glob to filter which files are searched (e.g. "*.ts").',
      },
      ignoreCase: { type: 'boolean', description: 'Case-insensitive matching.' },
    },
    additionalProperties: false,
  },

  async execute(input: GrepInput, ctx: ToolContext): Promise<ToolResult> {
    const searchRoot = input.path ?? '.';
    let rootAbs: string;
    try {
      rootAbs = await assertPathInWorktree(searchRoot, ctx.worktreePath, { mustExist: true });
    } catch (err) {
      /* v8 ignore next -- assertPathInWorktree throws PathGuardError for expected failures */
      if (err instanceof PathGuardError) return { ok: false, error: err.message };
      /* v8 ignore next -- assertPathInWorktree throws PathGuardError for expected failures */
      throw err;
    }

    const useRg = await hasRipgrep();
    if (useRg) {
      return runRipgrep(input, rootAbs);
    }
    return {
      ok: false,
      error:
        'ripgrep (rg) is required for grep tool execution; JavaScript regex fallback is disabled.',
    };
  },
};

let hasRipgrepCache: Promise<boolean> | null = null;

async function hasRipgrep(): Promise<boolean> {
  if (hasRipgrepCache === null) {
    hasRipgrepCache = execFileAsync('rg', ['--version'], { timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
  }
  return hasRipgrepCache;
}

async function runRipgrep(input: GrepInput, rootAbs: string): Promise<ToolResult> {
  const args = [
    '--no-heading',
    '--line-number',
    '--with-filename',
    '--max-count',
    String(MAX_MATCHES),
  ];
  if (input.ignoreCase) args.push('--ignore-case');
  if (input.include) args.push('--glob', input.include);
  args.push('--', input.pattern, rootAbs);

  try {
    const { stdout } = await execFileAsync('rg', args, {
      timeout: 10_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const lines = stdout.split('\n').filter(Boolean).slice(0, MAX_MATCHES);
    const cappedLines = lines.map((line) =>
      line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…` : line,
    );
    const truncated = lines.length >= MAX_MATCHES;
    return {
      ok: true,
      content:
        cappedLines.length === 0
          ? 'No matches.'
          : cappedLines.join('\n') + (truncated ? `\n\n[truncated at ${MAX_MATCHES} matches]` : ''),
      data: { matches: cappedLines.length, truncated, backend: 'rg' },
    };
  } catch (err) {
    // rg exits 1 when nothing matches — normalize that to an empty result
    const e = err as { code?: number; stdout?: string; message?: string };
    if (e.code === 1 && (e.stdout === '' || e.stdout === undefined)) {
      return {
        ok: true,
        content: 'No matches.',
        data: { matches: 0, truncated: false, backend: 'rg' },
      };
    }
    return { ok: false, error: `rg failed: ${e.message ?? 'unknown'}` };
  }
}
