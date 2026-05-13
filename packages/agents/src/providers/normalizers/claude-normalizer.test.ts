import { describe, expect, it } from 'vitest';
import type { TerminalEvent } from '../../terminal-events';
import { ClaudeNormalizer } from './claude-normalizer';

function normalize(lines: string[]): TerminalEvent[] {
  const events: TerminalEvent[] = [];
  const normalizer = new ClaudeNormalizer((event) => events.push(event));

  for (const line of lines) {
    normalizer.feed(`${line}\n`);
  }

  return events;
}

describe('ClaudeNormalizer', () => {
  it('buffers partial lines, emits raw non-json lines, and skips system noise', () => {
    const events: TerminalEvent[] = [];
    const normalizer = new ClaudeNormalizer((event) => events.push(event));

    normalizer.feed('\n');
    normalizer.feed('raw line\n');
    normalizer.feed(JSON.stringify({ type: 'system' }));
    normalizer.feed('\n');
    normalizer.feed(JSON.stringify({ type: 'rate_limit_event' }));
    normalizer.feed('\n');
    normalizer.feed('{"type":"assistant","message":{"content":[{"type":"text","text":"split');
    normalizer.feed(' text"}]}}\n');

    expect(events).toEqual([
      { kind: 'raw', content: 'raw line' },
      { kind: 'text', content: 'split text' },
    ]);
  });

  it('emits thinking, result metadata, and formatted tool calls', () => {
    const longCommand = `bun test ${'x'.repeat(80)}`;
    const events = normalize([
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'checking repository state' },
            { type: 'tool_use', name: 'Read', input: { file_path: 'src/index.ts' } },
            { type: 'tool_use', name: 'Write', input: { file_path: 'src/out.ts' } },
            { type: 'tool_use', name: 'Edit', input: { file_path: 'src/out.ts' } },
            { type: 'tool_use', name: 'Glob', input: { pattern: '**/*.ts' } },
            { type: 'tool_use', name: 'Grep', input: { pattern: 'needle', path: 'src' } },
            { type: 'tool_use', name: 'Bash', input: { command: longCommand } },
            { type: 'tool_use', name: 'TodoWrite', input: { todos: 3 } },
            { type: 'tool_use', name: 'EmptyTool', input: {} },
          ],
        },
      }),
      JSON.stringify({
        type: 'result',
        usage: { input_tokens: 10, output_tokens: 20 },
        total_cost_usd: 0.12,
      }),
      JSON.stringify({ type: 'result' }),
    ]);

    expect(events).toEqual([
      { kind: 'thinking', content: 'checking repository state' },
      { kind: 'tool_start', name: 'Read', summary: 'Read src/index.ts', filePath: 'src/index.ts' },
      { kind: 'tool_start', name: 'Write', summary: 'Write src/out.ts', filePath: 'src/out.ts' },
      { kind: 'tool_start', name: 'Edit', summary: 'Edit src/out.ts', filePath: 'src/out.ts' },
      { kind: 'tool_start', name: 'Glob', summary: 'Glob **/*.ts', pattern: '**/*.ts' },
      {
        kind: 'tool_start',
        name: 'Grep',
        summary: 'Grep "needle" in src',
        pattern: 'needle',
        filePath: 'src',
      },
      {
        kind: 'tool_start',
        name: 'Bash',
        summary: `$ ${longCommand.slice(0, 60)}...`,
        command: longCommand,
      },
      { kind: 'tool_start', name: 'TodoWrite', summary: 'TodoWrite: 3' },
      { kind: 'tool_start', name: 'EmptyTool', summary: 'EmptyTool' },
      { kind: 'done', totalTokens: { prompt: 10, completion: 20 }, totalCostUsd: 0.12 },
      { kind: 'done', totalTokens: undefined, totalCostUsd: undefined },
    ]);
  });

  it('formats tool calls with missing optional inputs', () => {
    const events = normalize([
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Read', input: {} },
            { type: 'tool_use', name: 'Write', input: {} },
            { type: 'tool_use', name: 'Edit', input: {} },
            { type: 'tool_use', name: 'Glob', input: {} },
            { type: 'tool_use', name: 'Grep', input: {} },
            { type: 'tool_use', name: 'Bash', input: {} },
          ],
        },
      }),
    ]);

    expect(events).toEqual([
      { kind: 'tool_start', name: 'Read', summary: 'Read ' },
      { kind: 'tool_start', name: 'Write', summary: 'Write ' },
      { kind: 'tool_start', name: 'Edit', summary: 'Edit ' },
      { kind: 'tool_start', name: 'Glob', summary: 'Glob ' },
      { kind: 'tool_start', name: 'Grep', summary: 'Grep ""' },
      { kind: 'tool_start', name: 'Bash', summary: '$ ' },
    ]);
  });

  it('ignores assistant messages without content arrays', () => {
    expect(
      normalize([
        JSON.stringify({ type: 'assistant', message: { content: null } }),
        JSON.stringify({ type: 'assistant', message: {} }),
      ]),
    ).toEqual([]);
  });

  it('emits a raw line for non-assistant events that are not JSON protocol noise', () => {
    expect(normalize([JSON.stringify({ type: 'user', message: 'ignored' })])).toEqual([]);
  });

  it('defaults missing output tokens in result usage', () => {
    expect(normalize([JSON.stringify({ type: 'result', usage: { input_tokens: 7 } })])).toEqual([
      { kind: 'done', totalTokens: { prompt: 7, completion: 0 }, totalCostUsd: undefined },
    ]);
  });

  it('defaults missing input tokens and ignores malformed text blocks', () => {
    const events = normalize([
      JSON.stringify({ type: 'result', usage: { output_tokens: 9 } }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text' }, { type: 'tool_use', name: 'NoInputTool' }],
        },
      }),
    ]);

    expect(events).toEqual([
      { kind: 'done', totalTokens: { prompt: 0, completion: 9 }, totalCostUsd: undefined },
      { kind: 'tool_start', name: 'NoInputTool', summary: 'NoInputTool' },
    ]);
  });

  it('suppresses structured fences even when the opening tag is split across assistant chunks', () => {
    const events = normalize([
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Before fence\n```ship' }],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'code-review\n{"decision":"approve"}' }],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: '\n```\nAfter fence' }],
        },
      }),
    ]);

    expect(events).toEqual([
      { kind: 'text', content: 'Before fence\n' },
      { kind: 'action', label: 'AI review complete', action: 'open-issue-detail' },
      { kind: 'text', content: '\nAfter fence' },
    ]);
  });

  it('suppresses raw non-json lines while inside a structured fence', () => {
    const events: TerminalEvent[] = [];
    const normalizer = new ClaudeNormalizer((event) => events.push(event));

    normalizer.feed(
      `${JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: '```shipcode-review\n{"decision":"approve"}' }],
        },
      })}\n`,
    );
    normalizer.feed('raw leak from cli\n');
    normalizer.feed(
      `${JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: '\n```\nvisible' }],
        },
      })}\n`,
    );

    expect(events).toEqual([
      { kind: 'action', label: 'AI review complete', action: 'open-issue-detail' },
      { kind: 'text', content: '\nvisible' },
    ]);
  });
});
