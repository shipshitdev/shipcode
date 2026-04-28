import type { Automation, Project } from '@shipcode/shared';
import {
  Button,
  Card,
  CardContent,
  cn,
  Loader2,
  Pencil,
  Play,
  Switch,
  Trash2,
} from '@shipshitdev/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cron } from 'croner';
import { useAppStore } from '../../stores/app-store';

function describeCron(expr: string): string {
  try {
    const job = new Cron(expr, { paused: true });
    const next = job.nextRun();
    if (!next) return expr;
    return `${expr} · next ${formatRelative(next)}`;
  } catch {
    return `Invalid: ${expr}`;
  }
}

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
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-start justify-between border-b border-secondary px-6 py-5">
        <div>
          <h1 className="text-lg font-semibold text-primary">Automations</h1>
          <p className="text-[13px] text-secondary">
            Recurring AI tasks that run on a cron schedule against a project.
          </p>
        </div>
        <Button onClick={() => openCreateAutomationModal()}>+ New automation</Button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-secondary" />
          </div>
        ) : automations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-secondary">
            <p className="text-[15px]">No automations yet.</p>
            <p className="mt-1 text-[13px] text-muted">
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
                projectName={projectById.get(automation.projectId)?.name ?? 'Unknown project'}
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
  const runNow = useMutation({
    mutationKey: ['run-now', automation.id],
    mutationFn: () =>
      window.shipcode.invoke<{ queued: boolean }>('automations:run-now', { id: automation.id }),
  });

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-center justify-between gap-4 p-4">
        <button
          type="button"
          className="flex-1 text-left"
          onClick={onEdit}
          aria-label={`Edit automation ${automation.name}`}
        >
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium text-primary">{automation.name}</span>
            {automation.lastStatus ? (
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                  STATUS_COLOR[automation.lastStatus] ??
                    'bg-tertiary text-secondary border-secondary',
                )}
              >
                {automation.lastStatus}
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-[12px] text-secondary">
            {projectName} · {describeCron(automation.cronExpr)}
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {automation.lastStartedAt
              ? `Last run ${formatRelative(automation.lastStartedAt)} · ${automation.runCount} total`
              : 'Never run'}
          </div>
        </button>

        <div className="flex items-center gap-2">
          <Switch
            checked={automation.enabled}
            onCheckedChange={(checked) => onToggleEnabled(checked)}
            aria-label={automation.enabled ? 'Disable' : 'Enable'}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => runNow.mutate()}
            disabled={runNow.isPending}
            aria-label="Run now"
            title="Run now"
          >
            {runNow.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onEdit}
            aria-label="Edit automation"
            title="Edit"
          >
            <Pencil size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            aria-label="Delete automation"
            title="Delete"
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
