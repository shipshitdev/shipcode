export interface FormatTokenCountOptions {
  /**
   * Full replacement string for a zero count. Call sites disagree on what
   * "no tokens" reads as ('—' in dense stat rows, 'tokens pending' while a run
   * is still streaming), so the empty state is a parameter, not a constant.
   */
  zero?: string;
  /** Appended to non-zero output, e.g. ' tokens'. */
  suffix?: string;
}

export function formatTokenCount(n: number, options: FormatTokenCountOptions = {}): string {
  const { zero = '—', suffix = '' } = options;
  if (n === 0) return zero;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M${suffix}`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k${suffix}`;
  return `${n}${suffix}`;
}
