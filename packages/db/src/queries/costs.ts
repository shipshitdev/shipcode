import type { DatabaseSync } from 'node:sqlite';
import type { CostSummary, PipelinePhase } from '@shipcode/shared';

export class CostsQueries {
  constructor(private db: DatabaseSync) {}

  getSummary(): CostSummary {
    const totals = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(total_cost_usd), 0) as total_cost_all_time,
           COALESCE(SUM(total_tokens_prompt), 0) as total_tokens,
           COUNT(*) as task_count
         FROM threads WHERE status != 'idle'`,
      )
      .get() as { total_cost_all_time: number; total_tokens: number; task_count: number };

    const cost7dRow = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(total_cost_usd), 0) as cost,
           COALESCE(SUM(total_tokens_prompt + total_tokens_completion), 0) as tokens
         FROM threads
         WHERE status != 'idle'
           AND julianday('now') - julianday(updated_at) <= 7.0`,
      )
      .get() as { cost: number; tokens: number };

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
         WHERE t.status != 'idle'
         GROUP BY t.project_id
         ORDER BY cost DESC`,
      )
      .all() as Array<{
      project_id: string;
      project_name: string;
      cost: number;
      tokens_prompt: number;
      tokens_completion: number;
      task_count: number;
    }>;

    const taskRows = this.db
      .prepare(
        `SELECT
           t.id as thread_id,
           t.title,
           t.status as phase,
           t.total_cost_usd as cost_usd,
           t.total_tokens_prompt as tokens_prompt,
           t.total_tokens_completion as tokens_completion,
           t.updated_at,
           p.name as project_name
         FROM threads t
         INNER JOIN projects p ON p.id = t.project_id
         WHERE t.status != 'idle'
         ORDER BY t.total_cost_usd DESC
         LIMIT 20`,
      )
      .all() as Array<{
      thread_id: string;
      title: string;
      phase: string;
      cost_usd: number;
      tokens_prompt: number;
      tokens_completion: number;
      updated_at: string;
      project_name: string;
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
      recentByTask: taskRows.map((r) => ({
        threadId: r.thread_id,
        title: r.title,
        projectName: r.project_name,
        phase: r.phase as PipelinePhase,
        costUsd: r.cost_usd,
        tokensPrompt: r.tokens_prompt,
        tokensCompletion: r.tokens_completion,
        updatedAt: r.updated_at,
      })),
    };
  }
}
