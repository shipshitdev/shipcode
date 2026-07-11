import { describe, expect, it } from 'vitest';
import { type JsonResultEnvelope, parseJsonResultWithNdjsonFallback } from './stdin-cli-runner';

const ENVELOPE: JsonResultEnvelope = {
  resultFieldNames: ['result', 'text', 'response', 'content', 'output'],
  modelFieldNames: ['model', 'modelId', 'resolvedModel'],
};

describe('parseJsonResultWithNdjsonFallback', () => {
  it('parses a single result object with its resolved model', () => {
    expect(
      parseJsonResultWithNdjsonFallback(
        JSON.stringify({ type: 'result', result: 'done', model: 'grok-4.5' }),
        ENVELOPE,
      ),
    ).toEqual({ text: 'done', resolvedModel: 'grok-4.5' });
  });

  it('returns empty text for empty or whitespace-only output', () => {
    expect(parseJsonResultWithNdjsonFallback('', ENVELOPE)).toEqual({ text: '' });
    expect(parseJsonResultWithNdjsonFallback('   \n  ', ENVELOPE)).toEqual({ text: '' });
  });

  it('strips ANSI escapes before parsing', () => {
    expect(parseJsonResultWithNdjsonFallback('[31mplain[0m', ENVELOPE)).toEqual({
      text: 'plain',
    });
  });

  it('honors result-field priority order', () => {
    expect(
      parseJsonResultWithNdjsonFallback(JSON.stringify({ text: 'from text' }), ENVELOPE),
    ).toEqual({ text: 'from text' });
    // `result` outranks `text` when both are present.
    expect(
      parseJsonResultWithNdjsonFallback(
        JSON.stringify({ result: 'from result', text: 'from text' }),
        ENVELOPE,
      ),
    ).toEqual({ text: 'from result' });
  });

  it('honors model-field priority order', () => {
    expect(
      parseJsonResultWithNdjsonFallback(
        JSON.stringify({ result: 'done', modelId: 'm-id', resolvedModel: 'm-resolved' }),
        ENVELOPE,
      ),
    ).toEqual({ text: 'done', resolvedModel: 'm-id' });
  });

  it('falls back to the last result line of NDJSON stream output', () => {
    const stream = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'assistant', text: 'thinking' }),
      JSON.stringify({ type: 'result', result: 'final answer', model: 'sonnet-4.5' }),
    ].join('\n');
    expect(parseJsonResultWithNdjsonFallback(stream, ENVELOPE)).toEqual({
      text: 'final answer',
      resolvedModel: 'sonnet-4.5',
    });
  });

  it('keeps the last extractable NDJSON line when no explicit result event exists', () => {
    const stream = [
      JSON.stringify({ type: 'assistant', text: 'first' }),
      JSON.stringify({ type: 'assistant', text: 'second' }),
    ].join('\n');
    expect(parseJsonResultWithNdjsonFallback(stream, ENVELOPE)).toEqual({ text: 'second' });
  });

  it('ignores non-JSON and non-object lines in the NDJSON scan', () => {
    const stream = [
      'warning: background update available',
      '[42]',
      JSON.stringify({ type: 'result', result: 'clean' }),
    ].join('\n');
    expect(parseJsonResultWithNdjsonFallback(stream, ENVELOPE)).toEqual({ text: 'clean' });
  });

  it('returns cleaned raw text when nothing parses as a result', () => {
    expect(parseJsonResultWithNdjsonFallback('not json at all', ENVELOPE)).toEqual({
      text: 'not json at all',
    });
  });

  it('respects a custom envelope with different field names', () => {
    const custom: JsonResultEnvelope = {
      resultFieldNames: ['answer'],
      modelFieldNames: ['engine'],
    };
    expect(
      parseJsonResultWithNdjsonFallback(
        JSON.stringify({ type: 'result', answer: 'hi', engine: 'x' }),
        custom,
      ),
    ).toEqual({ text: 'hi', resolvedModel: 'x' });
    // Fields outside the custom envelope are ignored.
    expect(
      parseJsonResultWithNdjsonFallback(JSON.stringify({ result: 'ignored' }), custom),
    ).toEqual({ text: '{"result":"ignored"}' });
  });
});
