import { describe, expect, it } from 'vitest';
import { formatDurationMilliseconds, formatDurationSeconds } from './format-duration';

describe('formatDurationSeconds', () => {
  it('formats seconds below one minute directly', () => {
    expect(formatDurationSeconds(59)).toBe('59s');
  });

  it('formats seconds above one minute as minutes and seconds', () => {
    expect(formatDurationSeconds(95)).toBe('1m 35s');
  });

  it('formats hour-scale durations as hours and minutes', () => {
    expect(formatDurationSeconds(3_661)).toBe('1h 1m');
  });
});

describe('formatDurationMilliseconds', () => {
  it.each([
    [null, '—'],
    [undefined, '—'],
    [999, '999ms'],
    [1_500, '1.5s'],
    [95_000, '1m 35s'],
    [3_900_000, '1h 5m'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatDurationMilliseconds(input)).toBe(expected);
  });
});
