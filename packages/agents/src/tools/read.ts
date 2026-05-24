/**
 * Read tool — read a file's contents, bounded by MAX_READ_BYTES.
 *
 * Supports optional offset + limit for navigating large files without
 * blowing the token budget on one call.
 */

import fs from 'node:fs/promises';
import { MAX_READ_BYTES } from '@shipcode/shared';
import { z } from 'zod';
import { assertPathInWorktree, PathGuardError } from './path-guard';
import type { Tool, ToolContext, ToolResult } from './types';

const ReadInput = z.object({
  path: z.string().min(1),
  /** 1-indexed line offset to start reading from. Defaults to the beginning. */
  offset: z.number().int().min(1).optional(),
  /** Maximum lines to return. Defaults to all lines within MAX_READ_BYTES. */
  limit: z.number().int().min(1).max(10_000).optional(),
});

type ReadInput = z.infer<typeof ReadInput>;

export const readTool: Tool<ReadInput> = {
  name: 'read',
  description:
    'Read a file from the worktree. Returns up to MAX_READ_BYTES of content. ' +
    'Use offset + limit to page through large files.',
  schema: ReadInput,
  parameters: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'Path to the file, relative to the worktree root.' },
      offset: {
        type: 'integer',
        minimum: 1,
        description: '1-indexed line number to start reading from.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 10000,
        description: 'Maximum number of lines to return.',
      },
    },
    additionalProperties: false,
  },

  async execute(input: ReadInput, ctx: ToolContext): Promise<ToolResult> {
    let absPath: string;
    try {
      absPath = await assertPathInWorktree(input.path, ctx.worktreePath, { mustExist: true });
    } catch (err) {
      /* v8 ignore next -- assertPathInWorktree reports validation failures as PathGuardError */
      if (err instanceof PathGuardError) return { ok: false, error: err.message };
      /* v8 ignore next -- assertPathInWorktree reports validation failures as PathGuardError */
      throw err;
    }

    // Check file size first. If it's huge and the caller didn't pass
    // a limit, we still read but truncate; if they did pass a limit we
    // honor it and don't truncate further.
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(absPath);
    } catch (err) {
      return { ok: false, error: `failed to stat ${input.path}: ${(err as Error).message}` };
    }
    if (!stat.isFile()) {
      return { ok: false, error: `${input.path} is not a regular file` };
    }

    let raw: string;
    try {
      const handle = await fs.open(absPath, 'r');
      try {
        const bytesToRead = Math.min(stat.size, MAX_READ_BYTES);
        const buf = Buffer.alloc(bytesToRead);
        const { bytesRead } = await handle.read(buf, 0, bytesToRead, 0);
        const slice = buf.subarray(0, bytesRead);
        // Hard byte cap: if the file is bigger than MAX_READ_BYTES, we
        // truncate the buffer. The model sees a truncation notice appended.
        if (stat.size > MAX_READ_BYTES) {
          raw =
            slice.toString('utf-8') +
            `\n\n[truncated: file is ${stat.size} bytes, returned first ${MAX_READ_BYTES}]`;
        } else {
          raw = slice.toString('utf-8');
        }
      } finally {
        await handle.close();
      }
    } catch (err) {
      return { ok: false, error: `failed to read ${input.path}: ${(err as Error).message}` };
    }

    // Apply line-based offset/limit if provided.
    if (input.offset || input.limit) {
      const lines = raw.split(/\r?\n/);
      const start = (input.offset ?? 1) - 1;
      const end = input.limit ? start + input.limit : lines.length;
      raw = lines.slice(start, end).join('\n');
    }

    return {
      ok: true,
      content: raw,
      data: { bytes: raw.length },
    };
  },
};
