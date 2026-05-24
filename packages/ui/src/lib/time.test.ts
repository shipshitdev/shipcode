import { describe, expect, it } from 'vitest';
import { formatElapsedDuration } from './time';

describe('formatElapsedDuration', () => {
  it.each([
    [1_000, 1_000, '0s'],
    [1_000, 30_900, '29s'],
    [1_000, 91_000, '1m 30s'],
    [1_000, 3_661_000, '1h 1m'],
  ])('formats %i to %i as %s', (since, now, expected) => {
    expect(formatElapsedDuration(since, now)).toBe(expected);
  });

  it('clamps negative elapsed time to zero', () => {
    expect(formatElapsedDuration(2_000, 1_000)).toBe('0s');
  });
});
