import { describe, expect, it } from 'vitest';
import { NOTIFICATIONS_STALE_TIME, STABLE_APP_STATE_STALE_TIME } from './query-stale-times';

describe('query-stale-times', () => {
  it('keeps stable app state and notification stale windows explicit', () => {
    expect(STABLE_APP_STATE_STALE_TIME).toBe(300_000);
    expect(NOTIFICATIONS_STALE_TIME).toBe(60_000);
  });
});
