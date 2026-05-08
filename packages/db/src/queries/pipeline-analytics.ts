import type { DatabaseSync } from 'node:sqlite';
import type {
  PipelineAnalyticsOverview,
  PipelinePhase,
  PipelinePhaseDurationSummary,
  PipelinePromptByPhase,
  PipelineSkillFallbackSummary,
  PipelineSlowRunSummary,
  PipelineStepRecord,
  PipelineThreadAnalytics,
  PipelineTokensByPhase,
  PromptTelemetryMaterialSummary,
  PromptTelemetryPhase,
  PromptTelemetryRecord,
  SkillResolutionLogRecord,
} from '@shipcode/shared';
import { asRows } from '../utils';
import { PhaseLogQueries } from './pipeline-phase-log';
import { PipelineStepQueries } from './pipeline-steps';
import { PromptTelemetryQueries } from './prompt-telemetry';
import { SkillResolutionLogQueries } from './skill-resolution-log';

interface PhaseDurationRow {
  thread_id: string;
  phase: PipelinePhase;
  duration_ms: number;
  completed_at: string | null;
}

interface RunDurationRow {
  thread_id: string;
  title: string;
  project_name: string | null;
  github_pr_number: number | null;
  duration_ms: number;
  completed_at: string | null;
}

interface StepCostRow {
  thread_id: string;
  phase: PromptTelemetryPhase;
  attempt: number;
  status: PipelineStepRecord['status'];
  error_kind: string | null;
  error_message: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | null;
}

interface PromptTelemetryRow {
  id: string;
  thread_id: string;
  phase: PromptTelemetryPhase;
  invocation_id: string;
  attempt: number | null;
  provider: string | null;
  model: string | null;
  prompt_characters: number;
  prompt_bytes: number;
  prompt_lines: number;
  selected_materials: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | null;
  created_at: string;
}

interface SkillResolutionRow {
  thread_id: string;
  fallback_used: number;
}

interface ThreadStatusRow {
  id: string;
  status: string;
}

export class PipelineAnalyticsQueries {
  constructor(private db: DatabaseSync) {}

  getOverview(): PipelineAnalyticsOverview {
    const runDurations = this.getRunDurations();
    const phaseDurations = this.getPhaseDurations();
    const stepRows = this.getStepCostRows();
    const promptRows = this.getPromptTelemetryRows();
    const skillRows = this.getSkillRows();

    return {
      timeToPr: summarizeTimeToPr(runDurations),
      averagePhaseDurations: summarizePhaseDurations(phaseDurations),
      slowestRecentRuns: this.getSlowestRecentRuns(runDurations),
      tokensByPhase: summarizeTokens(stepRows.map(mapStepCostRow)),
      promptByPhase: summarizePromptRows(promptRows),
      skillFallback: this.summarizeSkillHealth(skillRows, stepRows),
    };
  }

  getThread(threadId: string): PipelineThreadAnalytics {
    const phaseTimeline = new PhaseLogQueries(this.db).listByThread(threadId);
    const providerAttempts = new PipelineStepQueries(this.db).listByThread(threadId);
    const promptTelemetry = new PromptTelemetryQueries(this.db).listByThread(threadId);
    const skillResolutions = new SkillResolutionLogQueries(this.db).listByThread(threadId);
    const bottleneck = phaseTimeline.reduce<{
      phase: PipelinePhase | null;
      durationMs: number | null;
    }>(
      (current, row) =>
        row.durationMs != null && row.durationMs > (current.durationMs ?? -1)
          ? { phase: row.phase, durationMs: row.durationMs }
          : current,
      { phase: null, durationMs: null },
    );
    const totalDurationMs = phaseTimeline.reduce((sum, row) => sum + (row.durationMs ?? 0), 0);

    return {
      threadId,
      phaseTimeline,
      providerAttempts,
      promptTelemetry,
      skillResolutions,
      tokensByPhase: summarizeTokens(providerAttempts),
      promptByPhase: summarizePromptRecords(promptTelemetry),
      bottleneckPhase: bottleneck.phase,
      bottleneckDurationMs: bottleneck.durationMs,
      totalDurationMs: phaseTimeline.length > 0 ? totalDurationMs : null,
      skillFallback: this.summarizeSkillHealth(
        skillResolutions.map((row) => ({
          thread_id: row.threadId,
          fallback_used: row.fallbackUsed ? 1 : 0,
        })),
        providerAttempts.map((row) => ({
          thread_id: row.threadId,
          phase: row.phase,
          attempt: row.attempt,
          status: row.status,
          error_kind: row.errorKind,
          error_message: row.errorMessage,
          prompt_tokens: row.promptTokens,
          completion_tokens: row.completionTokens,
          cost_usd: row.costUsd,
        })),
      ),
    };
  }

  private getRunDurations(): RunDurationRow[] {
    return asRows<RunDurationRow>(
      this.db
        .prepare(
          `SELECT
             t.id AS thread_id,
             t.title AS title,
             p.name AS project_name,
             t.github_pr_number AS github_pr_number,
             SUM(COALESCE(l.duration_ms, 0)) AS duration_ms,
             MAX(l.completed_at) AS completed_at
           FROM threads t
           JOIN pipeline_phase_log l ON l.thread_id = t.id
           LEFT JOIN projects p ON p.id = t.project_id
           WHERE t.status = 'completed'
             AND t.github_pr_number IS NOT NULL
             AND l.completed_at IS NOT NULL
           GROUP BY t.id
           HAVING duration_ms > 0
           ORDER BY completed_at DESC`,
        )
        .all(),
    );
  }

  private getPhaseDurations(): PhaseDurationRow[] {
    return asRows<PhaseDurationRow>(
      this.db
        .prepare(
          `SELECT thread_id, phase, duration_ms, completed_at
             FROM pipeline_phase_log
            WHERE completed_at IS NOT NULL
              AND duration_ms IS NOT NULL
              AND duration_ms > 0
            ORDER BY completed_at DESC`,
        )
        .all(),
    );
  }

  private getStepCostRows(): StepCostRow[] {
    return asRows<StepCostRow>(
      this.db
        .prepare(
          `SELECT
             thread_id,
             phase,
             attempt,
             status,
             error_kind,
             error_message,
             prompt_tokens,
             completion_tokens,
             cost_usd
           FROM pipeline_step_log`,
        )
        .all(),
    );
  }

  private getPromptTelemetryRows(): PromptTelemetryRow[] {
    return asRows<PromptTelemetryRow>(
      this.db
        .prepare(
          `SELECT *
             FROM prompt_telemetry
            ORDER BY created_at DESC, rowid DESC`,
        )
        .all(),
    );
  }

  private getSkillRows(): SkillResolutionRow[] {
    return asRows<SkillResolutionRow>(
      this.db
        .prepare(
          `SELECT thread_id, fallback_used
             FROM skill_resolution_log`,
        )
        .all(),
    );
  }

  private getSlowestRecentRuns(runDurations: RunDurationRow[]): PipelineSlowRunSummary[] {
    return [...runDurations]
      .slice(0, 50)
      .sort((a, b) => b.duration_ms - a.duration_ms)
      .slice(0, 5)
      .map((run) => {
        const bottleneck = this.getBottleneckForThread(run.thread_id);
        return {
          threadId: run.thread_id,
          title: run.title,
          projectName: run.project_name,
          githubPrNumber: run.github_pr_number,
          durationMs: run.duration_ms,
          completedAt: run.completed_at,
          bottleneckPhase: bottleneck?.phase ?? null,
          bottleneckDurationMs: bottleneck?.duration_ms ?? null,
        };
      });
  }

  private getBottleneckForThread(
    threadId: string,
  ): Pick<PhaseDurationRow, 'phase' | 'duration_ms'> | null {
    const row = this.db
      .prepare(
        `SELECT phase, duration_ms
           FROM pipeline_phase_log
          WHERE thread_id = ?
            AND duration_ms IS NOT NULL
          ORDER BY duration_ms DESC, rowid ASC
          LIMIT 1`,
      )
      .get(threadId);
    if (!row) return null;
    const mapped = row as Pick<PhaseDurationRow, 'phase' | 'duration_ms'>;
    return mapped.duration_ms == null ? null : mapped;
  }

  private summarizeSkillHealth(
    skillRows: Array<Pick<SkillResolutionRow, 'thread_id' | 'fallback_used'>>,
    stepRows: Array<
      Pick<StepCostRow, 'thread_id' | 'attempt' | 'status' | 'error_kind' | 'error_message'>
    >,
  ): PipelineSkillFallbackSummary {
    const totalResolutions = skillRows.length;
    const fallbackCount = skillRows.filter((row) => row.fallback_used === 1).length;
    const fallbackRate = totalResolutions > 0 ? fallbackCount / totalResolutions : 0;
    const parseFailureCount = stepRows.filter((row) => {
      const searchable = `${row.error_kind ?? ''}\n${row.error_message ?? ''}`;
      return row.status === 'failed' && /parse|json|schema/i.test(searchable);
    }).length;
    const parseFailureRate = stepRows.length > 0 ? parseFailureCount / stepRows.length : 0;
    const retryRate =
      stepRows.length > 0 ? stepRows.filter((row) => row.attempt > 1).length / stepRows.length : 0;
    const downstreamSuccessRate = this.getDownstreamSuccessRate([
      ...new Set(skillRows.map((row) => row.thread_id)),
    ]);
    const score = Math.max(
      0,
      Math.round(
        100 -
          fallbackRate * 40 -
          parseFailureRate * 20 -
          retryRate * 20 -
          (1 - downstreamSuccessRate) * 20,
      ),
    );

    return {
      totalResolutions,
      fallbackCount,
      fallbackRate,
      parseFailureRate,
      retryRate,
      downstreamSuccessRate,
      score,
    };
  }

  private getDownstreamSuccessRate(threadIds: string[]): number {
    if (threadIds.length === 0) return 1;
    const placeholders = threadIds.map(() => '?').join(', ');
    const rows = asRows<ThreadStatusRow>(
      this.db
        .prepare(`SELECT id, status FROM threads WHERE id IN (${placeholders})`)
        .all(...threadIds),
    );
    const terminalRows = rows.filter(
      (row) => row.status === 'completed' || row.status === 'failed',
    );
    if (terminalRows.length === 0) return 1;
    return terminalRows.filter((row) => row.status === 'completed').length / terminalRows.length;
  }
}

function summarizeTimeToPr(runDurations: RunDurationRow[]) {
  const durations = runDurations.map((row) => row.duration_ms).filter((value) => value > 0);
  return {
    sampleSize: durations.length,
    medianMs: percentile(durations, 0.5),
    p75Ms: percentile(durations, 0.75),
    p95Ms: percentile(durations, 0.95),
  };
}

function summarizePhaseDurations(rows: PhaseDurationRow[]): PipelinePhaseDurationSummary[] {
  const grouped = new Map<PipelinePhase, number[]>();
  for (const row of rows) {
    const group = grouped.get(row.phase) ?? [];
    group.push(row.duration_ms);
    grouped.set(row.phase, group);
  }

  return [...grouped.entries()]
    .map(([phase, durations]) => ({
      phase,
      runCount: durations.length,
      averageMs: average(durations),
      medianMs: percentile(durations, 0.5) ?? 0,
      p75Ms: percentile(durations, 0.75) ?? 0,
      p95Ms: percentile(durations, 0.95) ?? 0,
    }))
    .sort((a, b) => b.averageMs - a.averageMs);
}

function summarizeTokens(rows: PipelineStepRecord[]): PipelineTokensByPhase[] {
  const grouped = new Map<
    PromptTelemetryPhase,
    { promptTokens: number; completionTokens: number; costUsd: number; attemptCount: number }
  >();
  for (const row of rows) {
    const group = grouped.get(row.phase) ?? {
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      attemptCount: 0,
    };
    group.promptTokens += row.promptTokens ?? 0;
    group.completionTokens += row.completionTokens ?? 0;
    group.costUsd += row.costUsd ?? 0;
    group.attemptCount++;
    grouped.set(row.phase, group);
  }
  return [...grouped.entries()]
    .map(([phase, group]) => ({ phase, ...group }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

function summarizePromptRows(rows: PromptTelemetryRow[]): PipelinePromptByPhase[] {
  return summarizePromptLike(
    rows.map((row) => ({
      phase: row.phase,
      promptCharacters: row.prompt_characters,
      promptBytes: row.prompt_bytes,
      promptLines: row.prompt_lines,
      selectedMaterials: parseSelectedMaterials(row.selected_materials),
    })),
  );
}

function summarizePromptRecords(rows: PromptTelemetryRecord[]): PipelinePromptByPhase[] {
  return summarizePromptLike(rows);
}

function summarizePromptLike(
  rows: Array<{
    phase: PromptTelemetryPhase;
    promptCharacters: number;
    promptBytes: number;
    promptLines: number;
    selectedMaterials: PromptTelemetryMaterialSummary | null;
  }>,
): PipelinePromptByPhase[] {
  const grouped = new Map<
    PromptTelemetryPhase,
    {
      promptCount: number;
      characters: number;
      bytes: number;
      lines: number;
      materialCount: number;
      materialKinds: Set<string>;
    }
  >();

  for (const row of rows) {
    const group = grouped.get(row.phase) ?? {
      promptCount: 0,
      characters: 0,
      bytes: 0,
      lines: 0,
      materialCount: 0,
      materialKinds: new Set<string>(),
    };
    group.promptCount++;
    group.characters += row.promptCharacters;
    group.bytes += row.promptBytes;
    group.lines += row.promptLines;
    group.materialCount += row.selectedMaterials?.count ?? 0;
    for (const kind of row.selectedMaterials?.kinds ?? []) {
      group.materialKinds.add(kind);
    }
    grouped.set(row.phase, group);
  }

  return [...grouped.entries()]
    .map(([phase, group]) => ({
      phase,
      promptCount: group.promptCount,
      averageCharacters: Math.round(group.characters / group.promptCount),
      averageBytes: Math.round(group.bytes / group.promptCount),
      averageLines: Math.round(group.lines / group.promptCount),
      materialCount: group.materialCount,
      materialKinds: [...group.materialKinds].sort(),
    }))
    .sort((a, b) => b.averageBytes - a.averageBytes);
}

function mapStepCostRow(row: StepCostRow): PipelineStepRecord {
  return {
    id: '',
    threadId: row.thread_id,
    phase: row.phase,
    attempt: row.attempt,
    provider: null,
    requestedModel: null,
    resolvedModel: null,
    status: row.status,
    errorKind: row.error_kind,
    errorMessage: row.error_message,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    costUsd: row.cost_usd,
    startedAt: '',
    completedAt: null,
    durationMs: null,
  };
}

function parseSelectedMaterials(value: string | null): PromptTelemetryMaterialSummary | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as PromptTelemetryMaterialSummary;
  } catch {
    return null;
  }
}

function percentile(values: number[], pct: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * pct) - 1));
  return sorted[index];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}
