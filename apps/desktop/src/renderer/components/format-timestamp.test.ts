import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentIsoTimestamp, formatTimestamp } from './format-timestamp';

describe('format-timestamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T08:00:00.000Z'));
  });

  it('formats dates through Intl locale formatting', () => {
    expect(formatTimestamp('2026-05-10T08:00:00.000Z', { timeZone: 'UTC', hour: '2-digit' })).toBe(
      new Date('2026-05-10T08:00:00.000Z').toLocaleString(undefined, {
        timeZone: 'UTC',
        hour: '2-digit',
      }),
    );
  });

  it('formats empty timestamps as a dash', () => {
    expect(formatTimestamp(null)).toBe('—');
  });

  it('returns the current ISO timestamp', () => {
    expect(currentIsoTimestamp()).toBe('2026-05-10T08:00:00.000Z');
  });
});
