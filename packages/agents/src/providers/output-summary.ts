import { clampTextBlock, stripAnsi } from '@shipcode/shared';

export { stripAnsi };

export function summarizeTerminalText(
  raw: string | null | undefined,
  options: { maxLines?: number; maxChars?: number } = {},
): string | undefined {
  if (typeof raw !== 'string') return undefined;

  const maxLines = options.maxLines ?? 4;
  const maxChars = options.maxChars ?? 320;
  const normalizedLines = stripAnsi(raw)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd());
  const nonEmptyLines = normalizedLines.filter((line) => line.trim().length > 0);
  const candidateLines = (nonEmptyLines.length > 0 ? nonEmptyLines : normalizedLines).slice(
    -maxLines,
  );
  const summary = candidateLines.join('\n').trim();

  if (!summary) return undefined;
  return clampTextBlock(summary, maxChars);
}
