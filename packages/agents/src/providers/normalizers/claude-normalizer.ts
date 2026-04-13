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
  'shipcode-plan': { label: 'Plan drafted', action: 'open-issue-detail' },
  'shipcode-review': { label: 'AI review complete', action: 'open-issue-detail' },
  'shipcode-verification': { label: 'Verification complete', action: 'open-issue-detail' },
};
type FenceTag = keyof typeof FENCE_ACTIONS;

const OPENING_FENCES = (Object.keys(FENCE_ACTIONS) as FenceTag[]).map((tag) => ({
  marker: `\`\`\`${tag}`,
  tag,
}));

function findOpeningFence(text: string): { index: number; length: number; tag: FenceTag } | null {
  let match: { index: number; length: number; tag: FenceTag } | null = null;

  for (const { marker, tag } of OPENING_FENCES) {
    const index = text.indexOf(marker);
    if (index !== -1 && (!match || index < match.index)) {
      match = { index, length: marker.length, tag };
    }
  }

  return match;
}

function getDeferredFencePrefix(text: string): string {
  let longest = '';

  for (const { marker } of OPENING_FENCES) {
    const maxLength = Math.min(marker.length - 1, text.length);
    for (let length = maxLength; length > longest.length; length--) {
      const suffix = text.slice(-length);
      if (marker.startsWith(suffix)) {
        longest = suffix;
        break;
      }
    }
  }

  return longest;
}

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
      return `$ ${cmd.length > 60 ? `${cmd.slice(0, 60)}...` : cmd}`;
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
  private deferredFencePrefix = '';
  private suppressedFenceCarry = '';
  private readonly onEvent: (event: TerminalEvent) => void;

  constructor(onEvent: (event: TerminalEvent) => void) {
    this.onEvent = onEvent;
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
        if (!this.fenceSuppressed) {
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
      this.flushDeferredFencePrefix();
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
          this.emitTextFragment(c.text);
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

  private flushDeferredFencePrefix(): void {
    if (!this.fenceSuppressed && this.deferredFencePrefix) {
      this.onEvent({ kind: 'text', content: this.deferredFencePrefix });
      this.deferredFencePrefix = '';
    }
  }

  private emitTextFragment(fragment: string): void {
    let remaining = this.deferredFencePrefix + fragment;
    this.deferredFencePrefix = '';

    while (remaining) {
      if (this.fenceSuppressed) {
        remaining = this.consumeSuppressedFragment(remaining);
        continue;
      }

      const openingFence = findOpeningFence(remaining);
      if (!openingFence) {
        const deferredPrefix = getDeferredFencePrefix(remaining);
        const visibleText = deferredPrefix ? remaining.slice(0, -deferredPrefix.length) : remaining;
        if (visibleText) {
          this.onEvent({ kind: 'text', content: visibleText });
        }
        this.deferredFencePrefix = deferredPrefix;
        return;
      }

      const visibleText = remaining.slice(0, openingFence.index);
      if (visibleText) {
        this.onEvent({ kind: 'text', content: visibleText });
      }

      this.fenceSuppressed = true;
      this.suppressedFenceCarry = '';
      const action = FENCE_ACTIONS[openingFence.tag];
      this.onEvent({ kind: 'action', label: action.label, action: action.action });
      remaining = remaining.slice(openingFence.index + openingFence.length);
    }
  }

  private consumeSuppressedFragment(fragment: string): string {
    const combined = this.suppressedFenceCarry + fragment;
    const closingFenceIndex = combined.indexOf('```');

    if (closingFenceIndex === -1) {
      this.suppressedFenceCarry = combined.slice(-2);
      return '';
    }

    this.fenceSuppressed = false;
    this.suppressedFenceCarry = '';
    return combined.slice(closingFenceIndex + 3);
  }
}
