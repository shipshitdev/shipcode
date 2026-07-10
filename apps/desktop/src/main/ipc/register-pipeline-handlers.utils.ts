import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TerminalEventRecord, Thread } from '@shipcode/shared';
import {
  EXECUTION_PHASES,
  PAUSABLE_PIPELINE_PHASES,
  PIPELINE_PHASE,
  stripAnsi,
} from '@shipcode/shared';

import type { IpcHandlerDeps } from './types';

const execFileAsync = promisify(execFile);

const AUTO_FIX_FAILURE_OUTPUT_MAX = 8_000;
const EXECUTION_RESUME_PROMPT_MAX = 24_000;
const EXECUTION_RESUME_GIT_OUTPUT_MAX = 12_000;
const EXECUTION_RESUME_TERMINAL_LIMIT = 120;
export const RUN_TIMELINE_TERMINAL_LIMIT = 40;
export const STEERING_INSTRUCTION_MAX = 4_000;
const INTERRUPTED_EXECUTION_MARKERS = [
  'interrupted while ShipCode was closed',
  'interrupted by an app refresh',
  'Agent process stalled',
] as const;
export const PAUSABLE_PHASE_SET = new Set<string>(PAUSABLE_PIPELINE_PHASES);
const EXECUTION_PHASE_SET = new Set<string>(EXECUTION_PHASES);

export function clampAutoFixFailureOutput(output: string): string {
  const cleaned = stripAnsi(output).trim();
  if (cleaned.length <= AUTO_FIX_FAILURE_OUTPUT_MAX) return cleaned;

  const truncated = cleaned.slice(-AUTO_FIX_FAILURE_OUTPUT_MAX);
  return `[Earlier terminal output truncated for Auto Fix]\n\n${truncated}`;
}

export function clampResumeText(value: string, max: number, label: string): string {
  const cleaned = stripAnsi(value).trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}\n\n[${label} truncated after ${max} chars]`;
}

function isInterruptedExecutionThread(thread: Thread): boolean {
  if (
    thread.status === PIPELINE_PHASE.paused &&
    thread.pausedPhase &&
    EXECUTION_PHASE_SET.has(thread.pausedPhase)
  ) {
    return true;
  }
  if (
    thread.failurePhase !== PIPELINE_PHASE.executing &&
    thread.status !== PIPELINE_PHASE.executing
  ) {
    return false;
  }
  return INTERRUPTED_EXECUTION_MARKERS.some((marker) => thread.lastError?.includes(marker));
}

function formatTerminalResumeLine(record: TerminalEventRecord): string | null {
  const event = record.event;
  switch (event.kind) {
    case 'user_input':
      return `[user] ${event.content}`;
    case 'text':
    case 'raw':
    case 'thinking':
      return event.content;
    case 'error':
      return `[error] ${event.message}`;
    case 'lifecycle':
      return `[lifecycle] ${event.message}`;
    case 'tool_start':
      return `[tool:start] ${event.name}: ${event.summary}`;
    case 'tool_end':
      return `[tool:end] ${event.name}${event.exitCode === undefined ? '' : ` exit=${event.exitCode}`}${
        event.outputSummary ? ` ${event.outputSummary}` : ''
      }`;
    case 'turn_start':
      return `[turn:start] ${event.turn}`;
    case 'turn_end':
      return `[turn:end] ${event.turn}`;
    case 'action':
      return `[action] ${event.label}`;
    case 'clarification_requested':
      return `[clarification_requested] ${event.summary}`;
    case 'clarification_answered':
      return `[clarification_answered] ${event.questionCount} answers`;
    case 'done':
      return '[done]';
    default:
      return null;
  }
}

async function isGitRefResolvable(cwd: string, refName: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['rev-parse', '--verify', `${refName}^{commit}`], {
      cwd,
      encoding: 'utf8',
    });
    return true;
  } catch {
    return false;
  }
}

async function readGitResumeOutput(cwd: string, args: string[], label: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: EXECUTION_RESUME_GIT_OUTPUT_MAX * 4,
    });
    return clampResumeText(String(stdout), EXECUTION_RESUME_GIT_OUTPUT_MAX, label);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `[Unable to read ${label}: ${message}]`;
  }
}

export async function buildExecutionResumeContext(
  thread: Thread,
  queries: IpcHandlerDeps['queries'],
): Promise<string | null> {
  if (!isInterruptedExecutionThread(thread) || !thread.worktreePath) return null;

  const isPaused = thread.status === PIPELINE_PHASE.paused;
  const interruptedPhase = isPaused ? thread.pausedPhase : (thread.failurePhase ?? thread.status);
  const checkpoint = queries.checkpoints.getLatest(thread.id);
  // Prefer the hidden checkpoint ref (#212): its tree snapshots the full
  // worktree state at capture (including then-uncommitted changes), so the
  // resume diff shows exactly what changed since the checkpoint — the commit
  // SHA alone would misattribute pre-existing dirty state to the resumed run.
  const refBase =
    checkpoint?.refName && (await isGitRefResolvable(thread.worktreePath, checkpoint.refName))
      ? checkpoint.refName
      : null;
  const diffBase = refBase ?? checkpoint?.commitSha ?? 'HEAD';
  const [status, changedFiles, diffStat, diffExcerpt] = await Promise.all([
    readGitResumeOutput(thread.worktreePath, ['status', '--short'], 'git status'),
    readGitResumeOutput(
      thread.worktreePath,
      ['diff', '--name-only', diffBase, '--'],
      'changed files',
    ),
    readGitResumeOutput(thread.worktreePath, ['diff', '--stat', diffBase, '--'], 'diff stat'),
    readGitResumeOutput(thread.worktreePath, ['diff', diffBase, '--'], 'diff excerpt'),
  ]);
  const terminalTail = queries.terminalEvents
    .listByThread(thread.id, EXECUTION_RESUME_TERMINAL_LIMIT)
    .flatMap((event) => {
      const line = formatTerminalResumeLine(event);
      return line?.trim() ? [line] : [];
    })
    .join('\n');

  const sections = [
    '<interrupted_run_context>',
    isPaused
      ? 'The previous execution was paused by the user. This is a semantic resume, not a clean restart.'
      : 'The previous execution was interrupted. This is a semantic resume, not a clean restart.',
    '',
    `Interrupted phase: ${interruptedPhase ?? thread.status}`,
    `Last error: ${thread.lastError ?? (isPaused ? 'Paused by user' : 'Unknown interruption')}`,
    `Worktree: ${thread.worktreePath}`,
    checkpoint
      ? `Last checkpoint: ${checkpoint.label} (${checkpoint.commitSha.slice(0, 12)})`
      : 'Last checkpoint: none recorded; using HEAD as the diff base.',
    '',
    '<current_git_status>',
    status || 'Clean',
    '</current_git_status>',
    '',
    '<changed_files_since_checkpoint>',
    changedFiles || 'No changed files detected',
    '</changed_files_since_checkpoint>',
    '',
    '<diff_stat_since_checkpoint>',
    diffStat || 'No diff stat available',
    '</diff_stat_since_checkpoint>',
    '',
    '<diff_excerpt_since_checkpoint>',
    diffExcerpt || 'No diff available',
    '</diff_excerpt_since_checkpoint>',
    '',
    '<terminal_tail>',
    clampResumeText(terminalTail || 'No terminal events recorded', 8_000, 'terminal tail'),
    '</terminal_tail>',
    '',
    'Resume instructions:',
    '- Treat the current worktree as WIP from the interrupted agent.',
    '- Inspect and preserve useful changes before continuing.',
    '- Continue the approved plan from remaining work; fix incomplete or broken edits.',
    '- Do not reset or recreate the worktree unless the WIP is clearly wrong.',
    '</interrupted_run_context>',
  ].join('\n');

  return `\n\n${clampResumeText(sections, EXECUTION_RESUME_PROMPT_MAX, 'resume context')}`;
}
