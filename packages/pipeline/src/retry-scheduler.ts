export type PipelineRetryReason = 'continuation' | 'failure';

export const CONTINUATION_RETRY_DELAY_MS = 1000;
export const FAILURE_RETRY_BASE_DELAY_MS = 10_000;
export const DEFAULT_MAX_RETRY_BACKOFF_MS = 300_000;

export function computeRetryDelayMs({
  reason,
  attempt,
  maxRetryBackoffMs = DEFAULT_MAX_RETRY_BACKOFF_MS,
}: {
  reason: PipelineRetryReason;
  attempt: number;
  maxRetryBackoffMs?: number;
}): number {
  if (reason === 'continuation') return CONTINUATION_RETRY_DELAY_MS;

  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  const normalizedCap = Math.max(0, Math.floor(maxRetryBackoffMs));
  const delay = FAILURE_RETRY_BASE_DELAY_MS * 2 ** (normalizedAttempt - 1);
  return Math.min(delay, normalizedCap);
}
