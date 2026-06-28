import { MAX_FAN_OUT_WORKER_COUNT } from '../workflow-loader';

/**
 * Dynamic-workflow (fan-out) executor — the orchestration core for S5.
 *
 * `runFanOut` is a pure controller: it fans `workerCount` cheap workers out in
 * parallel, has a judge pick/merge the best result, promotes the winner, and
 * returns a single result shaped like a normal provider phase. All side effects
 * (running an agent, creating worker worktrees, grafting the winner) are
 * injected so the control flow is unit-testable and the risky git/worktree work
 * lives at the call site.
 *
 * Opt-in per repo via `agent.execute_orchestration: fan-out` in WORKFLOW.md.
 */

export interface FanOutCandidate {
  /** Stable label, e.g. `worker-1`. Used by the judge to name its pick. */
  label: string;
  rawOutput: string;
  exitCode: number;
  resolvedModel?: string;
  /** Output tokens attributed to this worker, for telemetry summing. */
  outputTokens?: number;
  /** The worker's working-tree diff, shown to the judge to compare candidates. */
  diff?: string;
}

export interface FanOutJudgeOutcome {
  rawOutput: string;
  exitCode: number;
  resolvedModel?: string;
  /** Label of the candidate the judge selected, or null to keep the best pass. */
  winnerLabel: string | null;
  outputTokens?: number;
}

export interface FanOutResult {
  rawOutput: string;
  exitCode: number;
  resolvedModel?: string;
  /** Candidate promoted to the primary worktree (null when none succeeded). */
  winnerLabel: string | null;
  workersRun: number;
  workersSucceeded: number;
  judged: boolean;
  /** Sum of worker + judge output tokens, for cost telemetry. */
  totalOutputTokens: number;
}

export interface RunFanOutArgs {
  /** Requested worker count; clamped to [1, MAX_FAN_OUT_WORKER_COUNT]. */
  workerCount: number;
  /** Max concurrent workers (e.g. remaining pipeline slots). Defaults to all. */
  maxConcurrent?: number;
  /** Run a single worker. Index is 0-based. */
  runWorker: (index: number) => Promise<FanOutCandidate>;
  /** Pick/merge the best of >1 successful candidates. */
  runJudge: (candidates: FanOutCandidate[]) => Promise<FanOutJudgeOutcome>;
  /** Promote the chosen candidate's changes onto the primary worktree. */
  promoteWinner: (winner: FanOutCandidate) => Promise<void>;
}

/** Build the judge prompt: the original task + each candidate's diff. */
export function buildFanOutJudgePrompt(basePrompt: string, candidates: FanOutCandidate[]): string {
  const blocks = candidates
    .map(
      (c) =>
        `### ${c.label}\n<diff>\n${(c.diff ?? '(no changes)').trim()}\n</diff>\n\nSummary:\n${c.rawOutput.trim()}`,
    )
    .join('\n\n');
  return [
    'You are judging competing implementations of the SAME task. Do not write code.',
    'Pick the single best candidate by correctness, completeness, and adherence to the task.',
    `Reply with exactly one line: \`WINNER: <label>\` (one of: ${candidates
      .map((c) => c.label)
      .join(', ')}).`,
    '',
    '## Task',
    basePrompt,
    '',
    '## Candidates',
    blocks,
  ].join('\n');
}

/** Parse the judge's `WINNER: <label>` line; null if no known label is named. */
export function parseWinnerLabel(
  judgeOutput: string,
  candidates: FanOutCandidate[],
): string | null {
  const labels = new Set(candidates.map((c) => c.label));
  const explicit = judgeOutput.match(/WINNER:\s*([A-Za-z0-9_-]+)/i);
  if (explicit?.[1] && labels.has(explicit[1])) return explicit[1];
  // Fallback: last mentioned known label anywhere in the output.
  let found: string | null = null;
  for (const m of judgeOutput.matchAll(/worker-\d+/gi)) {
    if (labels.has(m[0])) found = m[0];
  }
  return found;
}

function clampWorkerCount(requested: number): number {
  if (!Number.isFinite(requested) || requested < 1) return 1;
  return Math.min(Math.floor(requested), MAX_FAN_OUT_WORKER_COUNT);
}

/** Run `thunks` with at most `limit` in flight at once, preserving order. */
async function mapWithConcurrency<T>(
  count: number,
  limit: number,
  task: (index: number) => Promise<T>,
): Promise<Array<PromiseSettledResult<T>>> {
  const results = new Array<PromiseSettledResult<T>>(count);
  let next = 0;
  const cap = Math.max(1, Math.min(limit, count));
  const runners = Array.from({ length: cap }, async () => {
    while (true) {
      const index = next++;
      if (index >= count) return;
      try {
        results[index] = { status: 'fulfilled', value: await task(index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

function sumTokens(candidates: FanOutCandidate[], judge: FanOutJudgeOutcome | null): number {
  const workerTokens = candidates.reduce((acc, c) => acc + (c.outputTokens ?? 0), 0);
  return workerTokens + (judge?.outputTokens ?? 0);
}

/**
 * Fan out workers, judge, promote the winner. Never throws for an individual
 * worker failure — a rejected/failed worker is simply not a candidate. Returns
 * a non-zero exitCode only when no worker produced a passing result.
 */
export async function runFanOut(args: RunFanOutArgs): Promise<FanOutResult> {
  const workerCount = clampWorkerCount(args.workerCount);
  const settled = await mapWithConcurrency(
    workerCount,
    args.maxConcurrent ?? workerCount,
    args.runWorker,
  );

  const candidates = settled
    .filter((r): r is PromiseFulfilledResult<FanOutCandidate> => r.status === 'fulfilled')
    .map((r) => r.value);
  const passing = candidates.filter((c) => c.exitCode === 0);

  // No worker passed → surface the first candidate's output (or a synthetic
  // failure) without promoting anything. The caller treats non-zero as failure.
  if (passing.length === 0) {
    const fallback = candidates[0];
    return {
      rawOutput: fallback?.rawOutput ?? 'fan-out: all workers failed',
      exitCode: fallback?.exitCode ?? 1,
      resolvedModel: fallback?.resolvedModel,
      winnerLabel: null,
      workersRun: workerCount,
      workersSucceeded: 0,
      judged: false,
      totalOutputTokens: sumTokens(candidates, null),
    };
  }

  // Exactly one passing candidate → no judge needed; promote it directly.
  if (passing.length === 1) {
    const winner = passing[0] as FanOutCandidate;
    await args.promoteWinner(winner);
    return {
      rawOutput: winner.rawOutput,
      exitCode: 0,
      resolvedModel: winner.resolvedModel,
      winnerLabel: winner.label,
      workersRun: workerCount,
      workersSucceeded: 1,
      judged: false,
      totalOutputTokens: sumTokens(candidates, null),
    };
  }

  // >1 passing → judge picks. Fall back to the first passing candidate if the
  // judge names an unknown label, so a flaky judge never strands the run.
  const judge = await args.runJudge(passing);
  const winner =
    passing.find((c) => c.label === judge.winnerLabel) ?? (passing[0] as FanOutCandidate);
  await args.promoteWinner(winner);

  return {
    rawOutput: judge.exitCode === 0 ? judge.rawOutput : winner.rawOutput,
    exitCode: judge.exitCode === 0 ? 0 : winner.exitCode,
    resolvedModel: judge.resolvedModel ?? winner.resolvedModel,
    winnerLabel: winner.label,
    workersRun: workerCount,
    workersSucceeded: passing.length,
    judged: true,
    totalOutputTokens: sumTokens(candidates, judge),
  };
}
