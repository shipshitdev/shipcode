import type { ThreadQueries } from '@shipcode/db';
import { PIPELINE_PHASE, type Thread } from '@shipcode/shared';

/** Statuses where plan/review CLI commands can safely print results and exit. */
const TERMINAL_PLAN_REVIEW_STATUSES = new Set<string>([
  PIPELINE_PHASE.approval,
  PIPELINE_PHASE.failed,
  PIPELINE_PHASE.paused,
  PIPELINE_PHASE.completed,
  PIPELINE_PHASE.idle,
  PIPELINE_PHASE.clarifying,
]);

/**
 * Poll thread status until the pipeline has stopped at a plan/review terminal
 * state (or failed). Used by CLI `plan` / `review` which otherwise fire-and-
 * forget and read the DB before any provider work finishes.
 */
export async function waitForThreadTerminal(
  threads: Pick<ThreadQueries, 'getById'>,
  threadId: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<Thread> {
  const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
  const intervalMs = options.intervalMs ?? 500;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const thread = threads.getById(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found while waiting for pipeline completion`);
    }
    if (TERMINAL_PLAN_REVIEW_STATUSES.has(thread.status)) {
      return thread;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for pipeline on thread ${threadId}`,
  );
}
