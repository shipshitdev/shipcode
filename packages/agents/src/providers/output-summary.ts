import { clampTextBlock } from '@shipcode/shared';

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI stripping for terminal summaries
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?(?:\x07|\x1b\\)/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, '');
}

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
