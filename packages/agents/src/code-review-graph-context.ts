import { execFileSync } from 'node:child_process';
import type { PromptMaterial } from './prompt-scope';

const DEFAULT_TIMEOUT_MS = 4_000;
const MAX_STATUS_CHARS = 2_000;

export interface CodeReviewGraphContextOptions {
  timeoutMs?: number;
}

export function loadCodeReviewGraphContext(
  projectPath: string,
  options: CodeReviewGraphContextOptions = {},
): PromptMaterial[] {
  const status = readCodeReviewGraphStatus(projectPath, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (!status) return [];

  return [
    {
      kind: 'repo_graph_context',
      label: 'code-review-graph/status',
      content: [
        '# code-review-graph status',
        '',
        'Use this repository graph signal while deciding whether the issue should be executed directly, split into an internal task graph, or promoted into GitHub task issues.',
        'Prefer smaller task graph nodes when the plan touches graph-heavy or cross-surface code.',
        '',
        '```text',
        status,
        '```',
      ].join('\n'),
    },
  ];
}

function readCodeReviewGraphStatus(projectPath: string, timeoutMs: number): string | null {
  try {
    const output = execFileSync('uvx', ['code-review-graph', 'status', '--repo', projectPath], {
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!output) return null;
    return output.length > MAX_STATUS_CHARS
      ? `${output.slice(0, MAX_STATUS_CHARS).trimEnd()}\n... truncated ...`
      : output;
  } catch {
    return null;
  }
}
