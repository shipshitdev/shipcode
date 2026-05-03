import type { Automation, Project, Thread } from '@shipcode/shared';
import { formatCost, formatTokenCount } from '@shipcode/shared';
import { PhaseChip } from '@shipcode/ui';
import { Badge, Button, cn } from '@shipshitdev/ui';
import { useQuery } from '@tanstack/react-query';
import { Cron } from 'croner';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useAppStore } from '../../stores/app-store';

function formatRelative(date: Date | string | null): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = d.getTime() - Date.now();
  const past = diffMs < 0;
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  if (minutes < 1) return past ? 'just now' : 'in <1m';
  if (minutes < 60) return past ? `${minutes}m ago` : `in ${minutes}m`;
  if (hours < 48) return past ? `${hours}h ago` : `in ${hours}h`;
  return past ? `${days}d ago` : `in ${days}d`;
}

function formatTimestamp(date: string | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function describeCron(expr: string): string {
  try {
    const job = new Cron(expr, { paused: true });
    const next = job.nextRun();
    if (!next) return expr;
    return `Next run ${formatRelative(next)}`;
  } catch {
    return `Invalid: ${expr}`;
  }
}

const STATUS_COLOR: Record<string, string> = {
  running: 'bg-agent/10 text-agent border-agent/25',
  completed: 'bg-success/12 text-success border-success/25',
  failed: 'bg-danger/12 text-danger border-danger/25',
};

export function AutomationDetail() {
  const automationId = useAppStore((s) => s.activeAutomationDetailId);
  const openAutomations = useAppStore((s) => s.openAutomations);
  const selectAutomationThread = useAppStore((s) => s.selectAutomationThread);

  const { data: automation, isLoading: isAutomationLoading } = useQuery<Automation | null>({
    queryKey: ['automation', automationId],
    queryFn: () => {
      if (!automationId) throw new Error('Missing automation id');
      return window.shipcode.invoke<Automation>('automations:get', { id: automationId });
    },
    enabled: !!automationId,
  });

  const { data: project } = useQuery<Project | null>({
    queryKey: ['project', automation?.projectId],
    queryFn: () => {
      if (!automation?.projectId) throw new Error('Missing project id');
      return window.shipcode.invoke<Project>('project:get', { projectId: automation.projectId });
    },
    enabled: !!automation?.projectId,
  });

  const { data: runHistory = [], isLoading: isHistoryLoading } = useQuery<Thread[]>({
    queryKey: ['automation-run-history', automationId],
    queryFn: () =>
      window.shipcode.invoke<Thread[]>('automations:run-history', {
        automationId: automationId as string,
      }),
    enabled: !!automationId,
  });

  if (!automationId) return null;

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={openAutomations}
          aria-label="Back to automations"
          className="rounded p-0.5 text-muted transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {isAutomationLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted" />
        ) : (
          <>
            <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-primary">
              {automation?.name ?? 'Automation'}
            </h3>
            {automation?.lastStatus && (
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                  STATUS_COLOR[automation.lastStatus] ?? 'bg-tertiary text-secondary border-border',
                )}
              >
                {automation.lastStatus}
              </span>
            )}
          </>
        )}
      </div>

      {/* Body: two-column */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left: run history */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border px-6 py-3">
            <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted">
              All Runs ({runHistory.length})
            </h4>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isHistoryLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted" />
              </div>
            ) : runHistory.length === 0 ? (
              <p className="px-6 py-8 text-center text-[12px] text-muted">No runs yet.</p>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {runHistory.map((run) => (
                  <Button
                    key={run.id}
                    type="button"
                    variant="ghost"
                    onClick={() => selectAutomationThread(run.id)}
                    className="flex items-center gap-3 rounded-none px-6 py-3 text-left transition-colors hover:bg-hover"
                  >
                    <PhaseChip status={run.status} />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] text-secondary">
                        {run.lastError ? run.lastError.slice(0, 120) : run.status}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted">
                        {formatTimestamp(run.createdAt)}
                      </span>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="text-[11px] text-muted">
                        {formatRelative(run.createdAt)}
                      </span>
                      {run.failureCount > 0 && (
                        <span className="text-[10px] text-danger">{run.failureCount} failures</span>
                      )}
                    </div>
                    {run.totalCostUsd != null && run.totalCostUsd > 0 && (
                      <Badge variant="default" className="shrink-0 text-[10px]">
                        {formatCost(run.totalCostUsd)}
                      </Badge>
                    )}
                    {(run.totalTokensPrompt ?? 0) + (run.totalTokensCompletion ?? 0) > 0 && (
                      <span className="shrink-0 text-[10px] text-muted">
                        {formatTokenCount(
                          (run.totalTokensPrompt ?? 0) + (run.totalTokensCompletion ?? 0),
                        )}
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar: automation metadata */}
        <div className="w-72 shrink-0 overflow-y-auto border-l border-border">
          <div className="space-y-5 p-4">
            {/* Project */}
            {project && (
              <div>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
                  Project
                </span>
                <p className="mt-0.5 text-sm text-primary">{project.name}</p>
              </div>
            )}

            {/* Schedule */}
            {automation && (
              <div>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
                  Schedule
                </span>
                <p className="mt-0.5 font-mono text-sm text-primary">{automation.cronExpr}</p>
                <p className="mt-0.5 text-[11px] text-muted">{describeCron(automation.cronExpr)}</p>
              </div>
            )}

            {/* Status */}
            {automation && (
              <div>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
                  Status
                </span>
                <p className="mt-0.5 text-sm text-primary">
                  {automation.enabled ? 'Enabled' : 'Disabled'}
                </p>
              </div>
            )}

            {/* Run Stats */}
            {automation && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
                    Total Runs
                  </span>
                  <p className="mt-0.5 text-sm text-primary">{automation.runCount}</p>
                </div>
                <div>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
                    Last Run
                  </span>
                  <p className="mt-0.5 text-sm text-primary">
                    {formatRelative(automation.lastStartedAt)}
                  </p>
                </div>
              </div>
            )}

            {/* Executor Override */}
            {automation?.executorProvider && (
              <div>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
                  Executor
                </span>
                <p className="mt-0.5 text-sm text-primary">{automation.executorProvider}</p>
                {automation.executorModelId && (
                  <p className="mt-0.5 truncate text-[11px] text-muted">
                    {automation.executorModelId}
                  </p>
                )}
              </div>
            )}

            {/* Prompt */}
            {automation?.prompt && (
              <div>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
                  Prompt
                </span>
                <div className="mt-1 rounded-md border border-border bg-tertiary/40 px-3 py-2">
                  <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-secondary">
                    {automation.prompt}
                  </pre>
                </div>
              </div>
            )}

            {/* Timestamps */}
            {automation && (
              <div className="space-y-0.5 text-[11px] text-muted">
                <p>Created {formatTimestamp(automation.createdAt)}</p>
                <p>Updated {formatTimestamp(automation.updatedAt)}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
