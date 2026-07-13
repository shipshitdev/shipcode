/**
 * Claude CLI NDJSON normalizer.
 *
 * Transforms `claude -p --output-format stream-json` output into
 * canonical TerminalEvents. Handles:
 * - assistant text blocks → text events
 * - tool_use entries → tool_start events
 * - result line → done event
 * - fenced block suppression (shipcode-plan, etc.)
 * - partial line buffering across PTY chunk boundaries
 */

import { truncate } from '@shipcode/shared';
import type { TerminalEvent } from '../../terminal-events';
import { FenceStateMachine } from './fence-suppression';
import { LineBufferedJsonNormalizer } from './line-buffered-json-normalizer';

interface ToolCallResult {
  summary: string;
  command?: string;
  filePath?: string;
  pattern?: string;
}

function formatToolCall(name: string, input: Record<string, unknown>): ToolCallResult {
  switch (name) {
    case 'Read':
      return { summary: `Read ${input.file_path ?? ''}`, filePath: String(input.file_path ?? '') };
    case 'Write':
      return { summary: `Write ${input.file_path ?? ''}`, filePath: String(input.file_path ?? '') };
    case 'Edit':
      return { summary: `Edit ${input.file_path ?? ''}`, filePath: String(input.file_path ?? '') };
    case 'Glob':
      return { summary: `Glob ${input.pattern ?? ''}`, pattern: String(input.pattern ?? '') };
    case 'Grep': {
      const pat = String(input.pattern ?? '');
      const path = input.path ? String(input.path) : undefined;
      return {
        summary: `Grep "${pat}"${path ? ` in ${path}` : ''}`,
        pattern: pat,
        filePath: path,
      };
    }
    case 'Bash': {
      const cmd = String(input.command ?? '');
      return {
        summary: `$ ${truncate(cmd, 60, '...')}`,
        command: cmd,
      };
    }
    default: {
      const first = Object.values(input)[0];
      return { summary: first ? `${name}: ${String(first).slice(0, 60)}` : name };
    }
  }
}

export class ClaudeNormalizer {
  private readonly fence: FenceStateMachine;
  private readonly lines: LineBufferedJsonNormalizer;
  private readonly onEvent: (event: TerminalEvent) => void;

  constructor(onEvent: (event: TerminalEvent) => void) {
    this.onEvent = onEvent;
    this.fence = new FenceStateMachine(onEvent);
    this.lines = new LineBufferedJsonNormalizer(
      onEvent,
      this.fence,
      (line) => JSON.parse(line),
      (event) => this.processEvent(event),
    );
  }

  /**
   * Feed a raw PTY chunk. Lines may be split across chunks.
   */
  feed(chunk: string): void {
    this.lines.feed(chunk);
  }

  private processEvent(event: Record<string, unknown>): void {
    // Skip system events and rate limit noise
    if (event.type === 'system' || event.type === 'rate_limit_event') return;

    // Result line → done event
    if (event.type === 'result') {
      this.fence.flush();
      const usage = event.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      const cost = event.total_cost_usd as number | undefined;
      this.onEvent({
        kind: 'done',
        totalTokens: usage
          ? { prompt: usage.input_tokens ?? 0, completion: usage.output_tokens ?? 0 }
          : undefined,
        totalCostUsd: cost ?? undefined,
      });
      return;
    }

    // Assistant message with content array
    if (event.type === 'assistant') {
      const content = (event.message as Record<string, unknown>)?.content;
      if (!Array.isArray(content)) return;

      for (const c of content as Record<string, unknown>[]) {
        if (c.type === 'thinking' && typeof c.thinking === 'string') {
          this.onEvent({ kind: 'thinking', content: c.thinking });
          continue;
        }
        if (c.type === 'text' && typeof c.text === 'string') {
          this.fence.feed(c.text);
        } else if (c.type === 'tool_use') {
          const name = c.name as string;
          const input = (c.input ?? {}) as Record<string, unknown>;
          const { summary, command, filePath, pattern } = formatToolCall(name, input);
          this.onEvent({
            kind: 'tool_start',
            name,
            summary,
            ...(command ? { command } : {}),
            ...(filePath ? { filePath } : {}),
            ...(pattern ? { pattern } : {}),
          });
        }
      }
    }
  }
}
