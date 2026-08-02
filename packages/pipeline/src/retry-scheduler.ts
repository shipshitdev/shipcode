/**
 * Why a phase is being re-entered — this, not the attempt number, decides the
 * shape of the delay:
 *
 * - `'failure'` — the agent *invocation* failed (non-zero exit, unparseable
 *   output, provider error). The condition is plausibly transient (rate limit,
 *   flaky provider, crashed CLI), so retries back off exponentially to give it
 *   time to clear. Only `startPlanning` uses this today.
 * - `'continuation'` — the agent ran to completion and produced valid output;
 *   the pipeline is deliberately handing off to another agent pass because the
 *   *content* wasn't acceptable yet (tests failed, verification returned
 *   not-passed, a task node missed its gate, a new turn starts). Nothing
 *   transient is waiting to clear, so backing off would only add dead time.
 */
export type PipelineRetryReason = 'continuation' | 'failure';

/**
 * Fixed settle delay before a continuation hand-off. Flat on purpose — see
 * `computeRetryDelayMs`.
 */
export const CONTINUATION_RETRY_DELAY_MS = 1000;
const FAILURE_RETRY_BASE_DELAY_MS = 10_000;
export const DEFAULT_MAX_RETRY_BACKOFF_MS = 300_000;

/**
 * Resolve the one-shot delay the state machine waits before running the
 * `andThen` outcome of a `{ next: 'retry' }`.
 *
 * Continuation retries intentionally ignore `attempt` and `maxRetryBackoffMs`
 * and always return {@link CONTINUATION_RETRY_DELAY_MS}. This is not a missing
 * backoff:
 *
 * - The delay is a single cancelable sleep, not a poll interval — each retry
 *   then spawns a fresh multi-minute agent run, which dominates the schedule.
 * - Continuation budgets are tiny (1–3 attempts), so the flat delay costs at
 *   most a few seconds across an entire pipeline.
 * - The previous call *succeeded*. Waiting longer cannot improve the next
 *   attempt's odds the way it can for a rate-limited or crashed provider; it
 *   would only stall a run the user is watching.
 *
 * Failure retries take both parameters: exponential from
 * {@link FAILURE_RETRY_BASE_DELAY_MS}, capped at `maxRetryBackoffMs`.
 */
export function computeRetryDelayMs({
  reason,
  attempt,
  maxRetryBackoffMs = DEFAULT_MAX_RETRY_BACKOFF_MS,
}: {
  reason: PipelineRetryReason;
  attempt: number;
  maxRetryBackoffMs?: number;
}): number {
  // Flat by design — `attempt` and `maxRetryBackoffMs` are deliberately unused
  // here. See the docblock above before "fixing" this to back off.
  if (reason === 'continuation') return CONTINUATION_RETRY_DELAY_MS;

  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  const normalizedCap = Math.max(0, Math.floor(maxRetryBackoffMs));
  const delay = FAILURE_RETRY_BASE_DELAY_MS * 2 ** (normalizedAttempt - 1);
  return Math.min(delay, normalizedCap);
}
