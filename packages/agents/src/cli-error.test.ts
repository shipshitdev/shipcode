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
});
