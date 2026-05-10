import { describe, expect, it } from 'vitest';
import { ISO_NOW_SQL, toIsoUtc } from './sqlite-time';

describe('sqlite time helpers', () => {
  it('uses an explicit UTC ISO SQL fragment for writes', () => {
    expect(ISO_NOW_SQL).toBe("strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  });

  it('normalizes nullable, tagged, offset, and naive timestamps', () => {
    expect(toIsoUtc(null)).toBeNull();
    expect(toIsoUtc(undefined)).toBeNull();
    expect(toIsoUtc('')).toBeNull();
    expect(toIsoUtc('2026-04-11T23:29:00.000Z')).toBe('2026-04-11T23:29:00.000Z');
    expect(toIsoUtc('2026-04-11T23:29:00.000z')).toBe('2026-04-11T23:29:00.000z');
    expect(toIsoUtc('2026-04-11T23:29:00+02:00')).toBe('2026-04-11T23:29:00+02:00');
    expect(toIsoUtc('2026-04-11T23:29:00+0200')).toBe('2026-04-11T23:29:00+0200');
    expect(toIsoUtc('2026-04-11 23:29:00')).toBe('2026-04-11T23:29:00Z');
    expect(toIsoUtc('2026-04-11 23:29:00.123')).toBe('2026-04-11T23:29:00.123Z');
  });
});
