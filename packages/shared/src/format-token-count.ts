/**
 * Format token counts for compact UI display.
 *
 * Keeps sub-1k values exact and switches to a single decimal `k` suffix at
 * 1,000+, which is readable enough for cards, badges, and demo output.
 */
export function formatTokenCount(n: number): string {
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}
