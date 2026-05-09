import type { DatabaseSync } from 'node:sqlite';
import {
  AGENT_RUNNING_PHASES,
  type DashboardStats,
  PIPELINE_PHASE,
  type PipelinePhase,
  type RecentTask,
  toIsoUtc,
} from '@shipcode/shared';
import { asRows } from '../utils';

// Phases that represent active work (agent running or waiting on action).
const ACTIVE_PHASES: PipelinePhase[] = [
  PIPELINE_PHASE.planning,
  PIPELINE_PHASE.clarifying,
  PIPELINE_PHASE.reviewing,
  PIPELINE_PHASE.revising,
  PIPELINE_PHASE.approval,
  PIPELINE_PHASE.executing,
  PIPELINE_PHASE.testing,
  PIPELINE_PHASE.verifying,
  PIPELINE_PHASE.shipping,
];

// Phases where the user is blocked waiting for input / failure recovery.
const BLOCKED_PHASES: PipelinePhase[] = [
  PIPELINE_PHASE.clarifying,
  PIPELINE_PHASE.approval,
  PIPELINE_PHASE.paused,
];

// Pre-built Sets for O(1) membership checks in getStats(). Derived from
// constants — no reason to rebuild per call.
const RUNNING_SET = new Set<string>(AGENT_RUNNING_PHASES);
const ACTIVE_SET = new Set<string>(ACTIVE_PHASES);
const BLOCKED_SET = new Set<string>(BLOCKED_PHASES);
const CLOSED_SET = new Set<string>([
  PIPELINE_PHASE.completed,
  PIPELINE_PHASE.failed,
  PIPELINE_PHASE.idle,
]);

interface RecentTaskRow {
  thread_id: string;
  project_id: string;
  title: string;
  phase: PipelinePhase;
  github_issue_number: number | null;
  updated_at: string;
  project_name: string;
}

function awaitingHumanApprovalWhere(alias: string): string {
  return `${alias}.kind = 'pipeline'
    AND ${alias}.status = '${PIPELINE_PHASE.approval}'
    AND COALESCE(
      (
        SELECT p.status
          FROM plans p
         WHERE p.thread_id = ${alias}.id
         ORDER BY p.version DESC
         LIMIT 1
      ),
      ''
    ) != 'approved'`;
}

export class DashboardQueries {
  constructor(private db: DatabaseSync) {}

  getStats(): DashboardStats {
    // Single-pass aggregation: one scan of pipeline threads computes all scalar
    // counters plus per-status and per-project breakdowns. Replaces 9+ separate
    // COUNT queries that each full-scanned the threads table.
    const rows = this.db
      .prepare(`SELECT status, project_id, updated_at FROM threads WHERE kind = 'pipeline'`)
      .all() as Array<{ status: string; project_id: string; updated_at: string }>;

    let agentsRunning = 0;
    let tasksInProgress = 0;
    let tasksBlocked = 0;
    let tasksOpen = 0;
    let shippedLast7d = 0;
    let failedLast7d = 0;
    const runningByPhase: Partial<Record<PipelinePhase, number>> = {};
    const agentsRunningByProject: Record<string, number> = {};
    const pendingApprovalsByProject: Record<string, number> = {};

    const nowJulian = Date.now();
    const sevenDaysMs = 7 * 86_400_000;

    for (const row of rows) {
      const { status, project_id, updated_at } = row;

      if (RUNNING_SET.has(status)) {
        agentsRunning++;
        runningByPhase[status as PipelinePhase] =
          (runningByPhase[status as PipelinePhase] ?? 0) + 1;
        agentsRunningByProject[project_id] = (agentsRunningByProject[project_id] ?? 0) + 1;
      }
      if (ACTIVE_SET.has(status)) tasksInProgress++;
      if (BLOCKED_SET.has(status)) tasksBlocked++;
      if (!CLOSED_SET.has(status)) tasksOpen++;

      if ((status === PIPELINE_PHASE.completed || status === PIPELINE_PHASE.failed) && updated_at) {
        const ageMs = nowJulian - new Date(updated_at).getTime();
        if (ageMs <= sevenDaysMs) {
          if (status === PIPELINE_PHASE.completed) shippedLast7d++;
          else failedLast7d++;
        }
      }
    }

    // Pending approvals need the subquery check (plan status != 'approved'),
    // so keep as a separate query — but only one instead of three.
    const pendingRows = this.db
      .prepare(
        `SELECT project_id, updated_at FROM threads
         WHERE ${awaitingHumanApprovalWhere('threads')}`,
      )
      .all() as Array<{ project_id: string; updated_at: string }>;

    let pendingApprovals = 0;
    let staleApprovals = 0;
    for (const row of pendingRows) {
      pendingApprovals++;
      pendingApprovalsByProject[row.project_id] =
        (pendingApprovalsByProject[row.project_id] ?? 0) + 1;
      const ageMs = nowJulian - new Date(row.updated_at).getTime();
      if (ageMs > 86_400_000) staleApprovals++;
    }

    return {
      agentsRunning,
      runningByPhase,
      agentsRunningByProject,
      pendingApprovalsByProject,
      tasksInProgress,
      tasksOpen,
      tasksBlocked,
      pendingApprovals,
      staleApprovals,
      shippedLast7d,
      failedLast7d,
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
      WHERE t.kind = 'pipeline' AND t.status != ?
       ORDER BY t.updated_at DESC
       LIMIT ? OFFSET ?`,
      )
      .all(PIPELINE_PHASE.idle, limit, offset);

    return asRows<RecentTaskRow>(rows).map((row) => ({
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
      .prepare(`SELECT COUNT(*) as n FROM threads t WHERE t.kind = 'pipeline' AND t.status != ?`)
      .get(PIPELINE_PHASE.idle) as { n: number };
    return row.n;
  }
}
