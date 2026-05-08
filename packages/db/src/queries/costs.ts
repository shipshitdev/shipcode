import type { DatabaseSync } from 'node:sqlite';
import {
  type CostSummary,
  type CostTaskSummary,
  type ExecutorModel,
  PIPELINE_PHASE,
  type PipelinePhase,
  toIsoUtc,
} from '@shipcode/shared';

type TaskCostRow = {
  thread_id: string;
  project_id: string;
  title: string;
  phase: string;
  planner_model: string;
  reviewer_model: string;
  executor_model: string;
  verifier_model: string;
  planner_resolved_model: string | null;
  reviewer_resolved_model: string | null;
  revisor_resolved_model: string | null;
  executor_resolved_model: string | null;
  verifier_resolved_model: string | null;
  cost_usd: number;
  tokens_prompt: number;
  tokens_completion: number;
  updated_at: string;
  project_name: string;
};

function resolveProviderAndModel(row: TaskCostRow): {
  provider: ExecutorModel;
  model: string | null;
} {
  switch (row.phase as PipelinePhase) {
    case PIPELINE_PHASE.planning:
    case PIPELINE_PHASE.clarifying:
      return { provider: row.planner_model as ExecutorModel, model: row.planner_resolved_model };
    case PIPELINE_PHASE.reviewing:
      return { provider: row.reviewer_model as ExecutorModel, model: row.reviewer_resolved_model };
    case PIPELINE_PHASE.revising:
      return { provider: row.planner_model as ExecutorModel, model: row.revisor_resolved_model };
    case PIPELINE_PHASE.awaitingApproval:
    case PIPELINE_PHASE.executing:
    case PIPELINE_PHASE.testing:
    case PIPELINE_PHASE.paused:
      return { provider: row.executor_model as ExecutorModel, model: row.executor_resolved_model };
    case PIPELINE_PHASE.verifying:
    case PIPELINE_PHASE.shipping:
      return { provider: row.verifier_model as ExecutorModel, model: row.verifier_resolved_model };
    case PIPELINE_PHASE.completed:
      if (row.verifier_resolved_model) {
        return {
          provider: row.verifier_model as ExecutorModel,
          model: row.verifier_resolved_model,
        };
      }
      if (row.executor_resolved_model) {
        return {
          provider: row.executor_model as ExecutorModel,
          model: row.executor_resolved_model,
        };
      }
      if (row.reviewer_resolved_model) {
        return {
          provider: row.reviewer_model as ExecutorModel,
          model: row.reviewer_resolved_model,
        };
      }
      if (row.revisor_resolved_model) {
        return { provider: row.planner_model as ExecutorModel, model: row.revisor_resolved_model };
      }
      return { provider: row.planner_model as ExecutorModel, model: row.planner_resolved_model };
    case PIPELINE_PHASE.failed:
    case PIPELINE_PHASE.idle:
      if (row.executor_resolved_model) {
        return {
          provider: row.executor_model as ExecutorModel,
          model: row.executor_resolved_model,
        };
      }
      if (row.verifier_resolved_model) {
        return {
          provider: row.verifier_model as ExecutorModel,
          model: row.verifier_resolved_model,
        };
      }
      if (row.reviewer_resolved_model) {
        return {
          provider: row.reviewer_model as ExecutorModel,
          model: row.reviewer_resolved_model,
        };
      }
      if (row.revisor_resolved_model) {
        return { provider: row.planner_model as ExecutorModel, model: row.revisor_resolved_model };
      }
      return { provider: row.planner_model as ExecutorModel, model: row.planner_resolved_model };
  }
}

export class CostsQueries {
  constructor(private db: DatabaseSync) {}

  private listTaskRows(limit: number, offset: number, projectId?: string | null): TaskCostRow[] {
    const where = [`t.status != ?`];
    const args: Array<string | number> = [PIPELINE_PHASE.idle];
    if (projectId) {
      where.push(`t.project_id = ?`);
      args.push(projectId);
    }

    return this.db
      .prepare(
        `SELECT
           t.id as thread_id,
           t.project_id,
           t.title,
           t.status as phase,
           t.planner_model,
           t.reviewer_model,
           t.executor_model,
           t.verifier_model,
           t.planner_resolved_model,
           t.reviewer_resolved_model,
           t.revisor_resolved_model,
           t.executor_resolved_model,
           t.verifier_resolved_model,
           t.total_cost_usd as cost_usd,
           t.total_tokens_prompt as tokens_prompt,
           t.total_tokens_completion as tokens_completion,
           t.updated_at,
           p.name as project_name
         FROM threads t
         INNER JOIN projects p ON p.id = t.project_id
         WHERE ${where.join(' AND ')}
         ORDER BY t.total_cost_usd DESC, t.updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as TaskCostRow[];
  }

  private mapTaskRow(r: TaskCostRow): CostTaskSummary {
    const phase = r.phase as PipelinePhase;
    const { provider, model } = resolveProviderAndModel(r);
    return {
      threadId: r.thread_id,
      projectId: r.project_id,
      title: r.title,
      projectName: r.project_name,
      phase,
      provider,
      model,
      costUsd: r.cost_usd,
      tokensPrompt: r.tokens_prompt,
      tokensCompletion: r.tokens_completion,
      updatedAt: toIsoUtc(r.updated_at) ?? r.updated_at,
    };
  }

  getSummary(): CostSummary {
    const totals = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(total_cost_usd), 0) as total_cost_all_time,
           COALESCE(SUM(total_tokens_prompt), 0) as total_tokens,
           COUNT(*) as task_count
         FROM threads WHERE status != ?`,
      )
      .get(PIPELINE_PHASE.idle) as {
      total_cost_all_time: number;
      total_tokens: number;
      task_count: number;
    };

    const cost7dRow = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(total_cost_usd), 0) as cost,
           COALESCE(SUM(total_tokens_prompt + total_tokens_completion), 0) as tokens
         FROM threads
         WHERE status != ?
           AND julianday('now') - julianday(updated_at) <= 7.0`,
      )
      .get(PIPELINE_PHASE.idle) as { cost: number; tokens: number };

    const projectRows = this.db
      .prepare(
        `SELECT
           t.project_id,
           p.name as project_name,
           COALESCE(SUM(t.total_cost_usd), 0) as cost,
           COALESCE(SUM(t.total_tokens_prompt), 0) as tokens_prompt,
           COALESCE(SUM(t.total_tokens_completion), 0) as tokens_completion,
           COUNT(*) as task_count
         FROM threads t
         INNER JOIN projects p ON p.id = t.project_id
         WHERE t.status != ?
         GROUP BY t.project_id
         ORDER BY cost DESC`,
      )
      .all(PIPELINE_PHASE.idle) as Array<{
      project_id: string;
      project_name: string;
      cost: number;
      tokens_prompt: number;
      tokens_completion: number;
      task_count: number;
    }>;

    return {
      totalCostAllTime: totals.total_cost_all_time,
      totalCost7d: cost7dRow.cost,
      totalTokensAllTime: totals.total_tokens,
      totalTokens7d: cost7dRow.tokens,
      avgCostPerTask: totals.task_count > 0 ? totals.total_cost_all_time / totals.task_count : 0,
      avgTokensPerTask: totals.task_count > 0 ? totals.total_tokens / totals.task_count : 0,
      byProject: projectRows.map((r) => ({
        projectId: r.project_id,
        projectName: r.project_name,
        totalCostUsd: r.cost,
        totalTokensPrompt: r.tokens_prompt,
        totalTokensCompletion: r.tokens_completion,
        taskCount: r.task_count,
      })),
    };
  }

  listTasks(limit = 20, offset = 0, projectId?: string | null): CostTaskSummary[] {
    return this.listTaskRows(limit, offset, projectId).map((row) => this.mapTaskRow(row));
  }

  listTasksForIssue(projectId: string, issueNumber: number): CostTaskSummary[] {
    const rows = this.db
      .prepare(
        `SELECT
           t.id as thread_id,
           t.project_id,
           t.title,
           t.status as phase,
           t.planner_model,
           t.reviewer_model,
           t.executor_model,
           t.verifier_model,
           t.planner_resolved_model,
           t.reviewer_resolved_model,
           t.revisor_resolved_model,
           t.executor_resolved_model,
           t.verifier_resolved_model,
           t.total_cost_usd as cost_usd,
           t.total_tokens_prompt as tokens_prompt,
           t.total_tokens_completion as tokens_completion,
           t.updated_at,
           p.name as project_name
         FROM threads t
         INNER JOIN projects p ON p.id = t.project_id
         WHERE t.project_id = ? AND t.github_issue_number = ? AND t.status != ?
         ORDER BY t.updated_at DESC`,
      )
      .all(projectId, issueNumber, PIPELINE_PHASE.idle) as TaskCostRow[];
    return rows.map((row) => this.mapTaskRow(row));
  }

  countTasks(projectId?: string | null): number {
    const where = [`status != ?`];
    const args: Array<string> = [PIPELINE_PHASE.idle];
    if (projectId) {
      where.push(`project_id = ?`);
      args.push(projectId);
    }
    const row = this.db
      .prepare(`SELECT COUNT(*) as n FROM threads WHERE ${where.join(' AND ')}`)
      .get(...args) as { n: number };
    return row.n;
  }
}
