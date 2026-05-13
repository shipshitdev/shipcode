import { formatDurationSeconds } from '@shipcode/shared';

export function formatElapsedDuration(since: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return formatDurationSeconds(seconds);
}
