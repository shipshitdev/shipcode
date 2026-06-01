export function extractFencedJson(options: { text: string; tag: string; label: string }): unknown {
  const captured = extractFencedBlock(options.text, options.tag);
  if (!captured.length) {
    throw new Error(`No \`${options.tag}\` fenced block found in AI response`);
  }

  try {
    return JSON.parse(captured.join('\n').trim()) as unknown;
  } catch (err) {
    throw new Error(
      `Failed to parse ${options.label} JSON inside \`${options.tag}\` block: ${formatCaughtError(
        err,
      )}`,
    );
  }
}

function extractFencedBlock(text: string, tag: string): string[] {
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

  return captured;
}

function formatCaughtError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
