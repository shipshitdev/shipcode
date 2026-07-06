import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { type FeatureQaResult, stripAnsi } from '@shipcode/shared';
import type { PipelineContext } from '../types';

const DEFAULT_CONTINUATION_PROMPT_TEMPLATE = `The previous turn failed verification. Address the remaining gaps and fix the issues.

Prior failure reason: {{ prior_failure_reason }}

Do NOT re-read the original PRD — you already have it in context. Focus only on fixing the verification failures above.`;
export const CPU_QUEUE_NOTICE_INTERVAL_MS = 30_000;
export const DEFAULT_CPU_QUEUE_RETRY_MS = 5_000;

/**
 * Build a continuation prompt for a new turn after verify failure.
 * Uses the WORKFLOW.md continuation_prompt template if available,
 * otherwise falls back to the built-in default.
 */
/**
 * @knipignore
 */
export function buildContinuationPrompt(context: PipelineContext, failureReason: string): string {
  const template =
    context.workflowPolicy.continuationPromptTemplate ?? DEFAULT_CONTINUATION_PROMPT_TEMPLATE;

  // Simple variable replacement — the template is short and doesn't
  // need the full Liquid engine unless the user provides a custom one.
  // For custom templates the workflow-prompt renderer handles it.
  return template
    .replace(/\{\{\s*prior_failure_reason\s*\}\}/g, failureReason)
    .replace(/\{\{\s*turn_count\s*\}\}/g, String(context.turnCount))
    .trim();
}

/**
 * @knipignore
 */
export function normalizeFeatureQaResults(
  results: Array<Omit<FeatureQaResult, 'evidencePaths'> & { evidencePaths?: string[] | null }>,
): FeatureQaResult[] {
  return results.map((result) => ({
    ...result,
    evidencePaths: result.evidencePaths ?? undefined,
  }));
}

// Extract a short, human-readable error from an executor transcript.
// The previous heuristic only dropped the snippet when the joined last
// 3 lines started with `{`, which let backtick-fenced shipcode-plan
// blocks leak into `lastError` and dump the plan JSON onto the failure
// panel.
/**
 * Exported for focused transcript parsing regression tests.
 *
 * @knipignore
 */
export function extractExecutionErrorSnippet(rawOutput: string): string {
  const lines = rawOutput.split('\n');
  const tail = lines.slice(-30);

  // 1) Reverse-scan for a structured streaming error event from claude/codex.
  for (let i = tail.length - 1; i >= 0; i--) {
    const trimmed = tail[i].trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof obj.error === 'string' && obj.error.trim()) {
        return obj.error.trim().slice(0, 280);
      }
      if (
        obj.type === 'result' &&
        (obj.is_error === true || obj.subtype === 'error') &&
        typeof obj.result === 'string' &&
        obj.result.trim()
      ) {
        return obj.result.trim().slice(0, 280);
      }
    } catch {
      /* skip */
    }
  }

  // 2) Reverse-scan for a plain-text error line. Skip JSON objects, code
  // fences, shipcode-plan markers, and bare structural punctuation.
  for (let i = tail.length - 1; i >= 0; i--) {
    const trimmed = tail[i].trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('{') || trimmed.startsWith('}')) continue;
    if (trimmed.startsWith('[') || trimmed.startsWith(']')) continue;
    if (trimmed.startsWith('```')) continue;
    if (/^["'][a-zA-Z_]+["']\s*:/.test(trimmed)) continue; // looks like a JSON field
    return trimmed.slice(0, 280);
  }

  return '';
}

/**
 * Extract a short summary from raw test command output for use in
 * last_error and notification bodies. Looks for common test failure
 * patterns across Jest, Vitest, Go test, pytest, and plain exit output.
 */
/**
 * @knipignore
 */
export function extractTestFailureSummary(testOutput: string): string {
  if (!testOutput.trim()) return 'Tests failed (no output captured)';

  const lines = testOutput.split('\n');

  // Pattern 1: FAIL <path> (Jest/Vitest)
  const failLine = lines.find((l) => /^\s*(FAIL|✗|×)\s+\S/.test(l));
  if (failLine) return failLine.trim().slice(0, 280);

  // Pattern 2: "X failed" summary line (pytest, Vitest)
  const summaryLine = lines
    .slice()
    .reverse()
    .find((l) => /\d+\s+(failed|error|failing)/i.test(l));
  if (summaryLine) return summaryLine.trim().slice(0, 280);

  // Pattern 3: "--- FAIL" (Go)
  const goFail = lines.find((l) => l.startsWith('--- FAIL'));
  if (goFail) return goFail.trim().slice(0, 280);

  // Pattern 4: "Error:" lines
  const errorLine = lines.find((l) => /^\s*Error:/i.test(l));
  if (errorLine) return errorLine.trim().slice(0, 280);

  // Fallback: last non-empty line, capped
  const lastMeaningful = lines
    .slice()
    .reverse()
    .find((l) => l.trim().length > 0);
  return lastMeaningful?.trim().slice(0, 280) ?? '';
}

interface TestFailureFingerprint {
  fingerprint: string;
  summary: string;
  outputExcerpt: string;
  implicatedFiles: string[];
}

/**
 * @knipignore
 */
export function buildTestFailureFingerprint(
  command: string,
  output: string,
): TestFailureFingerprint {
  const summary = extractTestFailureSummary(output);
  const implicatedFiles = extractImplicatedFiles(`${command}\n${output}`);
  const normalizedOutput = output
    .split('\n')
    .map((line) =>
      stripAnsi(line)
        .replace(/\b\d+(?:\.\d+)?\s?(ms|s)\b/gi, '<duration>')
        .replace(/:\d+:\d+\b/g, ':<line>:<col>')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .slice(-40)
    .join('\n')
    .toLowerCase();
  const source = [
    command.trim(),
    summary.toLowerCase(),
    implicatedFiles.join(','),
    normalizedOutput,
  ]
    .filter(Boolean)
    .join('\n');
  return {
    fingerprint: createHash('sha256').update(source).digest('hex').slice(0, 32),
    summary,
    outputExcerpt: output.trim().slice(-8192),
    implicatedFiles,
  };
}

/**
 * @knipignore
 */
export function extractImplicatedFiles(value: string): string[] {
  const matches = value.match(/[A-Za-z0-9_./-]+\.(?:test|spec)\.[cm]?[jt]sx?/g) ?? [];
  return Array.from(new Set(matches.map((file) => file.replace(/^\.\//, '')))).slice(0, 20);
}

/**
 * @knipignore
 */
export function worktreeHasChanges(context: PipelineContext): boolean {
  const cwd = context.worktreePath ?? context.projectPath;
  try {
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    }).trim();
    if (status.length > 0) return true;

    const baseRef = resolveWorktreeDiffBase(context);
    if (baseRef) {
      const diff = execFileSync('git', ['diff', '--name-only', `${baseRef}..HEAD`], {
        cwd,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
      }).trim();
      if (diff.length > 0) return true;
    }

    return false;
  } catch (error) {
    // A failed git probe is not evidence of a dirty tree; report no confirmed
    // changes and leave the infrastructure failure visible in the process log.
    const message = formatWorktreeProbeError(error);
    console.warn(
      `[pipeline] worktree change probe failed; treating as no confirmed changes for thread ${context.threadId}: ${message}`,
    );
    return false;
  }
}

function formatWorktreeProbeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0].slice(0, 280) || 'unknown error';
}

/**
 * Resolve the git ref that represents "before this pipeline changed files".
 * Older/quick-task contexts can have an empty forkPointSha, so fall back to the
 * branch merge-base and finally the previous commit instead of diffing `..HEAD`.
 *
 * @knipignore
 */
export function resolveWorktreeDiffBase(context: PipelineContext): string | null {
  const cwd = context.worktreePath ?? context.projectPath;
  const forkPointSha = context.forkPointSha?.trim();
  if (forkPointSha) {
    try {
      return execFileSync('git', ['rev-parse', '--verify', `${forkPointSha}^{commit}`], {
        cwd,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
      }).trim();
    } catch {
      // Fall back below; persisted fork points can be missing in older records.
    }
  }

  const baseBranch = context.baseBranch?.trim();
  const baseCandidates = baseBranch
    ? Array.from(
        new Set([
          baseBranch,
          baseBranch.startsWith('origin/') ? baseBranch : `origin/${baseBranch}`,
        ]),
      )
    : [];

  for (const baseRef of baseCandidates) {
    try {
      return execFileSync('git', ['merge-base', baseRef, 'HEAD'], {
        cwd,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
      }).trim();
    } catch {
      // Try the next available base ref.
    }
  }

  try {
    return execFileSync('git', ['rev-parse', 'HEAD~1'], {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}
