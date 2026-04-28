import type { DatabaseSync } from 'node:sqlite';
import type { HeatmapDayRecord, HeatmapQueryArgs, HeatmapRange } from '@shipcode/shared';
import { asRows } from '../utils';

interface MetricRow {
  day: string;
  cost: number | null;
  tokens: number | null;
  runs: number | null;
}

interface PrDateRow {
  pr_date: string | null;
}

const RANGE_OFFSET: Record<HeatmapRange, string> = {
  30: '-29 days',
  90: '-89 days',
  365: '-364 days',
};

/**
 * Aggregates daily activity (cost / tokens / runs / PRs opened) from
 * `pipeline_step_log` joined with `threads`. Zero-fills missing days so the
 * renderer can paint an exact `rangeDays`-cell grid without gaps.
 *
 * Scope semantics:
 *   - `global`   → all threads, all projects.
 *   - `project`  → threads where `t.project_id = projectId`.
 *   - `thread`   → steps where `s.thread_id = threadId`.
 *
 * `prsOpened` is deduped per thread: a thread that re-runs the shipping phase
 * after a PR already exists still counts as a single PR (the first shipping
 * completion's date wins).
 */
export class HeatmapQueries {
  constructor(private db: DatabaseSync) {}

  byScope(args: HeatmapQueryArgs): HeatmapDayRecord[] {
    if (args.scope === 'project' && !args.projectId) {
      throw new Error('HeatmapQueries.byScope: projectId required for scope="project"');
    }
    if (args.scope === 'thread' && !args.threadId) {
      throw new Error('HeatmapQueries.byScope: threadId required for scope="thread"');
    }

    const offset = RANGE_OFFSET[args.rangeDays];
    const days = enumerateDays(args.rangeDays);
    const initial = new Map<string, HeatmapDayRecord>(
      days.map((d) => [d, { date: d, costUsd: 0, tokens: 0, runs: 0, prsOpened: 0 }]),
    );

    const scopeFilter = buildScopeFilter(args);
    const scopeArgs = scopeFilter.args;

    const metricSql = `
      SELECT date(s.started_at) AS day,
             SUM(COALESCE(s.cost_usd, 0)) AS cost,
             SUM(COALESCE(s.prompt_tokens, 0) + COALESCE(s.completion_tokens, 0)) AS tokens,
             COUNT(DISTINCT s.thread_id || '|' || s.attempt) AS runs
        FROM pipeline_step_log s
        JOIN threads t ON t.id = s.thread_id
       WHERE date(s.started_at) >= date('now', ?)
         ${scopeFilter.where ? `AND ${scopeFilter.where}` : ''}
       GROUP BY date(s.started_at)
    `;
    const metricRows = asRows<MetricRow>(this.db.prepare(metricSql).all(offset, ...scopeArgs));

    for (const row of metricRows) {
      const target = initial.get(row.day);
      if (!target) continue;
      target.costUsd = Number(row.cost ?? 0);
      target.tokens = Number(row.tokens ?? 0);
      target.runs = Number(row.runs ?? 0);
    }

    const prSql = `
      SELECT MIN(date(s.completed_at)) AS pr_date
        FROM pipeline_step_log s
        JOIN threads t ON t.id = s.thread_id
       WHERE s.phase = 'shipping'
         AND s.status = 'completed'
         AND s.completed_at IS NOT NULL
         AND t.github_pr_number IS NOT NULL
         AND date(s.completed_at) >= date('now', ?)
         ${scopeFilter.where ? `AND ${scopeFilter.where}` : ''}
       GROUP BY s.thread_id
    `;
    const prRows = asRows<PrDateRow>(this.db.prepare(prSql).all(offset, ...scopeArgs));

    for (const row of prRows) {
      if (!row.pr_date) continue;
      const target = initial.get(row.pr_date);
      if (!target) continue;
      target.prsOpened += 1;
    }

    return Array.from(initial.values());
  }
}

interface ScopeFilter {
  where: string;
  args: string[];
}

function buildScopeFilter(args: HeatmapQueryArgs): ScopeFilter {
  switch (args.scope) {
    case 'global':
      return { where: '', args: [] };
    case 'project':
      return { where: 't.project_id = ?', args: [args.projectId as string] };
    case 'thread':
      return { where: 's.thread_id = ?', args: [args.threadId as string] };
    default: {
      const _exhaustive: never = args.scope;
      throw new Error(`HeatmapQueries: unknown scope ${_exhaustive as string}`);
    }
  }
}

/**
 * Enumerate every UTC day in the range [today - (rangeDays - 1), today]
 * inclusive, formatted as `YYYY-MM-DD` matching SQLite's `date()`. Anchors
 * the iteration at UTC midnight so DST shifts can't drop or duplicate a day.
 */
function enumerateDays(rangeDays: HeatmapRange): string[] {
  const out: string[] = [];
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(todayUtc - i * 86_400_000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
