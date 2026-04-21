/**
 * Clamp an error-like value to a single-line string bounded in length so
 * multi-KB stderr, stack traces, or echoed prompts never leak into the
 * renderer via IPC. Callers are expected to still log the full value to
 * their local process console before throwing the clamped version.
 *
 * First line only. Default max 280 chars. Ellipsis appended on truncate.
 */
export function clampError(raw: unknown, max = 280): string {
  let message: string;
  if (raw instanceof Error) message = raw.message;
  else if (typeof raw === 'string') message = raw;
  else message = 'Unknown error';

  const firstLine = message.split('\n')[0] ?? '';
  if (firstLine.length <= max) return firstLine;
  return `${firstLine.slice(0, max - 1)}…`;
}

/**
 * Clamp a multiline text artifact to a bounded size while preserving the tail,
 * which is usually where the model's final answer or parse failure lives.
 */
export function clampTextBlock(raw: string, max = 16_000): string {
  const text = raw.trim();
  if (text.length <= max) return text;

  const prefix = `[truncated ${text.length - max + 1} chars]\n`;
  const tail = text.slice(-(max - prefix.length));
  return `${prefix}${tail}`;
}
