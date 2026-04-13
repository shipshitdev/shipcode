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
});
