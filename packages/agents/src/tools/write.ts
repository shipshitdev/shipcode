/**
 * Write tool — create a new file or overwrite an existing one.
 *
 * Creates any missing parent directories. Path-confined to the worktree.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { assertPathInWorktree, PathGuardError } from './path-guard';
import type { Tool, ToolContext, ToolResult } from './types';

const WriteInput = z.object({
  path: z.string().min(1),
  content: z.string(),
});

type WriteInput = z.infer<typeof WriteInput>;

export const writeTool: Tool<WriteInput> = {
  name: 'write',
  description:
    'Create a new file or overwrite an existing one with the given content. ' +
    'Missing parent directories are created automatically.',
  schema: WriteInput,
  parameters: {
    type: 'object',
    required: ['path', 'content'],
    properties: {
      path: { type: 'string', description: 'Path to the file, relative to the worktree root.' },
      content: { type: 'string', description: 'Full file contents to write.' },
    },
    additionalProperties: false,
  },

  async execute(input: WriteInput, ctx: ToolContext): Promise<ToolResult> {
    let absPath: string;
    try {
      absPath = await assertPathInWorktree(input.path, ctx.worktreePath);
    } catch (err) {
      if (err instanceof PathGuardError) return { ok: false, error: err.message };
      throw err;
    }

    try {
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, input.content, 'utf-8');
    } catch (err) {
      return { ok: false, error: `failed to write ${input.path}: ${(err as Error).message}` };
    }

    return {
      ok: true,
      content: `Wrote ${input.path} (${input.content.length} bytes)`,
      data: { bytes: input.content.length },
    };
  },
};
