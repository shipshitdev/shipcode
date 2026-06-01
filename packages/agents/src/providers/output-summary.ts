import { clampTextBlock, stripAnsi } from '@shipcode/shared';

export { stripAnsi };

const PROVIDER_FAILURE_PATTERN = /\b(error|failed|unauthorized|auth|permission|denied)\b/i;

export function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function clampProviderFailure(
  rawOutput: string,
  prompt: string,
  fallbackMessage: string,
): string {
  const promptText = stripAnsi(prompt).trim();
  const lines = stripAnsi(rawOutput)
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !promptText || (!promptText.includes(entry) && !entry.includes(promptText)));
  const line = lines.find((entry) => PROVIDER_FAILURE_PATTERN.test(entry)) ?? lines[0];
  return (line ?? fallbackMessage).slice(0, 280);
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
