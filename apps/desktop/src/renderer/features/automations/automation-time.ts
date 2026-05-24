export function formatAutomationRelativeTime(date: Date | string | null): string {
  if (!date) return '-';

  const timestamp = typeof date === 'string' ? new Date(date).getTime() : date.getTime();
  if (Number.isNaN(timestamp)) return '-';

  const diffMs = timestamp - Date.now();
  const past = diffMs < 0;
  const abs = Math.abs(diffMs);
  const minutes = Math.floor(abs / 60_000);

  if (minutes < 1) return past ? 'just now' : 'in <1m';
  if (minutes < 60) return past ? `${minutes}m ago` : `in ${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return past ? `${hours}h ago` : `in ${hours}h`;

  const days = Math.floor(hours / 24);
  return past ? `${days}d ago` : `in ${days}d`;
}
