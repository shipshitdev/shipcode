import type {
  CostTaskSummary,
  PipelineStepPhase,
  PipelineStepRecord,
  PipelineThreadAnalytics,
  PromptTelemetryRecord,
  Thread,
} from '@shipcode/shared';
import {
  formatBytes,
  formatCost,
  formatDurationMilliseconds,
  formatTokenCount,
  isSyntheticResolvedModel,
  MODEL_DISPLAY,
  PIPELINE_PHASE,
} from '@shipcode/shared';
import { CollapsibleSection, PhaseChip } from '@shipcode/ui';
import { Badge, Button, Skeleton } from '@shipshitdev/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { formatTimestamp, SHORT_TIMESTAMP_FORMAT } from '../format-timestamp';
import { ActivityHeatmap } from '../heatmap/ActivityHeatmap';
import { STEP_STATUS_VARIANT, timeAgo } from './helpers';

const STEP_PHASE_LABEL: Record<PipelineStepPhase, string> = {
  plan: 'Plan',
  review: 'Review',
  revision: 'Revision',
  execute: 'Execute',
  verify: 'Verify',
};
const PIPELINE_STEPS_LOADING_KEYS = [
  'pipeline-step-loading-1',
  'pipeline-step-loading-2',
  'pipeline-step-loading-3',
];

function StepAttempts({ threadId }: { threadId: string }) {
  const { data: steps = [], isLoading } = useQuery<PipelineStepRecord[]>({
    queryKey: ['pipeline-steps', threadId],
    queryFn: async () => {
      const result = await window.shipcode.invoke('pipeline-steps:list-by-thread', { threadId });
      return Array.isArray(result) ? result : [];
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-2 px-3 py-2">
        {PIPELINE_STEPS_LOADING_KEYS.map((key) => (
          <Skeleton key={key} className="h-8 w-full rounded-md" />
        ))}
      </div>
    );
  }
  if (steps.length === 0) {
    return <p className="px-3 py-2 text-[11px] text-muted-foreground">No attempts recorded.</p>;
  }

  return (
    <div className="divide-y divide-border bg-tertiary/30">
      {steps.map((step) => {
        const phaseLabel = STEP_PHASE_LABEL[step.phase] ?? step.phase;
        const tokens = (step.promptTokens ?? 0) + (step.completionTokens ?? 0);
        const modelLabel = step.resolvedModel
          ? (MODEL_DISPLAY[step.resolvedModel as keyof typeof MODEL_DISPLAY] ?? step.resolvedModel)
          : (step.requestedModel ?? '—');
        return (
          <div key={step.id} className="flex items-start gap-3 px-6 py-2">
            <Badge variant={STEP_STATUS_VARIANT[step.status]} className="mt-0.5 text-[10px]">
              {step.status}
            </Badge>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[11px] font-medium text-primary">
                  {phaseLabel} · attempt {step.attempt}
                </span>
                <span className="text-[10px] text-muted-foreground">{modelLabel}</span>
                {step.provider && (
                  <span className="text-[10px] text-muted-foreground">({step.provider})</span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                <span>{formatDurationMilliseconds(step.durationMs)}</span>
                {tokens > 0 && (
                  <span>{tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : tokens} tok</span>
                )}
                {step.costUsd != null && step.costUsd > 0 && (
                  <span>{formatCost(step.costUsd)}</span>
                )}
              </div>
              {step.errorMessage && (
                <p className="mt-1 text-[10px] text-danger">
                  {step.errorKind ? `${step.errorKind}: ` : ''}
                  {step.errorMessage}
                </p>
              )}
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {timeAgo(step.startedAt)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function formatTokens(prompt: number, completion: number): string {
  return formatTokenCount(prompt + completion, { zero: '0 tokens', suffix: ' tokens' });
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatPromptMaterialKind(kind: string): string {
  return kind
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bPrd\b/g, 'PRD')
    .replace(/\bQa\b/g, 'QA');
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function PromptTelemetryCard({ record }: { record: PromptTelemetryRecord }) {
  const selectedMaterials = record.selectedMaterials;
  const materialKinds = selectedMaterials ? uniqueStrings(selectedMaterials.kinds) : [];
  const materialLabels = selectedMaterials ? uniqueStrings(selectedMaterials.labels) : [];
  const modelLabel = record.model
    ? (MODEL_DISPLAY[record.model as keyof typeof MODEL_DISPLAY] ?? record.model)
    : null;
  const promptTokens =
    record.promptTokens == null
      ? null
      : record.promptTokens >= 1000
        ? `${Math.round(record.promptTokens / 1000)}k`
        : record.promptTokens.toLocaleString();

  return (
    <div className="rounded-md border border-border bg-secondary p-2">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
            {STEP_PHASE_LABEL[record.phase] ?? record.phase}
            {record.attempt != null ? ` · attempt ${record.attempt}` : ''}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
            {[record.provider, modelLabel].filter(Boolean).join(' · ') || 'Provider pending'}
          </div>
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {timeAgo(record.createdAt)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <span className="text-muted-foreground">Payload</span>
        <span className="text-right font-mono text-primary">{formatBytes(record.promptBytes)}</span>
        <span className="text-muted-foreground">Lines</span>
        <span className="text-right font-mono text-primary">
          {record.promptLines.toLocaleString()}
        </span>
        <span className="text-muted-foreground">Characters</span>
        <span className="text-right font-mono text-primary">
          {record.promptCharacters.toLocaleString()}
        </span>
        {promptTokens ? (
          <>
            <span className="text-muted-foreground">Prompt tokens</span>
            <span className="text-right font-mono text-primary">{promptTokens}</span>
          </>
        ) : null}
        {record.costUsd != null && record.costUsd > 0 ? (
          <>
            <span className="text-muted-foreground">Cost</span>
            <span className="text-right font-mono text-primary">{formatCost(record.costUsd)}</span>
          </>
        ) : null}
      </div>

      {selectedMaterials ? (
        <div className="mt-2 border-t border-border pt-2">
          <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>Context Materials</span>
            <span>{selectedMaterials.count}</span>
          </div>
          {materialKinds.length > 0 ? (
            <div className="mb-1 flex flex-wrap gap-1">
              {materialKinds.map((kind) => (
                <Badge key={kind} variant="default" className="text-[9px] font-normal">
                  {formatPromptMaterialKind(kind)}
                </Badge>
              ))}
            </div>
          ) : null}
          {materialLabels.length > 0 ? (
            <div className="max-h-24 space-y-1 overflow-y-auto pr-1">
              {materialLabels.map((label) => (
                <div
                  key={label}
                  className="truncate font-mono text-[10px] text-muted-foreground"
                  title={label}
                >
                  {label}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 border-t border-border pt-2 text-[10px] text-muted-foreground">
          No selected material breakdown recorded.
        </div>
      )}
    </div>
  );
}

function ThreadAnalyticsPanel({
  analytics,
  isLoading,
}: {
  analytics: PipelineThreadAnalytics | undefined;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="mt-4 space-y-2">
        <Skeleton className="h-20 rounded-md" />
        <Skeleton className="h-24 rounded-md" />
      </div>
    );
  }
  if (!analytics) return null;

  const phaseTimeline = Array.isArray(analytics.phaseTimeline) ? analytics.phaseTimeline : [];
  const promptTelemetry = Array.isArray(analytics.promptTelemetry) ? analytics.promptTelemetry : [];
  const skillResolutions = Array.isArray(analytics.skillResolutions)
    ? analytics.skillResolutions
    : [];
  const skillFallback = analytics.skillFallback ?? {
    totalResolutions: 0,
    fallbackCount: 0,
    fallbackRate: 0,
    parseFailureRate: 0,
    retryRate: 0,
    downstreamSuccessRate: 0,
    score: 0,
  };

  return (
    <div className="mt-4 space-y-2">
      {phaseTimeline.length > 0 && (
        <CollapsibleSection title="Timeline" count={phaseTimeline.length}>
          <div className="overflow-hidden rounded-md border border-border">
            <div className="divide-y divide-border">
              {phaseTimeline.slice(0, 8).map((phase) => (
                <div key={phase.id} className="flex items-center gap-3 px-3 py-2">
                  <PhaseChip status={phase.phase} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] text-primary">
                      {phase.terminalStatus ?? 'running'}
                    </div>
                    {phase.errorMessage ? (
                      <div className="truncate text-[10px] text-danger">{phase.errorMessage}</div>
                    ) : null}
                    <div className="text-[10px] text-muted-foreground">
                      {formatTimestamp(phase.startedAt, SHORT_TIMESTAMP_FORMAT)}
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {formatDurationMilliseconds(phase.durationMs)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </CollapsibleSection>
      )}

      {promptTelemetry.length > 0 && (
        <CollapsibleSection title="Prompt / Context" count={promptTelemetry.length}>
          <div className="flex flex-col gap-2">
            {promptTelemetry.map((record) => (
              <PromptTelemetryCard key={record.id} record={record} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {skillResolutions.length > 0 && (
        <CollapsibleSection title="Skill Resolution" count={skillResolutions.length}>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-md border border-border bg-secondary p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Score</div>
              <div className="text-[14px] font-semibold text-primary">{skillFallback.score}</div>
            </div>
            <div className="rounded-md border border-border bg-secondary p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Fallbacks
              </div>
              <div className="text-[14px] font-semibold text-primary">
                {formatPercent(skillFallback.fallbackRate)}
              </div>
            </div>
            <div className="rounded-md border border-border bg-secondary p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Retries
              </div>
              <div className="text-[14px] font-semibold text-primary">
                {formatPercent(skillFallback.retryRate)}
              </div>
            </div>
          </div>
          <div className="mt-2 overflow-hidden rounded-md border border-border bg-tertiary/30">
            {skillResolutions.slice(0, 6).map((skill) => (
              <div
                key={skill.id}
                className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 last:border-b-0"
              >
                <span className="truncate text-[11px] text-primary">{skill.skillKey}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {skill.source}
                  {skill.fallbackUsed ? ' · fallback' : ''}
                </span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

export function CostsTab({
  projectId,
  issueNumber,
  thread,
}: {
  projectId: string;
  issueNumber: number;
  thread: Thread | null | undefined;
}) {
  const { data: tasks = [], isLoading } = useQuery<CostTaskSummary[]>({
    queryKey: ['issue-costs', projectId, issueNumber],
    queryFn: async () => {
      const result = await window.shipcode.invoke('costs:list-for-issue', {
        projectId,
        issueNumber,
      });
      return Array.isArray(result) ? result : [];
    },
    enabled: !!projectId,
  });

  const substantiveTasks = tasks.filter(
    (t) =>
      !isSyntheticResolvedModel(t.model) ||
      t.costUsd > 0 ||
      t.tokensPrompt + t.tokensCompletion > 0,
  );
  const totalCost = substantiveTasks.reduce((sum, t) => sum + t.costUsd, 0);
  const totalTokens = substantiveTasks.reduce(
    (sum, t) => sum + t.tokensPrompt + t.tokensCompletion,
    0,
  );
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  const { data: threadAnalytics, isLoading: threadAnalyticsLoading } =
    useQuery<PipelineThreadAnalytics>({
      queryKey: ['pipeline-analytics', 'thread', thread?.id],
      queryFn: () =>
        window.shipcode.invoke<PipelineThreadAnalytics>('pipeline-analytics:get-thread', {
          threadId: thread?.id,
        }),
      enabled: Boolean(thread?.id),
    });

  return (
    <div className="space-y-2">
      {isLoading ? (
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-14 rounded-md" />
            <Skeleton className="h-14 rounded-md" />
          </div>
          {PIPELINE_STEPS_LOADING_KEYS.map((key) => (
            <Skeleton key={key} className="h-10 w-full rounded-md" />
          ))}
        </div>
      ) : substantiveTasks.length === 0 ? (
        <ThreadAnalyticsPanel analytics={threadAnalytics} isLoading={threadAnalyticsLoading} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1 rounded-md border border-border bg-secondary p-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Total Cost
              </span>
              <span className="text-[14px] font-semibold text-primary">
                {formatCost(totalCost)}
              </span>
            </div>
            <div className="flex flex-col gap-1 rounded-md border border-border bg-secondary p-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Total Tokens
              </span>
              <span className="text-[14px] font-semibold text-primary">
                {totalTokens >= 1000 ? `${Math.round(totalTokens / 1000)}k` : String(totalTokens)}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            {/* Per-thread mini-heatmap */}
            {thread?.id && (
              <div className="rounded-md border border-border bg-secondary/20 px-3 py-2">
                <div className="text-[11px] font-medium uppercase tracking-wide text-secondary">
                  Activity (last 90 days)
                </div>
                <div className="mt-3 overflow-x-auto">
                  <ActivityHeatmap
                    scope="thread"
                    surface="issue"
                    threadId={thread.id}
                    defaultRange={90}
                    defaultMetric="costUsd"
                    allowedMetrics={['costUsd']}
                    showMetricToggle={false}
                    showRangePicker={false}
                  />
                </div>
              </div>
            )}

            {/* Per-run breakdown */}
            <CollapsibleSection title="Pipeline Runs" count={substantiveTasks.length}>
              <div className="overflow-hidden rounded-md border border-border">
                <div className="divide-y divide-border">
                  {substantiveTasks.map((task, index) => {
                    const isExpanded = expandedThreadId === task.threadId;
                    return (
                      <div key={task.threadId}>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setExpandedThreadId(isExpanded ? null : task.threadId)}
                          aria-expanded={isExpanded}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/40"
                        >
                          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-tertiary text-[11px] font-medium text-muted-foreground">
                            {substantiveTasks.length - index}
                          </span>
                          <span
                            aria-hidden="true"
                            className="shrink-0 select-none text-xs text-muted-foreground"
                          >
                            {isExpanded ? '▾' : '▸'}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                variant={
                                  task.phase === PIPELINE_PHASE.completed
                                    ? 'success'
                                    : task.phase === PIPELINE_PHASE.failed
                                      ? 'danger'
                                      : 'default'
                                }
                                className="text-[11px]"
                              >
                                {task.phase}
                              </Badge>
                              <span className="text-[13px] font-medium text-primary">
                                {formatCost(task.costUsd)}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {formatTokens(task.tokensPrompt, task.tokensCompletion)}
                              </span>
                            </div>
                            {task.model && (
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                {MODEL_DISPLAY[task.model] ?? task.model}
                              </p>
                            )}
                          </div>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {timeAgo(task.updatedAt)}
                          </span>
                        </Button>
                        {isExpanded && <StepAttempts threadId={task.threadId} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            </CollapsibleSection>

            {/* Current thread details — hide synthetic-only entries */}
            {(() => {
              if (!thread) return null;
              const resolvedModels = (
                [
                  { label: 'Planner', model: thread.plannerResolvedModel },
                  { label: 'Reviewer', model: thread.reviewerResolvedModel },
                  { label: 'Executor', model: thread.executorResolvedModel },
                  { label: 'Verifier', model: thread.verifierResolvedModel },
                ] as const
              ).reduce<Array<{ label: string; model: string }>>((entries, entry) => {
                if (entry.model && !isSyntheticResolvedModel(entry.model)) {
                  entries.push({ label: entry.label, model: entry.model });
                }
                return entries;
              }, []);
              if (resolvedModels.length === 0) return null;
              return (
                <CollapsibleSection title="Current Run Models" count={resolvedModels.length}>
                  <div className="flex flex-col gap-1.5">
                    {resolvedModels.map((entry) => (
                      <div key={entry.label} className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {entry.label}
                        </span>
                        <span className="truncate text-[11px] text-primary">
                          {MODEL_DISPLAY[entry.model] ?? entry.model}
                        </span>
                      </div>
                    ))}
                  </div>
                </CollapsibleSection>
              );
            })()}
          </div>
          <ThreadAnalyticsPanel analytics={threadAnalytics} isLoading={threadAnalyticsLoading} />
        </>
      )}
    </div>
  );
}
