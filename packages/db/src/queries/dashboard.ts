import type { DatabaseSync } from 'node:sqlite';
import { toIsoUtc, type DashboardStats, type PipelinePhase, type RecentTask } from '@shipcode/shared';

// Phases that represent active work (agent running or waiting on action).
const ACTIVE_PHASES: PipelinePhase[] = [
  'planning',
  'reviewing',
  'revising',
  'awaiting_approval',
  'executing',
  'testing',
  'verifying',
  'shipping',
];

// Phases where an agent CLI process is actively running (vs waiting for user).
const AGENT_RUNNING_PHASES: PipelinePhase[] = [
  'planning',
  'reviewing',
  'revising',
  'executing',
  'testing',
  'verifying',
  'shipping',
];

// Phases where the user is blocked waiting for input / failure recovery.
const BLOCKED_PHASES: PipelinePhase[] = ['awaiting_approval'];

function placeholders(n: number): string {
  return Array(n).fill('?').join(',');
}

export class DashboardQueries {
  constructor(private db: DatabaseSync) {}

  getStats(): DashboardStats {
    // Agents running = threads in any agent-running phase.
    const agentsRunningRow = this.db
      .prepare(
        `SELECT COUNT(*) as n FROM threads WHERE status IN (${placeholders(AGENT_RUNNING_PHASES.length)})`,
      )
      .get(...AGENT_RUNNING_PHASES) as { n: number };

    // Per-phase breakdown for running agents (for subtitle on the card).
    const perPhaseRows = this.db
      .prepare(
        `SELECT status, COUNT(*) as n FROM threads
       WHERE status IN (${placeholders(AGENT_RUNNING_PHASES.length)})
       GROUP BY status`,
      )
      .all(...AGENT_RUNNING_PHASES) as Array<{ status: string; n: number }>;

    const runningByPhase: Partial<Record<PipelinePhase, number>> = {};
    for (const row of perPhaseRows) {
      runningByPhase[row.status as PipelinePhase] = row.n;
    }

    // Tasks in progress = any active phase (including awaiting_approval).
    const tasksInProgressRow = this.db
      .prepare(
        `SELECT COUNT(*) as n FROM threads WHERE status IN (${placeholders(ACTIVE_PHASES.length)})`,
      )
      .get(...ACTIVE_PHASES) as { n: number };

    // Open / blocked breakdown.
    const blockedRow = this.db
      .prepare(
        `SELECT COUNT(*) as n FROM threads WHERE status IN (${placeholders(BLOCKED_PHASES.length)})`,
      )
      .get(...BLOCKED_PHASES) as { n: number };

    const tasksOpenRow = this.db
      .prepare(
        `SELECT COUNT(*) as n FROM threads WHERE status NOT IN ('completed', 'failed', 'idle')`,
      )
      .get() as { n: number };

    // Pending approvals = awaiting_approval count. Stale = in that state for >24h.
    const pendingApprovals = blockedRow.n;
    const staleRow = this.db
      .prepare(
        `SELECT COUNT(*) as n FROM threads
       WHERE status = 'awaiting_approval'
         AND julianday('now') - julianday(updated_at) > 1.0`,
      )
      .get() as { n: number };

    // Recent shipped / failed (last 7 days).
    const shippedRow = this.db
      .prepare(
        `SELECT COUNT(*) as n FROM threads
       WHERE status = 'completed'
         AND julianday('now') - julianday(updated_at) <= 7.0`,
      )
      .get() as { n: number };

    const failedRow = this.db
      .prepare(
        `SELECT COUNT(*) as n FROM threads
       WHERE status = 'failed'
         AND julianday('now') - julianday(updated_at) <= 7.0`,
      )
      .get() as { n: number };

    return {
      agentsRunning: agentsRunningRow.n,
      runningByPhase,
      tasksInProgress: tasksInProgressRow.n,
      tasksOpen: tasksOpenRow.n,
      tasksBlocked: blockedRow.n,
      pendingApprovals,
      staleApprovals: staleRow.n,
      shippedLast7d: shippedRow.n,
      failedLast7d: failedRow.n,
    };
  }

  getRecentTasks(limit = 20, offset = 0): RecentTask[] {
    const rows = this.db
      .prepare(
        `SELECT
         t.id as thread_id,
         t.project_id,
         t.title,
         t.status as phase,
         t.github_issue_number,
         t.updated_at,
         p.name as project_name
       FROM threads t
       INNER JOIN projects p ON p.id = t.project_id
       WHERE t.status != 'idle'
       ORDER BY t.updated_at DESC
       LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as any[];

    return rows.map((row) => ({
      threadId: row.thread_id,
      projectId: row.project_id,
      projectName: row.project_name,
      title: row.title,
      phase: row.phase as PipelinePhase,
      githubIssueNumber: row.github_issue_number,
      updatedAt: toIsoUtc(row.updated_at) ?? row.updated_at,
    }));
  }

  countRecentTasks(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) as n FROM threads t WHERE t.status != 'idle'`)
      .get() as { n: number };
    return row.n;
  }
}
