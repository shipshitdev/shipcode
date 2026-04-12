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

const FENCE_ACTIONS: Record<string, { label: string; action: 'open-issue-detail' }> = {
  'shipcode-plan': { label: 'Plan ready', action: 'open-issue-detail' },
  'shipcode-review': { label: 'Review ready', action: 'open-issue-detail' },
  'shipcode-verification': { label: 'Verification complete', action: 'open-issue-detail' },
};
const FENCE_RE = new RegExp('```(' + Object.keys(FENCE_ACTIONS).join('|') + ')');

function formatToolCall(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read':
      return `Read ${input.file_path ?? ''}`;
    case 'Write':
      return `Write ${input.file_path ?? ''}`;
    case 'Edit':
      return `Edit ${input.file_path ?? ''}`;
    case 'Glob':
      return `Glob ${input.pattern ?? ''}`;
    case 'Grep':
      return `Grep "${input.pattern ?? ''}"${input.path ? ` in ${input.path}` : ''}`;
    case 'Bash': {
      const cmd = String(input.command ?? '');
      return `$ ${cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd}`;
    }
    default: {
      const first = Object.values(input)[0];
      return first ? `${name}: ${String(first).slice(0, 60)}` : name;
    }
  }
}

export class ClaudeNormalizer {
  private lineBuffer = '';
  private fenceSuppressed = false;
  private readonly onEvent: (event: TerminalEvent) => void;

  constructor(onEvent: (event: TerminalEvent) => void) {
    this.onEvent = onEvent;
  }

  /**
   * Feed a raw PTY chunk. Lines may be split across chunks.
   */
  feed(chunk: string): void {
    this.lineBuffer += chunk;

    let newlineIdx: number;
    while ((newlineIdx = this.lineBuffer.indexOf('\n')) !== -1) {
      const line = this.lineBuffer.slice(0, newlineIdx).trim();
      this.lineBuffer = this.lineBuffer.slice(newlineIdx + 1);

      if (!line) continue;

      // Try to parse as JSON
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line);
      } catch {
        // Not JSON — could be ANSI escape or raw text leaking from PTY.
        // Forward as raw so it's not lost.
        if (!this.fenceSuppressed) {
          this.onEvent({ kind: 'raw', content: line });
        }
        continue;
      }

      this.processEvent(event);
    }
  }

  private processEvent(event: Record<string, unknown>): void {
    // Skip system events and rate limit noise
    if (event.type === 'system' || event.type === 'rate_limit_event') return;

    // Result line → done event
    if (event.type === 'result') {
      const usage = event.usage as
        | { input_tokens?: number; output_tokens?: number }
        | undefined;
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
          // Check for fenced block
          const fenceMatch = FENCE_RE.exec(c.text);
          if (fenceMatch) {
            const tag = fenceMatch[1];
            this.fenceSuppressed = true;
            const act = FENCE_ACTIONS[tag];
            this.onEvent({ kind: 'action', label: act.label, action: act.action });
            continue;
          }

          if (!this.fenceSuppressed) {
            this.onEvent({ kind: 'text', content: c.text });
          }
        } else if (c.type === 'tool_use') {
          const name = c.name as string;
          const input = (c.input ?? {}) as Record<string, unknown>;
          this.onEvent({
            kind: 'tool_start',
            name,
            summary: formatToolCall(name, input),
          });
        }
      }
    }
  }
}
