export function extractFencedJson(options: { text: string; tag: string; label: string }): unknown {
  const captured = extractFencedBlock(options.text, options.tag);
  if (captured === null) {
    throw new Error(`No \`${options.tag}\` fenced block found in AI response`);
  }
  // Trim before the empty check so a whitespace-only fence is reported as empty
  // rather than falling through to a confusing JSON parse error.
  const payload = captured.join('\n').trim();
  if (payload.length === 0) {
    throw new Error(`Empty \`${options.tag}\` fenced block in AI response`);
  }

  try {
    return JSON.parse(payload) as unknown;
  } catch (err) {
    throw new Error(
      `Failed to parse ${options.label} JSON inside \`${options.tag}\` block: ${formatCaughtError(
        err,
      )}`,
    );
  }
}

/**
 * Returns the lines inside the first ```<tag> fence, or `null` when no such
 * fence is present. A present-but-empty fence returns `[]` — distinct from
 * `null` so callers can tell a missing envelope from an empty one.
 */
function extractFencedBlock(text: string, tag: string): string[] | null {
  const openTag = `\`\`\`${tag}`;
  const lines = text.split('\n');
  let collecting = false;
  const captured: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!collecting) {
      if (trimmed === openTag || trimmed.startsWith(`${openTag} `)) {
        collecting = true;
      }
      continue;
    }
    if (trimmed === '```') break;
    captured.push(line);
  }

  return collecting ? captured : null;
}

function formatCaughtError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
