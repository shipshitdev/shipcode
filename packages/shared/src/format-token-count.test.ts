import { describe, it, expect } from 'vitest';
import { formatTokenCount } from './format-token-count';

describe('formatTokenCount', () => {
  it('formats 0 as an em dash', () => {
    expect(formatTokenCount(0)).toBe('—');
  });

  it('keeps 999 as a raw integer', () => {
    expect(formatTokenCount(999)).toBe('999');
  });

  it('rounds 1000 to 1k', () => {
    expect(formatTokenCount(1000)).toBe('1k');
  });

  it('rounds 1500 to 2k', () => {
    expect(formatTokenCount(1500)).toBe('2k');
  });

  it('rounds 10000 to 10k', () => {
    expect(formatTokenCount(10000)).toBe('10k');
  });

  it('formats 1000000 as 1.0M', () => {
    expect(formatTokenCount(1000000)).toBe('1.0M');
  });
});
