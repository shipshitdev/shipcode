import type { Automation, Project, Thread } from '@shipcode/shared';
import { formatCost, formatTokenCount } from '@shipcode/shared';
import { PhaseChip } from '@shipcode/ui';
import { Button, cn } from '@shipshitdev/ui';
import { useQuery } from '@tanstack/react-query';
import { Cron } from 'croner';
import { ArrowLeft, Loader2, Pencil } from 'lucide-react';
import { useAppStore } from '../../stores/app-store';
import { AutomationPromptMarkdown } from './automation-prompt-markdown';
import { formatAutomationRelativeTime } from './automation-time';
import { describeAutomationRun, getAutomationRunTotalTokens } from './run-presentation';

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
    return `Next run ${formatAutomationRelativeTime(next)}`;
  } catch {
    return `Invalid: ${expr}`;
  }
}

function formatTokens(run: Thread): string | null {
  const total = getAutomationRunTotalTokens(run);
  return total > 0 ? formatTokenCount(total) : null;
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
  const openCreateAutomationModal = useAppStore((s) => s.openCreateAutomationModal);

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
          size="icon"
          onClick={openAutomations}
          aria-label="Back to automations"
          className="h-6 w-6 rounded p-0.5 text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="size-4" />
        </Button>
        {isAutomationLoading ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-primary">
              {automation?.name ?? 'Automation'}
            </h3>
            {automation?.lastStatus && (
              <span
                className={cn(
                  'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium',
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
          {automation?.prompt && (
            <div className="shrink-0 border-b border-border px-6 py-4">
              <h4 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Prompt
              </h4>
              <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-secondary px-3 py-2.5">
                <AutomationPromptMarkdown prompt={automation.prompt} />
              </div>
            </div>
          )}

          <div className="shrink-0 border-b border-border px-6 py-3">
            <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              All Runs ({runHistory.length})
            </h4>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isHistoryLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : runHistory.length === 0 ? (
              <p className="px-6 py-8 text-center text-[12px] text-muted-foreground">
                No runs yet.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {runHistory.map((run) => {
                  const tokens = formatTokens(run);
                  const hasCost = run.totalCostUsd != null && run.totalCostUsd > 0;
                  return (
                    <Button
                      key={run.id}
                      type="button"
                      variant="ghost"
                      onClick={() => selectAutomationThread(run.id)}
                      className="h-auto flex items-start gap-3 rounded-none px-6 py-3 text-left transition-colors hover:bg-hover"
                    >
                      <div className="mt-0.5 shrink-0">
                        <PhaseChip status={run.status} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] text-secondary">
                          {describeAutomationRun(run, { errorMaxLength: 120 })}
                        </span>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span>{formatTimestamp(run.createdAt)}</span>
                          {run.failureCount > 0 && (
                            <>
                              <span>·</span>
                              <span className="text-danger">
                                {run.failureCount} {run.failureCount === 1 ? 'failure' : 'failures'}
                              </span>
                            </>
                          )}
                          {hasCost && (
                            <>
                              <span>·</span>
                              <span>{formatCost(run.totalCostUsd as number)}</span>
                            </>
                          )}
                          {tokens && (
                            <>
                              <span>·</span>
                              <span>{tokens} tokens</span>
                            </>
                          )}
                        </div>
                      </div>
                      <span className="mt-0.5 shrink-0 text-[11px] text-muted-foreground">
                        {formatAutomationRelativeTime(run.createdAt)}
                      </span>
                    </Button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar: automation metadata */}
        <div className="w-56 shrink-0 overflow-y-auto border-l border-border">
          <div className="space-y-4 p-3">
            {/* Project */}
            {project && (
              <div className="min-w-0">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Project
                </span>
                <p className="mt-0.5 truncate text-sm text-primary">{project.name}</p>
              </div>
            )}

            {/* Schedule */}
            {automation && (
              <div className="min-w-0">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Schedule
                </span>
                <p className="mt-0.5 break-all font-mono text-sm text-primary">
                  {automation.cronExpr}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {describeCron(automation.cronExpr)}
                </p>
              </div>
            )}

            {/* Status */}
            {automation && (
              <div>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Status
                </span>
                <p className="mt-0.5 text-sm text-primary">
                  {automation.enabled ? 'Enabled' : 'Disabled'}
                </p>
              </div>
            )}

            {/* Run Stats */}
            {automation && (
              <div>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Total Runs
                </span>
                <p className="mt-0.5 text-sm text-primary">{automation.runCount}</p>
              </div>
            )}

            {automation?.lastStartedAt && (
              <div>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Last Run
                </span>
                <p className="mt-0.5 text-sm text-primary">
                  {formatAutomationRelativeTime(automation.lastStartedAt)}
                </p>
              </div>
            )}

            {/* Executor Override */}
            {automation && (
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Executor
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 text-muted-foreground/60 hover:text-primary"
                    title="Edit automation model"
                    onClick={() => openCreateAutomationModal(automation.id)}
                  >
                    <Pencil className="size-3" />
                  </Button>
                </div>
                {automation.executorProvider ? (
                  <>
                    <p className="mt-0.5 text-sm text-primary">{automation.executorProvider}</p>
                    {automation.executorModelId && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {automation.executorModelId}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-0.5 text-sm text-muted-foreground">Project default</p>
                )}
              </div>
            )}

            {/* Timestamps */}
            {automation && (
              <div className="space-y-0.5 text-[11px] text-muted-foreground">
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
