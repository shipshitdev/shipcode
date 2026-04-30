import { describe, expect, it } from 'vitest';
import { formatDurationSeconds } from './format-duration';

describe('formatDurationSeconds', () => {
  it('formats seconds below one minute directly', () => {
    expect(formatDurationSeconds(59)).toBe('59s');
  });

  it('formats seconds above one minute as minutes and seconds', () => {
    expect(formatDurationSeconds(95)).toBe('1m 35s');
  });

  it('keeps hour-scale durations in minutes for compact UI labels', () => {
    expect(formatDurationSeconds(3_601)).toBe('60m 1s');
  });
});
