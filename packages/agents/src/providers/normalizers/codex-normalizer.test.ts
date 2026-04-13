import { describe, expect, it } from 'vitest';
import type { TerminalEvent } from '../../terminal-events';
import { CodexNormalizer } from './codex-normalizer';

function normalize(lines: string[]): TerminalEvent[] {
  const events: TerminalEvent[] = [];
  const normalizer = new CodexNormalizer((event) => events.push(event));

  for (const line of lines) {
    normalizer.feed(`${line}\n`);
  }

  return events;
}

describe('CodexNormalizer', () => {
  it('emits tool_end for successful command executions', () => {
    const events = normalize([
      JSON.stringify({
        type: 'item.started',
        item: { type: 'command_execution', command: 'echo ok' },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'command_execution', exit_code: 0 },
      }),
    ]);

    expect(events).toEqual([
      { kind: 'tool_start', name: 'Bash', summary: '$ echo ok' },
      { kind: 'tool_end', name: 'Bash', exitCode: 0 },
    ]);
  });

  it('still suppresses duplicate agent_message text after deltas', () => {
    const events = normalize([
      JSON.stringify({
        type: 'item.delta',
        item_id: 'msg-1',
        delta: { type: 'text_delta', text: 'hello' },
      }),
      JSON.stringify({
        type: 'item.completed',
        item_id: 'msg-1',
        item: { type: 'agent_message', text: 'hello' },
      }),
    ]);

    expect(events).toEqual([{ kind: 'text', content: 'hello' }]);
  });
});
