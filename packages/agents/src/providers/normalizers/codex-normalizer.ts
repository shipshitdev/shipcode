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

const FENCE_TAGS: Record<string, string> = {
  'shipcode-plan': '[Plan ready -- open Issue Detail to view]',
  'shipcode-review': '[Review ready -- open Issue Detail to view]',
  'shipcode-verification': '[Verification complete -- open Issue Detail to view]',
};
const FENCE_RE = new RegExp('```(' + Object.keys(FENCE_TAGS).join('|') + ')');

export class CodexNormalizer {
  private lineBuffer = '';
  private fenceSuppressed = false;
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

    let newlineIdx: number;
    while ((newlineIdx = this.lineBuffer.indexOf('\n')) !== -1) {
      const line = this.lineBuffer.slice(0, newlineIdx).trim();
      this.lineBuffer = this.lineBuffer.slice(newlineIdx + 1);

      if (!line) continue;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line);
      } catch {
        if (!this.fenceSuppressed) {
          this.onEvent({ kind: 'raw', content: line });
        }
        continue;
      }

      this.processEvent(event);
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

        // Check for fenced block
        const fenceMatch = FENCE_RE.exec(delta.text);
        if (fenceMatch) {
          const tag = fenceMatch[1];
          this.fenceSuppressed = true;
          this.onEvent({ kind: 'text', content: FENCE_TAGS[tag] });
          return;
        }

        if (!this.fenceSuppressed) {
          this.onEvent({ kind: 'text', content: delta.text });
        }
      }
      return;
    }

    // Agent message completed — suppress if deltas already streamed
    if (event.type === 'item.completed' && item?.type === 'agent_message') {
      const itemId = event.item_id as string | undefined;
      if (itemId && this.deltaItemIds.has(itemId)) return; // Already streamed via deltas

      const text = item.text as string | undefined;
      if (text && !this.fenceSuppressed) {
        this.onEvent({ kind: 'text', content: text });
      }
      return;
    }

    // Command execution completed → tool_end with exit code
    if (event.type === 'item.completed' && item?.type === 'command_execution') {
      const code = item.exit_code as number | null;
      this.onEvent({
        kind: 'tool_end',
        name: 'Bash',
        exitCode: code ?? undefined,
      });
      return;
    }

    // Response completed → done with usage
    if (event.type === 'response.completed') {
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
}
