/**
 * Codex CLI NDJSON normalizer.
 *
 * Transforms `codex exec --json` output into canonical TerminalEvents.
 * Handles:
 * - item.started command_execution → tool_start
 * - item.delta text_delta → text (with dedup tracking)
 * - item.completed agent_message → text (suppressed if deltas already emitted)
 * - item.completed command_execution → tool_end with exit code
 * - response.completed → done with usage
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

export class CodexNormalizer {
  private lineBuffer = '';
  private fenceSuppressed = false;
  private deferredFencePrefix = '';
  private suppressedFenceCarry = '';
  /** Track item IDs that received delta events (for dedup). */
  private deltaItemIds = new Set<string>();
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

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line);
      } catch {
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
    const item = event.item as Record<string, unknown> | undefined;

    // Command execution started → tool_start
    if (event.type === 'item.started' && item?.type === 'command_execution') {
      const cmd = String(item.command ?? '');
      this.onEvent({
        kind: 'tool_start',
        name: 'Bash',
        summary: `$ ${cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd}`,
      });
      return;
    }

    // Real-time text streaming
    if (event.type === 'item.delta') {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        // Track that this item got deltas (for dedup with item.completed)
        const itemId = event.item_id as string | undefined;
        if (itemId) this.deltaItemIds.add(itemId);

        this.emitTextFragment(delta.text);
      }
      return;
    }

    // Reasoning summary from Codex model
    if (event.type === 'item.completed' && item?.type === 'reasoning') {
      const text = item.text as string | undefined;
      if (text) {
        this.onEvent({ kind: 'thinking', content: text });
      }
      return;
    }

    // Agent message completed — suppress if deltas already streamed
    if (event.type === 'item.completed' && item?.type === 'agent_message') {
      const itemId = event.item_id as string | undefined;
      if (itemId && this.deltaItemIds.has(itemId)) return; // Already streamed via deltas

      const text = item.text as string | undefined;
      if (text) this.emitTextFragment(text);
      return;
    }

    // Command execution completed → tool_end
    if (event.type === 'item.completed' && item?.type === 'command_execution') {
      const code = item.exit_code as number | null;
      if (code !== null) {
        this.onEvent({
          kind: 'tool_end',
          name: 'Bash',
          exitCode: code,
        });
      }
      return;
    }

    // Response completed → done with usage
    if (event.type === 'response.completed') {
      this.flushDeferredFencePrefix();
      const response = event.response as Record<string, unknown> | undefined;
      const usage = response?.usage as
        | { input_tokens?: number; completion_tokens?: number }
        | undefined;
      this.onEvent({
        kind: 'done',
        totalTokens: usage
          ? { prompt: usage.input_tokens ?? 0, completion: usage.completion_tokens ?? 0 }
          : undefined,
      });
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
