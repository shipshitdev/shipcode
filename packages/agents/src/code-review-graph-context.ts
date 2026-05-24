import { execFileSync } from 'node:child_process';
import type { PromptMaterial } from './prompt-scope';

const DEFAULT_TIMEOUT_MS = 4_000;
const MAX_STATUS_CHARS = 2_000;
const MAX_CHANGE_IMPACT_CHARS = 2_000;

export interface CodeReviewGraphContextOptions {
  timeoutMs?: number;
  includeChangeImpact?: boolean;
  changeBase?: string;
}

export function loadCodeReviewGraphContext(
  projectPath: string,
  options: CodeReviewGraphContextOptions = {},
): PromptMaterial[] {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const status = readCodeReviewGraphStatus(projectPath, timeoutMs);
  if (!status) return [];

  const changeImpact =
    options.includeChangeImpact === false
      ? null
      : readCodeReviewGraphChangeImpact(projectPath, timeoutMs, options.changeBase);

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
        ...(changeImpact
          ? [
              '',
              '## Current change impact',
              '',
              'Use this only as an extra signal when the worktree already has changes; absence of impact does not mean the issue is small.',
              '',
              '```text',
              changeImpact,
              '```',
            ]
          : []),
      ].join('\n'),
    },
  ];
}

function readCodeReviewGraphStatus(projectPath: string, timeoutMs: number): string | null {
  try {
    const output = execFileSync('code-review-graph', ['status', '--repo', projectPath], {
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return clampOutput(output, MAX_STATUS_CHARS);
  } catch {
    return null;
  }
}

function readCodeReviewGraphChangeImpact(
  projectPath: string,
  timeoutMs: number,
  base?: string,
): string | null {
  try {
    const args = ['detect-changes', '--brief', '--repo', projectPath];
    if (base) args.push('--base', base);
    const output = execFileSync('code-review-graph', args, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return clampOutput(output, MAX_CHANGE_IMPACT_CHARS);
  } catch {
    return null;
  }
}

function clampOutput(output: string, maxChars: number): string | null {
  if (!output) return null;
  return output.length > maxChars
    ? `${output.slice(0, maxChars).trimEnd()}\n... truncated ...`
    : output;
}
