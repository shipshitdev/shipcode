import type {
  PipelineRunStatus,
  PipelineRunTimelineEntry,
  TerminalEventRecord,
} from '@shipcode/shared';
import {
  formatCost,
  formatDurationMilliseconds,
  formatRelativeTime,
  formatTokenCount,
  MODEL_DISPLAY,
  stripAnsi,
  truncate,
} from '@shipcode/shared';
import { PhaseChip } from '@shipcode/ui';
import { Badge, Button, Skeleton } from '@shipshitdev/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { renderTerminalEvent } from '../terminal-drawer/render-terminal-event';
import { STEP_STATUS_VARIANT } from './helpers';

const RUN_LOADING_KEYS = ['run-loading-1', 'run-loading-2', 'run-loading-3'];

const RUN_STATUS_VARIANT: Record<
  PipelineRunStatus,
  'default' | 'success' | 'danger' | 'warning' | 'info'
> = {
  queued: 'default',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'warning',
  paused: 'warning',
  interrupted: 'danger',
};

function formatRunSource(source: string): string {
  return source.replace(/[:-]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatModel(model: string | null): string {
  if (!model) return 'model pending';
  return MODEL_DISPLAY[model as keyof typeof MODEL_DISPLAY] ?? model;
}

function summarizeTerminalEvent(record: TerminalEventRecord): string | null {
  const rendered = renderTerminalEvent(record.event);
  if (!rendered) return null;
  const cleaned = stripAnsi(rendered).trim();
  if (!cleaned) return null;
  return truncate(cleaned, 220, '...');
}

function runTotals(entry: PipelineRunTimelineEntry) {
  return entry.steps.reduce(
    (acc, step) => ({
      promptTokens: acc.promptTokens + (step.promptTokens ?? 0),
      completionTokens: acc.completionTokens + (step.completionTokens ?? 0),
      costUsd: acc.costUsd + (step.costUsd ?? 0),
    }),
    { promptTokens: 0, completionTokens: 0, costUsd: 0 },
  );
}

function formatTokenTotal(promptTokens: number, completionTokens: number): string {
  return formatTokenCount(promptTokens + completionTokens, {
    zero: 'tokens pending',
    suffix: ' tokens',
  });
}

function RunTimelineCard({
  attemptNumber,
  entry,
  isOpen,
  onToggle,
  retryParentNumber,
  terminalTail,
}: {
  attemptNumber: number;
  entry: PipelineRunTimelineEntry;
  isOpen: boolean;
  onToggle: () => void;
  retryParentNumber: number | null;
  terminalTail: string[];
}) {
  const totals = runTotals(entry);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-secondary/20">
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full justify-start rounded-none p-3 text-left hover:bg-secondary/40"
        aria-expanded={isOpen}
        onClick={onToggle}
      >
        <div className="flex w-full items-start gap-3">
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-tertiary text-[10px] font-semibold text-muted-foreground">
            {attemptNumber}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={RUN_STATUS_VARIANT[entry.run.status]} className="text-[10px]">
                {entry.run.status}
              </Badge>
              {entry.isCurrent ? (
                <Badge variant="info" className="text-[10px]">
                  current
                </Badge>
              ) : null}
              {retryParentNumber ? (
                <span className="text-[10px] text-muted-foreground">
                  retry of run {retryParentNumber}
                </span>
              ) : null}
            </div>
            <div className="mt-1 truncate text-[12px] font-medium text-primary">
              {formatRunSource(entry.run.source)}
              {entry.run.triggerDetail ? ` · ${entry.run.triggerDetail}` : ''}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              <span>{formatTokenTotal(totals.promptTokens, totals.completionTokens)}</span>
              {totals.costUsd > 0 ? <span>{formatCost(totals.costUsd)}</span> : null}
              <span>{formatRelativeTime(entry.run.updatedAt)}</span>
            </div>
          </div>
          {isOpen ? (
            <ChevronDown className="mt-1 size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-1 size-4 text-muted-foreground" />
          )}
        </div>
      </Button>

      {isOpen ? (
        <div className="border-t border-border p-3">
          <div className="mb-3 flex flex-wrap gap-2">
            {entry.phaseTimeline.length > 0 ? (
              entry.phaseTimeline.map((phase) => (
                <div key={phase.id} className="flex items-center gap-1.5">
                  <PhaseChip status={phase.phase} />
                  <span className="text-[10px] text-muted-foreground">
                    {formatDurationMilliseconds(phase.durationMs)}
                  </span>
                </div>
              ))
            ) : (
              <span className="text-[11px] text-muted-foreground">No phase rows.</span>
            )}
          </div>

          {entry.steps.length > 0 ? (
            <div className="mb-3 overflow-hidden rounded-md border border-border bg-tertiary/30">
              {entry.steps.map((step) => (
                <div
                  key={step.id}
                  className="flex items-start gap-2 border-b border-border px-3 py-2 last:border-b-0"
                >
                  <Badge variant={STEP_STATUS_VARIANT[step.status]} className="mt-0.5 text-[10px]">
                    {step.status}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-medium text-primary">
                      {step.phase} · attempt {step.attempt}
                    </div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {[step.provider, formatModel(step.resolvedModel ?? step.requestedModel)]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    {step.errorMessage ? (
                      <div className="mt-1 truncate text-[10px] text-danger">
                        {step.errorKind ? `${step.errorKind}: ` : ''}
                        {step.errorMessage}
                      </div>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {formatDurationMilliseconds(step.durationMs)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {terminalTail.length > 0 ? (
            <pre className="max-h-44 overflow-auto rounded-md border border-border bg-background/60 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {terminalTail.join('\n')}
            </pre>
          ) : (
            <div className="rounded-md border border-dashed border-border p-2 text-[11px] text-muted-foreground">
              No run-scoped terminal output.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function RunsTab({ threadId }: { threadId: string }) {
  const [runOpenOverrides, setRunOpenOverrides] = useState<Record<string, boolean>>({});
  const { data: entries = [], isLoading } = useQuery<PipelineRunTimelineEntry[]>({
    queryKey: ['pipeline-runs', threadId],
    queryFn: async () =>
      window.shipcode.invoke('pipeline-runs:list-by-thread', { threadId, terminalLimit: 40 }),
    enabled: !!threadId,
  });

  if (isLoading) {
    return (
      <div className="space-y-3 py-2">
        {RUN_LOADING_KEYS.map((key) => (
          <Skeleton key={key} className="h-28 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-center text-[12px] text-muted-foreground">
        No run records yet.
      </div>
    );
  }

  const attemptNumberByRunId = new Map(
    entries.map((entry, index) => [entry.run.id, entries.length - index]),
  );
  const current = entries.find((entry) => entry.isCurrent) ?? entries[0];
  const maxRetryDepth = entries.reduce((max, entry) => Math.max(max, entry.retryDepth), 0);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md border border-border bg-secondary p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Runs</div>
          <div className="text-[14px] font-semibold text-primary">{entries.length}</div>
        </div>
        <div className="rounded-md border border-border bg-secondary p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Current</div>
          <div className="truncate text-[14px] font-semibold text-primary">
            {current.run.currentPhase ?? current.run.status}
          </div>
        </div>
        <div className="rounded-md border border-border bg-secondary p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Retries</div>
          <div className="text-[14px] font-semibold text-primary">{maxRetryDepth}</div>
        </div>
      </div>

      <div className="space-y-3">
        {entries.map((entry, index) => {
          const attemptNumber = entries.length - index;
          const terminalTail = entry.terminalEvents
            .reduce<string[]>((lines, event) => {
              const line = summarizeTerminalEvent(event);
              if (line) lines.push(line);
              return lines;
            }, [])
            .slice(-8);
          const retryParentNumber = entry.run.retryOfRunId
            ? attemptNumberByRunId.get(entry.run.retryOfRunId)
            : null;

          return (
            <RunTimelineCard
              key={entry.run.id}
              attemptNumber={attemptNumber}
              entry={entry}
              isOpen={runOpenOverrides[entry.run.id] ?? index === 0}
              onToggle={() =>
                setRunOpenOverrides((current) => ({
                  ...current,
                  [entry.run.id]: !(current[entry.run.id] ?? index === 0),
                }))
              }
              retryParentNumber={retryParentNumber ?? null}
              terminalTail={terminalTail}
            />
          );
        })}
      </div>
    </div>
  );
}
