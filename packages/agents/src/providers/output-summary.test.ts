import { describe, expect, it } from 'vitest';
import { summarizeTerminalText } from './output-summary';

describe('summarizeTerminalText', () => {
  it('returns undefined for non-string and empty output', () => {
    expect(summarizeTerminalText(null)).toBeUndefined();
    expect(summarizeTerminalText(undefined)).toBeUndefined();
    expect(summarizeTerminalText('   \n')).toBeUndefined();
  });

  it('uses the last non-empty lines and strips ansi', () => {
    expect(
      summarizeTerminalText('\u001b[31mfirst\u001b[0m\n\nsecond\nthird\nfourth\nfifth', {
        maxLines: 3,
      }),
    ).toBe('third\nfourth\nfifth');
  });

  it('falls back to normalized blank lines before trimming', () => {
    expect(summarizeTerminalText('\n   \n', { maxLines: 1 })).toBeUndefined();
  });

  it('clamps long summaries', () => {
    const summary = summarizeTerminalText('x'.repeat(100), { maxChars: 50 });

    expect(summary).toContain('[truncated');
    expect(summary?.length).toBeLessThanOrEqual(50);
  });
});
