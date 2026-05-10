import { describe, expect, it } from 'vitest';
import { extractCliFailureMessage, formatCliSpawnFailure } from './cli-error';

describe('cli-error', () => {
  it('formats spawn failures from the first line only and clamps length', () => {
    const message = formatCliSpawnFailure(
      'Claude CLI',
      `first line ${'x'.repeat(240)}\nsecond line should be ignored`,
    );

    expect(message).toBe(`Claude CLI spawn failed: ${`first line ${'x'.repeat(189)}`}`);
    expect(message.length).toBe('Claude CLI spawn failed: '.length + 200);
  });

  it('prefers stderr for non-zero exits', () => {
    expect(extractCliFailureMessage('', 'line 1\nline 2\nline 3\nline 4')).toBe(
      'line 1 line 2 line 3',
    );
  });

  it('extracts structured failure messages from stdout when stderr is empty', () => {
    expect(extractCliFailureMessage(JSON.stringify({ result: 'result failure' }), '')).toBe(
      'result failure',
    );
    expect(extractCliFailureMessage(JSON.stringify({ error: 'error failure' }), '')).toBe(
      'error failure',
    );
    expect(extractCliFailureMessage(JSON.stringify({ message: 'message failure' }), '')).toBe(
      'message failure',
    );
    expect(extractCliFailureMessage(JSON.stringify({ stderr: 'stderr failure' }), '')).toBe(
      'stderr failure',
    );
    expect(
      extractCliFailureMessage(JSON.stringify({ errors: ['', 'first nested error'] }), ''),
    ).toBe('first nested error');
    expect(extractCliFailureMessage(JSON.stringify({ errors: ['', '   '] }), '')).toBe('no stderr');
  });

  it('extracts the last structured stdout line and otherwise falls back to plain text', () => {
    expect(
      extractCliFailureMessage(
        [
          'progress line',
          '',
          JSON.stringify({ message: 'older structured failure' }),
          JSON.stringify({ message: 'latest structured failure' }),
        ].join('\n'),
        '',
      ),
    ).toBe('latest structured failure');

    expect(extractCliFailureMessage('one\ntwo\nthree\nfour', '')).toBe('two three four');
    expect(extractCliFailureMessage('only line\n\n', '')).toBe('only line');
  });

  it('does not echo JSON-shaped stdout or empty output when no message is extractable', () => {
    expect(extractCliFailureMessage('{"ignored":true}', '')).toBe('no stderr');
    expect(extractCliFailureMessage('{"ignored":true}\n\n{"alsoIgnored":true}', '')).toBe(
      'no stderr',
    );
    expect(extractCliFailureMessage('{"errors":"not-an-array"}', '')).toBe('no stderr');
    expect(extractCliFailureMessage('{"message":', '')).toBe('no stderr');
    expect(extractCliFailureMessage('   ', '')).toBe('no stderr');
    expect(extractCliFailureMessage('', '')).toBe('no stderr');
  });

  it('clamps extracted stdout messages', () => {
    expect(extractCliFailureMessage('x'.repeat(400), '')).toBe('x'.repeat(300));
  });
});
