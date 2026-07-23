import type { Automation, Project, Thread } from '@shipcode/shared';
import { formatRelativeTime } from '@shipcode/shared';
import { PageHeader, PhaseChip, Tooltip, TooltipContent, TooltipTrigger } from '@shipcode/ui';
import { Button, Card, CardContent, cn, Switch } from '@shipshitdev/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cron } from 'croner';
import { ChevronDown, Loader2, Pencil, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '../../stores/app-store';
import { AUTOMATION_RELATIVE_TIME_OPTIONS } from './automation-time';
import { describeAutomationRun } from './run-presentation';

const RUN_HISTORY_LIMIT = 5;

function describeCron(expr: string): string {
  try {
    const job = new Cron(expr, { paused: true });
    const next = job.nextRun();
    if (!next) return expr;
    return `${expr} · next ${formatRelativeTime(next, AUTOMATION_RELATIVE_TIME_OPTIONS)}`;
  } catch {
    return `Invalid: ${expr}`;
  }
}

const STATUS_COLOR: Record<string, string> = {
  running: 'bg-agent/10 text-agent border-agent/25',
  completed: 'bg-success/12 text-success border-success/25',
  failed: 'bg-danger/12 text-danger border-danger/25',
};

export function AutomationsView() {
  const openCreateAutomationModal = useAppStore((s) => s.openCreateAutomationModal);
  const queryClient = useQueryClient();

  const { data: automations = [], isLoading } = useQuery<Automation[]>({
    queryKey: ['automations'],
    queryFn: () => window.shipcode.invoke<Automation[]>('automations:list-all'),
  });

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects-visible'],
    queryFn: () => window.shipcode.invoke<Project[]>('project:list-visible'),
  });

  const projectById = new Map(projects.map((p) => [p.id, p]));

  const setEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      window.shipcode.invoke<Automation>('automations:set-enabled', { id, enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automations'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => window.shipcode.invoke<undefined>('automations:delete', { id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automations'] }),
  });

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-w-0">
      <PageHeader
        title="Automations"
        subtitle="Recurring AI tasks that run on a cron schedule against a project."
        actions={<Button onClick={() => openCreateAutomationModal()}>+ New automation</Button>}
      />

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="size-6 animate-spin text-secondary" />
          </div>
        ) : automations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-secondary">
            <p className="text-[15px]">No automations yet.</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Create one to run tasks on a schedule, like daily smoke tests or weekly cleanups.
            </p>
            <Button className="mt-4" onClick={() => openCreateAutomationModal()}>
              + New automation
            </Button>
          </div>
        ) : (
          <div className="grid gap-3">
            {automations.map((automation) => (
              <AutomationCard
                key={automation.id}
                automation={automation}
                projectName={(automation.targets.length > 0
                  ? automation.targets
                  : [automation.projectId]
                )
                  .map((id) => projectById.get(id)?.name ?? 'Unknown project')
                  .join(', ')}
                onEdit={() => openCreateAutomationModal(automation.id)}
                onToggleEnabled={(enabled) => setEnabled.mutate({ id: automation.id, enabled })}
                onDelete={() => {
                  if (confirm(`Delete automation "${automation.name}"?`)) {
                    remove.mutate(automation.id);
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface AutomationCardProps {
  automation: Automation;
  projectName: string;
  onEdit: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onDelete: () => void;
}

function AutomationCard({
  automation,
  projectName,
  onEdit,
  onToggleEnabled,
  onDelete,
}: AutomationCardProps) {
  const queryClient = useQueryClient();
  const [historyOpen, setHistoryOpen] = useState(false);
  const selectAutomationThread = useAppStore((s) => s.selectAutomationThread);
  const openAutomationDetail = useAppStore((s) => s.openAutomationDetail);

  const runNow = useMutation({
    mutationKey: ['run-now', automation.id],
    mutationFn: () =>
      window.shipcode.invoke<{ queued: boolean }>('automations:run-now', { id: automation.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] });
      queryClient.invalidateQueries({ queryKey: ['automation-run-history', automation.id] });
    },
  });

  const { data: runHistory = [], isLoading: isHistoryLoading } = useQuery<Thread[]>({
    queryKey: ['automation-run-history', automation.id],
    queryFn: () =>
      window.shipcode.invoke<Thread[]>('automations:run-history', {
        automationId: automation.id,
      }),
    enabled: historyOpen,
  });

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="flex items-center justify-between gap-4 p-4">
          <Button
            type="button"
            variant="ghost"
            className="h-auto min-w-0 flex-1 flex-col items-stretch justify-start rounded-md px-3 py-2 text-left hover:bg-hover/70"
            onClick={() => setHistoryOpen((o) => !o)}
            aria-label={`${historyOpen ? 'Collapse' : 'Expand'} run history for ${automation.name}`}
          >
            <div className="flex min-w-0 items-center gap-2">
              <ChevronDown
                size={14}
                className={cn(
                  'shrink-0 text-muted-foreground transition-transform',
                  historyOpen && 'rotate-180',
                )}
              />
              <span className="min-w-0 truncate text-[14px] font-medium text-primary">
                {automation.name}
              </span>
              {automation.lastStatus ? (
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium',
                    STATUS_COLOR[automation.lastStatus] ??
                      'bg-tertiary text-secondary border-border',
                  )}
                >
                  {automation.lastStatus}
                </span>
              ) : null}
            </div>
            <div className="mt-1 min-w-0 truncate pl-[22px] text-[12px] font-normal text-secondary">
              {projectName} · {describeCron(automation.cronExpr)}
            </div>
            <div className="mt-1 min-w-0 truncate pl-[22px] text-[11px] font-normal text-muted-foreground">
              {automation.lastStartedAt
                ? `Last run ${formatRelativeTime(automation.lastStartedAt, AUTOMATION_RELATIVE_TIME_OPTIONS)} · ${automation.runCount} total`
                : 'Never run'}
              {automation.enabled && automation.nextRunAt
                ? ` · Next ${formatRelativeTime(automation.nextRunAt, AUTOMATION_RELATIVE_TIME_OPTIONS)}`
                : ''}
            </div>
          </Button>

          <div className="flex items-center gap-2">
            <Switch
              checked={automation.enabled}
              onCheckedChange={(checked) => onToggleEnabled(checked)}
              aria-label={automation.enabled ? 'Disable' : 'Enable'}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => runNow.mutate()}
                  disabled={runNow.isPending}
                  aria-label="Run now"
                >
                  {runNow.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Play size={14} />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Run now</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit automation">
                  <Pencil size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Edit</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onDelete}
                  aria-label="Delete automation"
                >
                  <Trash2 size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Delete</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {historyOpen && (
          <div className="border-t border-border bg-tertiary/30 px-4 py-3">
            <h4 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Run History
            </h4>
            {isHistoryLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : runHistory.length === 0 ? (
              <p className="py-2 text-[12px] text-muted-foreground">No runs yet.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {runHistory.slice(0, RUN_HISTORY_LIMIT).map((thread) => (
                  <Button
                    key={thread.id}
                    type="button"
                    variant="ghost"
                    onClick={() => selectAutomationThread(thread.id)}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover"
                  >
                    <PhaseChip status={thread.status} />
                    <span className="flex-1 truncate text-[12px] text-secondary">
                      {describeAutomationRun(thread)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatRelativeTime(thread.createdAt, AUTOMATION_RELATIVE_TIME_OPTIONS)}
                    </span>
                  </Button>
                ))}
                {runHistory.length > RUN_HISTORY_LIMIT && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => openAutomationDetail(automation.id)}
                    className="mt-1 text-[12px] text-accent hover:text-accent/80"
                  >
                    View all {runHistory.length} runs →
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
