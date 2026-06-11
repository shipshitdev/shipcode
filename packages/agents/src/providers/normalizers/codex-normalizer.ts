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
import { stripAnsi, summarizeTerminalText } from '../output-summary';
import { FenceStateMachine } from './fence-suppression';
import { LineBufferedJsonNormalizer } from './line-buffered-json-normalizer';

export class CodexNormalizer {
  private readonly fence: FenceStateMachine;
  private readonly lines: LineBufferedJsonNormalizer;
  /** Track item IDs that received delta events (for dedup). */
  private deltaItemIds = new Set<string>();
  private readonly onEvent: (event: TerminalEvent) => void;

  constructor(onEvent: (event: TerminalEvent) => void) {
    this.onEvent = onEvent;
    this.fence = new FenceStateMachine(onEvent);
    this.lines = new LineBufferedJsonNormalizer(
      onEvent,
      this.fence,
      (line) => JSON.parse(stripAnsi(line)),
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
    const item = event.item as Record<string, unknown> | undefined;

    // Command execution started → tool_start
    if (event.type === 'item.started' && item?.type === 'command_execution') {
      const cmd = String(item.command ?? '');
      this.onEvent({
        kind: 'tool_start',
        name: 'Bash',
        summary: `$ ${cmd.length > 60 ? `${cmd.slice(0, 60)}...` : cmd}`,
        ...(cmd ? { command: cmd } : {}),
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

        this.fence.feed(delta.text);
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
      if (text) this.fence.feed(text);
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
          ...(code !== 0
            ? { outputSummary: summarizeTerminalText(item.aggregated_output as string | undefined) }
            : {}),
        });
      }
      return;
    }

    // Response completed → done with usage
    if (event.type === 'response.completed') {
      this.fence.flush();
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
