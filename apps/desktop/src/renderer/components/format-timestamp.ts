export const SHORT_TIMESTAMP_FORMAT = {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
} satisfies Intl.DateTimeFormatOptions;

export function formatTimestamp(
  value: string | number | Date | null,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (value === null) return '—';
  return new Date(value).toLocaleString(undefined, options);
}

export function currentIsoTimestamp(): string {
  return new Date().toISOString();
}
