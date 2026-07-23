import { formatRelativeTime } from '@shipcode/shared';
import { describe, expect, it, vi } from 'vitest';
import { AUTOMATION_RELATIVE_TIME_OPTIONS } from './automation-time';

describe('automation relative time', () => {
  it('rolls elapsed times over to days at 24 hours', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-08T12:00:00.000Z'));

      expect(formatRelativeTime('2026-05-08T11:59:30.000Z', AUTOMATION_RELATIVE_TIME_OPTIONS)).toBe(
        'just now',
      );
      expect(formatRelativeTime('2026-05-08T11:22:00.000Z', AUTOMATION_RELATIVE_TIME_OPTIONS)).toBe(
        '38m ago',
      );
      expect(formatRelativeTime('2026-05-07T13:00:00.000Z', AUTOMATION_RELATIVE_TIME_OPTIONS)).toBe(
        '23h ago',
      );
      expect(formatRelativeTime('2026-05-07T07:00:00.000Z', AUTOMATION_RELATIVE_TIME_OPTIONS)).toBe(
        '1d ago',
      );
      expect(formatRelativeTime('2026-05-09T17:00:00.000Z', AUTOMATION_RELATIVE_TIME_OPTIONS)).toBe(
        'in 1d',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('formats empty, invalid, Date, and future minute/hour values', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-08T12:00:00.000Z'));

      expect(formatRelativeTime(null, AUTOMATION_RELATIVE_TIME_OPTIONS)).toBe('-');
      expect(formatRelativeTime('not-a-date', AUTOMATION_RELATIVE_TIME_OPTIONS)).toBe('-');
      expect(
        formatRelativeTime(new Date('2026-05-08T12:00:30.000Z'), AUTOMATION_RELATIVE_TIME_OPTIONS),
      ).toBe('in <1m');
      expect(formatRelativeTime('2026-05-08T12:15:00.000Z', AUTOMATION_RELATIVE_TIME_OPTIONS)).toBe(
        'in 15m',
      );
      expect(formatRelativeTime('2026-05-08T14:00:00.000Z', AUTOMATION_RELATIVE_TIME_OPTIONS)).toBe(
        'in 2h',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
