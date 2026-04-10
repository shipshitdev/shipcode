/**
 * Edit tool — in-place string replacement.
 *
 * Modeled after Claude Code's Edit tool: require `oldString` to match
 * exactly once unless `replaceAll` is true. Rejects ambiguous edits so
 * the model has to disambiguate with more context instead of silently
 * editing the wrong spot.
 */

import fs from 'node:fs/promises';
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './types';
import { assertPathInWorktree, PathGuardError } from './path-guard';

const EditInput = z.object({
  path: z.string().min(1),
  oldString: z.string(),
  newString: z.string(),
  replaceAll: z.boolean().optional(),
});

type EditInput = z.infer<typeof EditInput>;

export const editTool: Tool<EditInput> = {
  name: 'edit',
  description:
    'Modify a file by replacing one occurrence of oldString with newString. ' +
    'Set replaceAll: true to replace every occurrence. The file must already exist.',
  schema: EditInput,
  parameters: {
    type: 'object',
    required: ['path', 'oldString', 'newString'],
    properties: {
      path: { type: 'string', description: 'Path to the file, relative to the worktree root.' },
      oldString: {
        type: 'string',
        description: 'Text to find. Must match exactly once unless replaceAll is set.',
      },
      newString: { type: 'string', description: 'Text to substitute in place of oldString.' },
      replaceAll: {
        type: 'boolean',
        description: 'Replace every occurrence instead of requiring a unique match.',
      },
    },
    additionalProperties: false,
  },

  async execute(input: EditInput, ctx: ToolContext): Promise<ToolResult> {
    let absPath: string;
    try {
      absPath = await assertPathInWorktree(input.path, ctx.worktreePath, { mustExist: true });
    } catch (err) {
      if (err instanceof PathGuardError) return { ok: false, error: err.message };
      throw err;
    }

    let content: string;
    try {
      content = await fs.readFile(absPath, 'utf-8');
    } catch (err) {
      return { ok: false, error: `failed to read ${input.path}: ${(err as Error).message}` };
    }

    if (input.oldString === input.newString) {
      return { ok: false, error: 'oldString and newString are identical' };
    }

    if (!content.includes(input.oldString)) {
      return { ok: false, error: `oldString not found in ${input.path}` };
    }

    let updated: string;
    if (input.replaceAll) {
      updated = content.split(input.oldString).join(input.newString);
    } else {
      const first = content.indexOf(input.oldString);
      const last = content.lastIndexOf(input.oldString);
      if (first !== last) {
        return {
          ok: false,
          error:
            `oldString appears multiple times in ${input.path}. ` +
            `Either include more surrounding context to make it unique, or pass replaceAll: true.`,
        };
      }
      updated =
        content.slice(0, first) + input.newString + content.slice(first + input.oldString.length);
    }

    try {
      await fs.writeFile(absPath, updated, 'utf-8');
    } catch (err) {
      return { ok: false, error: `failed to write ${input.path}: ${(err as Error).message}` };
    }

    return {
      ok: true,
      content: `Updated ${input.path} (${content.length} → ${updated.length} bytes)`,
      data: { bytesBefore: content.length, bytesAfter: updated.length },
    };
  },
};
