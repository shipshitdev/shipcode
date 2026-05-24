import { describe, expect, it } from 'vitest';
import { renderTerminalEvent } from './render-terminal-event';

describe('renderTerminalEvent', () => {
  it('renders text, thinking, lifecycle, and error events', () => {
    expect(renderTerminalEvent({ kind: 'text', content: 'hello\nworld' })).toContain('hello');
    expect(renderTerminalEvent({ kind: 'thinking', content: 'considering' })).toContain(
      'considering',
    );
    expect(renderTerminalEvent({ kind: 'lifecycle', message: 'starting' })).toBe('starting');
    expect(renderTerminalEvent({ kind: 'error', message: 'boom' })).toContain('boom');
  });

  it('renders tool and turn summaries', () => {
    expect(
      renderTerminalEvent({ kind: 'tool_start', name: 'bash', summary: 'Running bash' }),
    ).toContain('Running bash');
    expect(
      renderTerminalEvent({
        kind: 'tool_end',
        name: 'bash',
        exitCode: 2,
        outputSummary: 'TypeError: expected string, got undefined',
      }),
    ).toContain('TypeError: expected string, got undefined');
    expect(renderTerminalEvent({ kind: 'tool_end', name: 'bash', durationMs: 1500 })).toContain(
      '(1.5s)',
    );
    expect(renderTerminalEvent({ kind: 'turn_start', turn: 3 })).toContain('Turn 3');
    expect(
      renderTerminalEvent({
        kind: 'turn_end',
        turn: 3,
        tokensUsed: { prompt: 10, completion: 5 },
        costUsd: 0.1234,
      }),
    ).toContain('10+5 tok');
  });

  it('handles rate-limited raw output, completion summaries, and null-only cases', () => {
    expect(
      renderTerminalEvent({
        kind: 'raw',
        content: 'Rate limit exceeded, please retry later',
      }),
    ).toContain('Rate limit exceeded');
    expect(
      renderTerminalEvent({
        kind: 'done',
        totalTokens: { prompt: 20, completion: 8 },
        totalCostUsd: 0.4321,
      }),
    ).toContain('[done: 20+8 tok');

    expect(
      renderTerminalEvent({ kind: 'action', label: 'Open issue', action: 'open-issue-detail' }),
    ).toBeNull();
    expect(renderTerminalEvent({ kind: 'tool_end', name: 'bash' })).toBeNull();
    expect(renderTerminalEvent({ kind: 'done' })).toBeNull();
  });
});
