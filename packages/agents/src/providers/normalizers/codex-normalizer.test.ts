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

  it('includes a failure summary for failed command executions', () => {
    const events = normalize([
      JSON.stringify({
        type: 'item.started',
        item: { type: 'command_execution', command: 'bun test apps/api/src/reference-portals' },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'command_execution',
          exit_code: 1,
          aggregated_output:
            'FAIL apps/api/src/reference-portals/index.test.ts\nError: Cannot find module ./reference-portals.service',
        },
      }),
    ]);

    expect(events).toEqual([
      {
        kind: 'tool_start',
        name: 'Bash',
        summary: '$ bun test apps/api/src/reference-portals',
      },
      {
        kind: 'tool_end',
        name: 'Bash',
        exitCode: 1,
        outputSummary:
          'FAIL apps/api/src/reference-portals/index.test.ts\nError: Cannot find module ./reference-portals.service',
      },
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

  it('suppresses structured fences even when the opening tag is split across deltas', () => {
    const events = normalize([
      JSON.stringify({
        type: 'item.delta',
        item_id: 'msg-1',
        delta: { type: 'text_delta', text: 'Before fence\n```ship' },
      }),
      JSON.stringify({
        type: 'item.delta',
        item_id: 'msg-1',
        delta: { type: 'text_delta', text: 'code-plan\n{"id":"p1"}' },
      }),
      JSON.stringify({
        type: 'item.delta',
        item_id: 'msg-1',
        delta: { type: 'text_delta', text: '\n```\nAfter fence' },
      }),
    ]);

    expect(events).toEqual([
      { kind: 'text', content: 'Before fence\n' },
      { kind: 'action', label: 'Plan drafted', action: 'open-issue-detail' },
      { kind: 'text', content: '\nAfter fence' },
    ]);
  });
});
