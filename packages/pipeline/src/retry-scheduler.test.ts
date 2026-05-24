import { describe, expect, it } from 'vitest';
import {
  CONTINUATION_RETRY_DELAY_MS,
  computeRetryDelayMs,
  DEFAULT_MAX_RETRY_BACKOFF_MS,
} from './retry-scheduler';

describe('computeRetryDelayMs', () => {
  it('uses a fixed one-second continuation delay', () => {
    expect(computeRetryDelayMs({ reason: 'continuation', attempt: 1 })).toBe(
      CONTINUATION_RETRY_DELAY_MS,
    );
    expect(computeRetryDelayMs({ reason: 'continuation', attempt: 99 })).toBe(
      CONTINUATION_RETRY_DELAY_MS,
    );
  });

  it('uses exponential failure backoff from attempt 1', () => {
    expect(computeRetryDelayMs({ reason: 'failure', attempt: 1 })).toBe(10_000);
    expect(computeRetryDelayMs({ reason: 'failure', attempt: 2 })).toBe(20_000);
    expect(computeRetryDelayMs({ reason: 'failure', attempt: 3 })).toBe(40_000);
    expect(computeRetryDelayMs({ reason: 'failure', attempt: 4 })).toBe(80_000);
  });

  it('caps failure backoff at the configured maximum', () => {
    expect(
      computeRetryDelayMs({
        reason: 'failure',
        attempt: 99,
        maxRetryBackoffMs: DEFAULT_MAX_RETRY_BACKOFF_MS,
      }),
    ).toBe(DEFAULT_MAX_RETRY_BACKOFF_MS);
  });

  it('normalizes invalid failure attempts to the first retry', () => {
    expect(computeRetryDelayMs({ reason: 'failure', attempt: 0 })).toBe(10_000);
    expect(computeRetryDelayMs({ reason: 'failure', attempt: -10 })).toBe(10_000);
  });
});
