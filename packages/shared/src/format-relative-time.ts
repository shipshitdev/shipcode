export type RelativeTimeMode = 'past' | 'bidirectional';
export type RelativeTimeGranularity = 'seconds' | 'minutes';

export interface RelativeTimeOptions {
  readonly mode: RelativeTimeMode;
  readonly granularity: RelativeTimeGranularity;
  readonly justNowThresholdSec?: number;
}

export type RelativeTimeInput = string | number | Date | null | undefined;

const DEFAULT_RELATIVE_TIME_OPTIONS = {
  mode: 'past',
  granularity: 'seconds',
} as const satisfies RelativeTimeOptions;

export function formatRelativeTime(
  input: RelativeTimeInput,
  options: RelativeTimeOptions = DEFAULT_RELATIVE_TIME_OPTIONS,
): string {
  if (input == null) return '-';

  const timestamp =
    input instanceof Date
      ? input.getTime()
      : typeof input === 'number'
        ? input
        : new Date(input).getTime();
  if (!Number.isFinite(timestamp)) return '-';

  const rawDiffSeconds = (Date.now() - timestamp) / 1000;
  const isFuture = options.mode === 'bidirectional' && rawDiffSeconds < 0;
  const seconds = Math.floor(
    options.mode === 'past' ? Math.max(0, rawDiffSeconds) : Math.abs(rawDiffSeconds),
  );

  if (!isFuture && options.justNowThresholdSec != null && seconds < options.justNowThresholdSec) {
    return 'just now';
  }

  if (options.granularity === 'seconds' && seconds < 60) {
    return isFuture ? `in ${seconds}s` : `${seconds}s ago`;
  }

  if (seconds < 60) {
    return isFuture ? 'in <1m' : '1m ago';
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return isFuture ? `in ${minutes}m` : `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return isFuture ? `in ${hours}h` : `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return isFuture ? `in ${days}d` : `${days}d ago`;
}
