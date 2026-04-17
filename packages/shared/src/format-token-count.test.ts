import { describe, expect, it } from 'vitest';
import { formatTokenCount } from './format-token-count';

describe('formatTokenCount', () => {
  it('formats values below one thousand without suffixes', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(999)).toBe('999');
  });

  it('formats one thousand and above with a single decimal k suffix', () => {
    expect(formatTokenCount(1000)).toBe('1.0k');
    expect(formatTokenCount(1500)).toBe('1.5k');
    expect(formatTokenCount(10000)).toBe('10.0k');
  });
});
