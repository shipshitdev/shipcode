import { describe, expect, it, vi } from 'vitest';
import { formatAutomationRelativeTime } from './automation-time';

describe('formatAutomationRelativeTime', () => {
  it('rolls elapsed times over to days at 24 hours', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-08T12:00:00.000Z'));

      expect(formatAutomationRelativeTime('2026-05-08T11:59:30.000Z')).toBe('just now');
      expect(formatAutomationRelativeTime('2026-05-08T11:22:00.000Z')).toBe('38m ago');
      expect(formatAutomationRelativeTime('2026-05-07T13:00:00.000Z')).toBe('23h ago');
      expect(formatAutomationRelativeTime('2026-05-07T07:00:00.000Z')).toBe('1d ago');
      expect(formatAutomationRelativeTime('2026-05-09T17:00:00.000Z')).toBe('in 1d');
    } finally {
      vi.useRealTimers();
    }
  });
});
