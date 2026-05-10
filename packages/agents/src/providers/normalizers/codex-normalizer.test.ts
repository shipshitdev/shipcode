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
  it('buffers partial lines, strips ansi for JSON parsing, and emits raw non-json lines', () => {
    const events: TerminalEvent[] = [];
    const normalizer = new CodexNormalizer((event) => events.push(event));

    normalizer.feed('\n');
    normalizer.feed('raw line\n');
    normalizer.feed('\u001B[32m{"type":"item.completed","item":{"type":"reasoning","text":"');
    normalizer.feed('thought"}}\u001B[0m\n');

    expect(events).toEqual([
      { kind: 'raw', content: 'raw line' },
      { kind: 'thinking', content: 'thought' },
    ]);
  });

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

  it('formats missing and long command starts', () => {
    const longCommand = `bun test ${'x'.repeat(80)}`;
    const events = normalize([
      JSON.stringify({
        type: 'item.started',
        item: { type: 'command_execution' },
      }),
      JSON.stringify({
        type: 'item.started',
        item: { type: 'command_execution', command: longCommand },
      }),
    ]);

    expect(events).toEqual([
      { kind: 'tool_start', name: 'Bash', summary: '$ ' },
      { kind: 'tool_start', name: 'Bash', summary: `$ ${longCommand.slice(0, 60)}...` },
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

  it('emits completed agent messages without deltas and response usage', () => {
    const events = normalize([
      JSON.stringify({
        type: 'item.completed',
        item_id: 'msg-2',
        item: { type: 'agent_message', text: 'completed text' },
      }),
      JSON.stringify({
        type: 'response.completed',
        response: { usage: { input_tokens: 11, completion_tokens: 22 } },
      }),
      JSON.stringify({ type: 'response.completed' }),
    ]);

    expect(events).toEqual([
      { kind: 'text', content: 'completed text' },
      { kind: 'done', totalTokens: { prompt: 11, completion: 22 } },
      { kind: 'done', totalTokens: undefined },
    ]);
  });

  it('ignores unsupported deltas and command completions without exit codes', () => {
    const events = normalize([
      JSON.stringify({
        type: 'item.delta',
        item_id: 'msg-1',
        delta: { type: 'metadata_delta', text: 'ignored' },
      }),
      JSON.stringify({
        type: 'item.delta',
        delta: { type: 'text_delta', text: 'nameless delta' },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'command_execution', exit_code: null },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'reasoning' },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message' },
      }),
      JSON.stringify({ type: 'unknown.event' }),
    ]);

    expect(events).toEqual([{ kind: 'text', content: 'nameless delta' }]);
  });

  it('defaults missing response usage token counts', () => {
    const events = normalize([
      JSON.stringify({
        type: 'response.completed',
        response: { usage: {} },
      }),
    ]);

    expect(events).toEqual([{ kind: 'done', totalTokens: { prompt: 0, completion: 0 } }]);
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

  it('suppresses raw non-json lines while inside a structured fence', () => {
    const events: TerminalEvent[] = [];
    const normalizer = new CodexNormalizer((event) => events.push(event));

    normalizer.feed(
      `${JSON.stringify({
        type: 'item.delta',
        delta: { type: 'text_delta', text: '```shipcode-plan\n{"id":"plan-1"}' },
      })}\n`,
    );
    normalizer.feed('raw leak from cli\n');
    normalizer.feed(
      `${JSON.stringify({
        type: 'item.delta',
        delta: { type: 'text_delta', text: '\n```\nvisible' },
      })}\n`,
    );

    expect(events).toEqual([
      { kind: 'action', label: 'Plan drafted', action: 'open-issue-detail' },
      { kind: 'text', content: '\nvisible' },
    ]);
  });
});
