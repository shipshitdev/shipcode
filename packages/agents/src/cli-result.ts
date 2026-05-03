export function unwrapCliResultEnvelope(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout) as { result?: unknown };
    if (typeof parsed.result === 'string') return parsed.result;
  } catch {
    // raw text
  }
  return stdout;
}
