import { describe, expect, it } from 'vitest';
import {
  extractClaudeModel,
  extractCliUsage,
  extractCodexModel,
  resolveCliText,
  stripSystemEvents,
} from './cli-ndjson';

describe('cli-ndjson parser helpers', () => {
  it('extracts Claude usage defaults and legacy cost fields', () => {
    expect(
      extractCliUsage(
        JSON.stringify({
          type: 'result',
          usage: {},
          cost_usd: 0.42,
        }),
      ),
    ).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0.42 });

    expect(
      extractCliUsage(
        JSON.stringify({
          type: 'result',
          usage: { input_tokens: 8 },
        }),
      ),
    ).toEqual({ inputTokens: 8, outputTokens: 0, costUsd: 0 });
  });

  it('extracts Codex usage from direct usage objects and completion-token aliases', () => {
    expect(
      extractCliUsage(
        JSON.stringify({
          type: 'response.output_item.done',
          usage: { prompt_tokens: 3, completion_tokens: 4 },
        }),
      ),
    ).toEqual({ inputTokens: 3, outputTokens: 4, costUsd: 0 });

    expect(
      extractCliUsage(
        JSON.stringify({
          response: { usage: { input_tokens: 5 } },
        }),
      ),
    ).toEqual({ inputTokens: 5, outputTokens: 0, costUsd: 0 });
  });

  it('sanitizes Claude and Codex model identifiers from protocol events', () => {
    expect(
      extractClaudeModel(
        JSON.stringify({
          type: 'assistant',
          message: { model: 'claude-sonnet-4-6' },
        }),
      ),
    ).toBe('claude-sonnet-4-6');

    expect(
      extractCodexModel(
        JSON.stringify({
          type: 'session.created',
          model: 'gpt-5.4-mini',
        }),
      ),
    ).toBe('gpt-5.4-mini');

    expect(extractClaudeModel(JSON.stringify({ type: 'assistant', message: {} }))).toBeNull();
  });

  it('extracts Claude result text arrays and Codex completed agent messages', () => {
    expect(
      resolveCliText(
        JSON.stringify({
          type: 'result',
          result: [
            { type: 'thinking', text: 'hidden' },
            { type: 'text', text: 'visible one' },
            { type: 'text', text: 'visible two' },
          ],
        }),
      ),
    ).toBe('visible one\nvisible two');

    expect(
      resolveCliText(
        JSON.stringify({
          type: 'result',
          result: [{ type: 'thinking', text: 'hidden' }],
        }),
      ),
    ).toBe(JSON.stringify({ type: 'result', result: [{ type: 'thinking', text: 'hidden' }] }));

    expect(
      resolveCliText(
        JSON.stringify({
          type: 'result',
          result: { type: 'text', text: 'not an array' },
        }),
      ),
    ).toBe(JSON.stringify({ type: 'result', result: { type: 'text', text: 'not an array' } }));

    expect(
      resolveCliText(
        [
          JSON.stringify({
            type: 'item.completed',
            item: { type: 'agent_message', text: 'first' },
          }),
          JSON.stringify({
            type: 'item.completed',
            item: { type: 'agent_message', text: 'second' },
          }),
        ].join('\n'),
      ),
    ).toBe('first\n\nsecond');
  });

  it('falls back to raw text and strips only system protocol events', () => {
    expect(resolveCliText('plain output')).toBe('plain output');
    expect(
      stripSystemEvents(
        [
          '',
          JSON.stringify({ type: 'system', message: 'ignore' }),
          JSON.stringify({ type: 'rate_limit_event', message: 'ignore' }),
          JSON.stringify({ type: 'result', result: 'keep' }),
          'not-json',
        ].join('\n'),
      ),
    ).toBe(['', JSON.stringify({ type: 'result', result: 'keep' }), 'not-json'].join('\n'));
  });
});
