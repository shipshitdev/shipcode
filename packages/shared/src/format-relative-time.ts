export type RelativeTimeMode = 'past' | 'bidirectional';
export type RelativeTimeGranularity = 'seconds' | 'minutes';
export type RelativeTimeRounding = 'floor' | 'round';

export interface RelativeTimeOptions {
  readonly mode: RelativeTimeMode;
  readonly granularity: RelativeTimeGranularity;
  readonly justNowThresholdSec?: number;
  /**
   * How fractional units collapse to whole ones. `floor` (default) truncates,
   * so "1m ago" holds until the full 2-minute mark. `round` snaps to the
   * nearest unit at every level, preserving the legacy provider "checked N
   * ago" indicator (e.g. 90s → "2m ago", not "1m ago").
   */
  readonly rounding?: RelativeTimeRounding;
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
  const reduce = options.rounding === 'round' ? Math.round : Math.floor;
  const seconds = reduce(
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

  const minutes = reduce(seconds / 60);
  if (minutes < 60) return isFuture ? `in ${minutes}m` : `${minutes}m ago`;

  const hours = reduce(minutes / 60);
  if (hours < 24) return isFuture ? `in ${hours}h` : `${hours}h ago`;

  const days = reduce(hours / 24);
  return isFuture ? `in ${days}d` : `${days}d ago`;
}
