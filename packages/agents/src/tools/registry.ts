/**
 * Tool registry — central catalog of every tool the OpenRouter execute
 * harness exposes to the model.
 *
 * Responsibilities:
 *   - Return the OpenAI function-calling schema list for the
 *     `tools` field of a chat completion request.
 *   - Parse incoming tool-call arguments via the tool's Zod schema and
 *     dispatch to the right tool. Schema failures return a structured
 *     error (not a throw) so the model can see the issue and retry.
 */

import { editTool } from './edit';
import { globTool } from './glob';
import { grepTool } from './grep';
import { readTool } from './read';
import { shellReadOnlyTool } from './shell-readonly';
import type { OpenAIFunctionSchema, Tool, ToolContext, ToolResult } from './types';
import { toOpenAISchema } from './types';
import { writeTool } from './write';

/**
 * Ordered list of tools. Array order also controls the order they appear
 * in the model's `tools` field; we put edit/write first because those
 * are the highest-leverage operations.
 */
const ALL_TOOLS: ReadonlyArray<Tool<unknown>> = [
  editTool as unknown as Tool<unknown>,
  writeTool as unknown as Tool<unknown>,
  readTool as unknown as Tool<unknown>,
  globTool as unknown as Tool<unknown>,
  grepTool as unknown as Tool<unknown>,
  shellReadOnlyTool as unknown as Tool<unknown>,
];

const BY_NAME = new Map<string, Tool<unknown>>(ALL_TOOLS.map((t) => [t.name, t]));

export function getToolSchemas(): OpenAIFunctionSchema[] {
  return ALL_TOOLS.map(toOpenAISchema);
}

/**
 * Parse raw JSON arguments (from the model's tool_call.function.arguments)
 * and dispatch to the named tool. Returns a ToolResult.
 *
 * @param name - Tool name from tool_call.function.name
 * @param rawArgs - JSON string from tool_call.function.arguments. The
 *                  model sometimes emits invalid JSON; we catch and
 *                  return the parse error as a tool failure.
 * @param ctx - ToolContext passed to the tool's execute method.
 */
export async function executeToolCall(
  name: string,
  rawArgs: string,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = BY_NAME.get(name);
  if (!tool) {
    return { ok: false, error: `unknown tool '${name}'` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArgs || '{}');
  } catch (err) {
    return { ok: false, error: `invalid JSON in tool arguments: ${(err as Error).message}` };
  }

  const validation = tool.schema.safeParse(parsed);
  if (!validation.success) {
    return {
      ok: false,
      error: `schema error: ${validation.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
    };
  }

  try {
    return await tool.execute(validation.data, ctx);
  } catch (err) {
    // Tools should not throw for handled conditions. If one does,
    // surface it as a failure so the loop can continue.
    return { ok: false, error: `tool '${name}' threw: ${(err as Error).message}` };
  }
}

/**
 * Stable hash of a tool call, used by the execute harness to detect
 * pathological loops (model calling the same tool with the same args
 * repeatedly).
 */
export function toolCallHash(name: string, rawArgs: string): string {
  // Canonicalize the JSON so whitespace/key-order differences don't
  // bypass the duplicate detector.
  let canon = rawArgs;
  try {
    canon = JSON.stringify(JSON.parse(rawArgs || '{}'), sortedReplacer);
  } catch {
    // fall through with raw
  }
  return `${name}|${canon}`;
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}
