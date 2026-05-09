export function formatTimestamp(
  value: string | number | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Date(value).toLocaleString(undefined, options);
}

export function currentIsoTimestamp(): string {
  return new Date().toISOString();
}
