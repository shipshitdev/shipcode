/**
 * Pure functions for parsing CLI NDJSON output (Claude `stream-json` and
 * Codex `--json`).
 *
 * Stateless / buffer-in, value-out. The StreamParser facade composes these
 * with fenced-output parsing; normalizers consume the raw NDJSON stream
 * directly. Splitting them keeps each provider's protocol shapes isolated
 * so changes to one don't ripple through unrelated code.
 */

import { sanitizeResolvedModel, stripAnsi } from '@shipcode/shared';

export { stripAnsi };

export interface CliUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * Best-effort `JSON.parse` that returns `null` on syntax error instead of
 * throwing. Strips ANSI before parsing because PTY output may wrap NDJSON
 * lines with color escapes from CLI status renderers.
 */
function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = stripAnsi(line).trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Claude `--output-format stream-json`: the final `{"type":"result",...}`
 * line carries `usage.input_tokens`, `usage.output_tokens`, and
 * `total_cost_usd`.
 */
export function extractClaudeUsage(buffer: string): CliUsage | null {
  const lines = buffer.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = parseJsonLine(lines[i]);
    if (!parsed) continue;
    if (parsed.type === 'result' && parsed.usage) {
      const usage = parsed.usage as { input_tokens?: number; output_tokens?: number };
      return {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        costUsd: (parsed.total_cost_usd as number) ?? (parsed.cost_usd as number) ?? 0,
      };
    }
  }
  return null;
}

/**
 * Codex `--json`: usage lives on the final
 * `{"type":"response.completed","response":{"usage":{...}}}` event, or
 * occasionally on intermediate `response.output_item.done` lines.
 */
export function extractCodexUsage(buffer: string): CliUsage | null {
  const lines = buffer.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = parseJsonLine(lines[i]);
    if (!parsed) continue;
    const response = parsed.response as { usage?: Record<string, number> } | undefined;
    const usage = response?.usage ?? (parsed.usage as Record<string, number> | undefined);
    if (usage && (usage.input_tokens != null || usage.prompt_tokens != null)) {
      return {
        inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? 0,
        outputTokens: usage.output_tokens ?? usage.completion_tokens ?? 0,
        costUsd: 0, // Codex CLI doesn't report cost_usd
      };
    }
  }
  return null;
}

/** Try Claude first, then Codex. */
export function extractCliUsage(buffer: string): CliUsage | null {
  return extractClaudeUsage(buffer) ?? extractCodexUsage(buffer);
}

/**
 * Claude stream-json: each
 * `{"type":"assistant","message":{"model":"...",...}}` line carries the
 * served model ID (e.g. `claude-sonnet-4-6`).
 */
export function extractClaudeModel(buffer: string): string | null {
  for (const line of buffer.split('\n')) {
    const parsed = parseJsonLine(line);
    if (!parsed) continue;
    const message = parsed.message as { model?: unknown } | undefined;
    if (parsed.type === 'assistant' && typeof message?.model === 'string') {
      return sanitizeResolvedModel(message.model);
    }
  }
  return null;
}

/**
 * Codex `--json`: model resolution events in priority order:
 *   1. `{"type":"response.completed","response":{"model":"..."}}` —
 *      most authoritative; what the OpenAI Responses API actually served.
 *   2. `{"type":"thread.started","model":"..."}` /
 *      `{"type":"session.created","model":"..."}` — initial config.
 */
export function extractCodexModel(buffer: string): string | null {
  const lines = buffer.split('\n');

  for (const line of lines) {
    const parsed = parseJsonLine(line);
    if (!parsed) continue;
    const response = parsed.response as { model?: unknown } | undefined;
    if (parsed.type === 'response.completed' && typeof response?.model === 'string') {
      return sanitizeResolvedModel(response.model);
    }
  }

  for (const line of lines) {
    const parsed = parseJsonLine(line);
    if (!parsed) continue;
    if (
      (parsed.type === 'thread.started' || parsed.type === 'session.created') &&
      typeof parsed.model === 'string'
    ) {
      return sanitizeResolvedModel(parsed.model);
    }
  }

  return null;
}

/**
 * Claude stream-json: the complete LLM text is in the final
 * `{"type":"result","result":"..."}` line. With extended thinking the
 * `result` field may be an array of content blocks instead.
 */
export function extractClaudeText(buffer: string): string | null {
  const lines = buffer.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = parseJsonLine(lines[i]);
    if (!parsed || parsed.type !== 'result') continue;
    if (typeof parsed.result === 'string') return parsed.result;
    if (Array.isArray(parsed.result)) {
      const text = (parsed.result as Array<{ type: string; text?: string }>)
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n');
      if (text) return text;
    }
  }
  return null;
}

/**
 * Codex `--json`: the LLM response is split across `item.completed`
 * `agent_message` events. JSON.parse unescapes the text so downstream
 * fenced-block regexes see real newlines.
 */
export function extractCodexText(buffer: string): string | null {
  const agentTexts: string[] = [];
  for (const line of buffer.split('\n')) {
    const parsed = parseJsonLine(line);
    if (!parsed || parsed.type !== 'item.completed') continue;
    const item = parsed.item as { type?: string; text?: string } | undefined;
    if (item?.type === 'agent_message' && typeof item.text === 'string') {
      agentTexts.push(item.text);
    }
  }
  return agentTexts.length > 0 ? agentTexts.join('\n\n') : null;
}

/**
 * Resolve buffer to LLM text. Tries Claude stream-json first (the result
 * line is the canonical anchor), then Codex agent_message merge, falling
 * back to the raw buffer for plain-text output (execute phase, etc.).
 */
export function resolveCliText(buffer: string): string {
  return extractClaudeText(buffer) ?? extractCodexText(buffer) ?? buffer;
}

/**
 * Strip Claude CLI system/hook NDJSON lines from raw output before
 * storage. These have `"type":"system"` or `"type":"rate_limit_event"`
 * and originate from hooks running inside the subprocess — not LLM output.
 */
export function stripSystemEvents(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      try {
        const parsed = JSON.parse(trimmed) as { type?: string };
        return parsed.type !== 'system' && parsed.type !== 'rate_limit_event';
      } catch {
        return true;
      }
    })
    .join('\n');
}
