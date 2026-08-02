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

  // Continuation retries follow a *successful* agent run whose content wasn't
  // acceptable yet, so they stay flat on purpose. These lock that intent: a
  // future "add backoff here" change should fail loudly rather than silently
  // stalling runs. See the docblock in retry-scheduler.ts.
  it('does not back off continuation retries as attempts accumulate', () => {
    const attempts = [1, 2, 3, 4, 5];
    const delays = attempts.map((attempt) =>
      computeRetryDelayMs({ reason: 'continuation', attempt }),
    );
    expect(delays).toEqual([1000, 1000, 1000, 1000, 1000]);
    expect(delays).toEqual(attempts.map(() => CONTINUATION_RETRY_DELAY_MS));
  });

  it('ignores the backoff cap for continuation retries', () => {
    expect(computeRetryDelayMs({ reason: 'continuation', attempt: 99, maxRetryBackoffMs: 0 })).toBe(
      CONTINUATION_RETRY_DELAY_MS,
    );
    expect(
      computeRetryDelayMs({
        reason: 'continuation',
        attempt: 99,
        maxRetryBackoffMs: DEFAULT_MAX_RETRY_BACKOFF_MS,
      }),
    ).toBe(CONTINUATION_RETRY_DELAY_MS);
  });

  it('keeps the continuation delay flat for invalid attempts', () => {
    expect(computeRetryDelayMs({ reason: 'continuation', attempt: 0 })).toBe(
      CONTINUATION_RETRY_DELAY_MS,
    );
    expect(computeRetryDelayMs({ reason: 'continuation', attempt: -10 })).toBe(
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
