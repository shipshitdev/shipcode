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

import type { TerminalEvent } from '../../terminal-events';
import { FenceStateMachine } from './fence-suppression';

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
        summary: `$ ${cmd.length > 60 ? `${cmd.slice(0, 60)}...` : cmd}`,
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
  private lineBuffer = '';
  private readonly fence: FenceStateMachine;
  private readonly onEvent: (event: TerminalEvent) => void;

  constructor(onEvent: (event: TerminalEvent) => void) {
    this.onEvent = onEvent;
    this.fence = new FenceStateMachine(onEvent);
  }

  /**
   * Feed a raw PTY chunk. Lines may be split across chunks.
   */
  feed(chunk: string): void {
    this.lineBuffer += chunk;

    let newlineIdx = this.lineBuffer.indexOf('\n');
    while (newlineIdx !== -1) {
      const line = this.lineBuffer.slice(0, newlineIdx).trim();
      this.lineBuffer = this.lineBuffer.slice(newlineIdx + 1);

      if (!line) {
        newlineIdx = this.lineBuffer.indexOf('\n');
        continue;
      }

      // Try to parse as JSON
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line);
      } catch {
        // Not JSON — could be ANSI escape or raw text leaking from PTY.
        // Forward as raw so it's not lost.
        if (!this.fence.isSuppressing) {
          this.onEvent({ kind: 'raw', content: line });
        }
        newlineIdx = this.lineBuffer.indexOf('\n');
        continue;
      }

      this.processEvent(event);
      newlineIdx = this.lineBuffer.indexOf('\n');
    }
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
