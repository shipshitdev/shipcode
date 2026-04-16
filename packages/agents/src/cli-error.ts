function firstNonEmptyString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function extractMessageFromJson(candidate: string): string | null {
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const direct = firstNonEmptyString([
      parsed.result,
      parsed.error,
      parsed.message,
      parsed.stderr,
    ]);
    if (direct) return direct;

    if (Array.isArray(parsed.errors)) {
      const first = firstNonEmptyString(parsed.errors);
      if (first) return first;
    }
  } catch {
    // Ignore malformed JSON and fall back to plain-text extraction.
  }
  return null;
}

function extractStdoutMessage(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  const whole = extractMessageFromJson(trimmed);
  if (whole) return whole;

  for (const line of trimmed
    .split('\n')
    .map((part) => part.trim())
    .reverse()) {
    if (!line) continue;
    const parsed = extractMessageFromJson(line);
    if (parsed) return parsed;
  }

  const raw = trimmed.split('\n').filter(Boolean).slice(-3).join(' ').trim();
  if (!raw || raw.startsWith('{')) return null;
  return raw;
}

/**
 * Build a short subprocess failure message without echoing the prompt.
 *
 * Prefer stderr when present. If stderr is empty, inspect stdout because newer
 * Claude CLI builds can emit structured failure envelopes there even when the
 * process exits non-zero.
 */
export function extractCliFailureMessage(stdout: string, stderr: string): string {
  const stderrMessage = stderr.split('\n').slice(0, 3).join(' ').trim();
  const message = stderrMessage || extractStdoutMessage(stdout) || 'no stderr';
  return message.slice(0, 300);
}
