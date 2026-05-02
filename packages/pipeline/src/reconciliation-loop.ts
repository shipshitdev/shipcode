import type { Pipeline } from './types';

/**
 * Labels that indicate the issue should no longer be worked on.
 * Conservative default — opt-in only. Matches the PRD spec.
 */
export const DEFAULT_TERMINAL_LABELS = ['wontfix', 'duplicate', 'invalid'] as const;

export const DEFAULT_RECONCILE_INTERVAL_MS = 30_000;

export interface IssueStateProvider {
  /** Fetch the current state + labels for a single issue. */
  getIssueState(
    projectPath: string,
    issueNumber: number,
  ): Promise<{ state: 'open' | 'closed'; labels: string[] }>;
}

export interface ReconciliationLoopDeps {
  pipeline: Pipeline;
  issueStateProvider: IssueStateProvider;
  /**
   * Callback when a pipeline is cancelled by reconciliation.
   * Allows the caller (e.g. desktop adapter) to handle worktree
   * cleanup, slot freeing, etc.
   */
  onReconciliationCancel?: (threadId: string, reason: string) => void;
  /** Optional logger. Falls back to console. */
  log?: (message: string) => void;
}

export interface ReconciliationLoopOptions {
  /** Polling interval in milliseconds. Default: 30_000. */
  intervalMs?: number;
  /** Labels that trigger cancellation. Default: wontfix, duplicate, invalid. */
  terminalLabels?: readonly string[];
}

export interface ReconciliationLoop {
  /** Start the polling loop. */
  start(): void;
  /** Stop the polling loop. Idempotent. */
  stop(): void;
  /** Run one reconciliation tick. Exposed for testing. */
  tick(): Promise<ReconciliationTickResult>;
}

export interface ReconciliationTickResult {
  /** Threads checked this tick. */
  checked: number;
  /** Threads cancelled this tick. */
  cancelled: Array<{ threadId: string; reason: string }>;
  /** Threads that failed to fetch issue state (non-fatal). */
  errors: Array<{ threadId: string; error: string }>;
}

export function createReconciliationLoop(
  deps: ReconciliationLoopDeps,
  options: ReconciliationLoopOptions = {},
): ReconciliationLoop {
  const intervalMs = options.intervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;
  const terminalLabels = new Set(
    (options.terminalLabels ?? DEFAULT_TERMINAL_LABELS).map((l) => l.toLowerCase()),
  );
  const log = deps.log ?? console.log;

  let timer: ReturnType<typeof setInterval> | null = null;

  async function tick(): Promise<ReconciliationTickResult> {
    const result: ReconciliationTickResult = { checked: 0, cancelled: [], errors: [] };
    const active = deps.pipeline.listActive();

    // Batch by projectPath → issueNumbers to minimize GH API calls
    const byProject = new Map<string, Array<{ threadId: string; issueNumber: number }>>();
    for (const summary of active) {
      const context = deps.pipeline.getContext(summary.threadId);
      if (!context?.githubIssueNumber || context.githubIssueNumber <= 0) continue;

      const existing = byProject.get(summary.projectPath) ?? [];
      existing.push({ threadId: summary.threadId, issueNumber: context.githubIssueNumber });
      byProject.set(summary.projectPath, existing);
    }

    for (const [projectPath, threads] of byProject) {
      for (const { threadId, issueNumber } of threads) {
        result.checked++;
        try {
          const issue = await deps.issueStateProvider.getIssueState(projectPath, issueNumber);

          // Check closed state
          if (issue.state === 'closed') {
            const reason = `cancelled: issue #${issueNumber} closed`;
            deps.pipeline.cancel(threadId);
            deps.onReconciliationCancel?.(threadId, reason);
            result.cancelled.push({ threadId, reason });
            log(`[reconcile] ${reason} → cancelled pipeline ${threadId}`);
            continue;
          }

          // Check terminal labels
          const hitLabel = issue.labels.find((l) => terminalLabels.has(l.toLowerCase()));
          if (hitLabel) {
            const reason = `cancelled: issue #${issueNumber} has terminal label '${hitLabel}'`;
            deps.pipeline.cancel(threadId);
            deps.onReconciliationCancel?.(threadId, reason);
            result.cancelled.push({ threadId, reason });
            log(`[reconcile] ${reason} → cancelled pipeline ${threadId}`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          result.errors.push({ threadId, error: message });
          log(
            `[reconcile] failed to check issue #${issueNumber} for thread ${threadId}: ${message}`,
          );
          // Non-fatal: continue checking other threads
        }
      }
    }

    return result;
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      tick().catch((err) => {
        log(`[reconcile] tick failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, intervalMs);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, tick };
}
