import type {
  AppSettings,
  CliProviderUsageMap,
  CliProviderUsageStatus,
  CliProviderUsageWindow,
  Project,
  SystemHealth,
  SystemResourceSnapshot,
} from '@shipcode/shared';
import { formatBytes, formatRelativeTime, getProjectProviderWarnings } from '@shipcode/shared';
import { ShipCodeLogoMark } from '@shipcode/ui';
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@shipshitdev/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Cpu,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  Terminal,
  X,
} from 'lucide-react';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';
import { ProjectProviderWarningPopover } from './ProjectProviderWarningPopover';

type ProviderTone = 'claude' | 'codex';

const CHECKED_AT_RELATIVE_TIME_OPTIONS = {
  mode: 'past',
  granularity: 'minutes',
  justNowThresholdSec: 45,
} as const;

function dotClass(_tone: ProviderTone, state: CliProviderUsageStatus['state']): string {
  if (state === 'blocked') return 'bg-danger';
  if (state === 'warning') return 'bg-warning';
  if (state === 'unknown') return 'bg-tertiary ring-1 ring-inset ring-border';
  return 'bg-success';
}

function barFillClass(_tone: ProviderTone, state: CliProviderUsageStatus['state']): string {
  if (state === 'blocked') return 'bg-danger';
  if (state === 'warning') return 'bg-warning';
  return 'bg-success';
}

function ProviderStatusDot({
  tone,
  state,
  title,
}: {
  tone: ProviderTone;
  state: CliProviderUsageStatus['state'];
  title: string;
}) {
  return (
    <span
      title={title}
      className={cn('inline-block size-2 shrink-0 rounded-full', dotClass(tone, state))}
    />
  );
}

function formatCheckedAt(checkedAt: string | null): string | null {
  if (!checkedAt) return null;
  const formatted = formatRelativeTime(checkedAt, CHECKED_AT_RELATIVE_TIME_OPTIONS);
  return formatted === '-' ? null : formatted;
}

function ProviderWindowBar({
  tone,
  state,
  window,
}: {
  tone: ProviderTone;
  state: CliProviderUsageStatus['state'];
  window: CliProviderUsageWindow;
}) {
  const left =
    window.leftPercent != null
      ? Math.max(0, Math.min(100, window.leftPercent))
      : window.usedPercent != null
        ? Math.max(0, Math.min(100, 100 - window.usedPercent))
        : null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-w-0 items-baseline justify-between gap-3 text-[10px] text-secondary">
        <span className="min-w-0 shrink truncate">{window.label}</span>
        <span className="min-w-0 max-w-[72%] truncate text-right tabular-nums text-muted-foreground">
          {left == null ? '—' : `${left}% left`}
          {window.resetDescription ? ` · ${window.resetDescription}` : ''}
        </span>
      </div>
      <div className="h-[3px] overflow-hidden rounded-full bg-tertiary">
        <div
          className={cn('h-full rounded-full transition-[width]', barFillClass(tone, state))}
          style={{ width: `${left ?? 0}%` }}
        />
      </div>
    </div>
  );
}

function ProviderDetailRow({
  label,
  tone,
  status,
}: {
  label: string;
  tone: ProviderTone;
  status: CliProviderUsageStatus;
}) {
  const queryClient = useQueryClient();
  const checked = formatCheckedAt(status.checkedAt);
  const poolExhausted =
    tone === 'claude' && (status.message?.includes('Agent-SDK credit pool exhausted') ?? false);
  return (
    <div
      className={cn(
        'flex flex-col gap-2 overflow-hidden rounded-md border px-2.5 py-2',
        status.state === 'blocked'
          ? 'border-danger/25 bg-danger/5'
          : status.state === 'warning'
            ? 'border-warning/25 bg-warning/5'
            : 'border-border/80 bg-primary/40',
      )}
    >
      <div className="flex items-center gap-2">
        <ProviderStatusDot tone={tone} state={status.state} title={`${label}: ${status.state}`} />
        <span className="text-[11px] font-medium tracking-tight text-primary">{label}</span>
        {status.loginMethod ? (
          <span className="rounded-sm border border-border/70 px-1 text-[9px] uppercase tracking-wide text-muted-foreground">
            {status.loginMethod}
          </span>
        ) : null}
        {status.version ? (
          <span className="ml-auto truncate text-[10px] tabular-nums text-muted-foreground">
            v{status.version}
          </span>
        ) : null}
      </div>

      {status.creditsRemaining != null ? (
        <div className="text-[10px] text-secondary">
          <span className="tabular-nums text-primary">{status.creditsRemaining}</span>
          <span className="text-muted-foreground"> credits remaining</span>
        </div>
      ) : null}

      {status.available && status.windows.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {status.windows.map((window) => (
            <ProviderWindowBar
              key={`${label}-${window.key}-${window.label}`}
              tone={tone}
              state={status.state}
              window={window}
            />
          ))}
        </div>
      ) : (
        <div className="text-[10px] text-secondary">
          {status.message ?? 'Usage data unavailable.'}
          <span className="ml-1 text-muted-foreground">Retries on the next check.</span>
        </div>
      )}

      {poolExhausted ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 self-start rounded-sm border border-danger/30 bg-danger/5 px-1.5 text-[10px] text-danger hover:bg-danger/10"
          onClick={async () => {
            await window.shipcode.invoke('provider-usage:reset-claude-pool');
            await queryClient.invalidateQueries({ queryKey: ['provider-usage'] });
          }}
          title="Clear the detected Agent-SDK pool-exhausted state and retry programmatic claude -p"
        >
          Reset pool state
        </Button>
      ) : null}

      {(checked || status.stale) && (
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span>{checked ? `Checked ${checked}` : ''}</span>
          {status.stale ? (
            <span className="rounded-sm border border-warning/30 bg-warning/10 px-1 text-warning">
              stale
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ProviderStatusBadge({
  providerUsage,
  onRefresh,
  isRefreshing,
}: {
  providerUsage: CliProviderUsageMap;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const overallState = [providerUsage.codex.state, providerUsage.claude.state].includes('blocked')
    ? 'blocked'
    : [providerUsage.codex.state, providerUsage.claude.state].includes('warning')
      ? 'warning'
      : 'ready';

  const codexTitle = `Codex: ${providerUsage.codex.message ?? providerUsage.codex.state}`;
  const claudeTitle = `Claude: ${providerUsage.claude.message ?? providerUsage.claude.state}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="CLI availability"
          className={cn(
            'flex items-center gap-2 rounded-md border px-2.5 py-1.5 app-region-no-drag',
            overallState === 'blocked'
              ? 'border-danger/25 bg-danger/5 hover:bg-danger/10'
              : overallState === 'warning'
                ? 'border-warning/25 bg-warning/5 hover:bg-warning/10'
                : 'border-border/80 bg-secondary/40 hover:bg-secondary/60',
          )}
        >
          <span className="text-[10px] font-medium tracking-[0.08em] text-secondary uppercase">
            CLI
          </span>
          <span className="flex items-center gap-1">
            <ProviderStatusDot tone="codex" state={providerUsage.codex.state} title={codexTitle} />
            <ProviderStatusDot
              tone="claude"
              state={providerUsage.claude.state}
              title={claudeTitle}
            />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[calc(100vw-24px)] max-w-[520px] rounded-xl bg-primary p-4 shadow-2xl shadow-black/40"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-medium text-primary">CLI availability</div>
            <div className="text-[10px] text-muted-foreground">
              Soft quota status from the local Claude and Codex CLIs.
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="mt-0.5 size-5 shrink-0 text-muted-foreground hover:text-primary"
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Refresh CLI status"
          >
            {isRefreshing ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <RefreshCw size={10} />
            )}
          </Button>
        </div>
        <div className="space-y-2">
          <ProviderDetailRow label="Codex" tone="codex" status={providerUsage.codex} />
          <ProviderDetailRow label="Claude" tone="claude" status={providerUsage.claude} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatPhaseLabel(phase: string | null): string {
  return phase ? phase.replace(/_/g, ' ') : 'process';
}

function cpuColorClass(percent: number | null): {
  text: string;
  border: string;
  bg: string;
  hover: string;
  fill: string;
} {
  if (percent == null || percent <= 50) {
    return {
      text: 'text-success',
      border: 'border-border/80',
      bg: 'bg-secondary/40',
      hover: 'hover:bg-secondary/60',
      fill: 'bg-success',
    };
  }
  if (percent <= 70) {
    return {
      text: 'text-warning',
      border: 'border-warning/25',
      bg: 'bg-warning/5',
      hover: 'hover:bg-warning/10',
      fill: 'bg-warning',
    };
  }
  return {
    text: 'text-danger',
    border: 'border-danger/25',
    bg: 'bg-danger/5',
    hover: 'hover:bg-danger/10',
    fill: 'bg-danger',
  };
}

function CpuGauge({ percent }: { percent: number | null }) {
  const colors = cpuColorClass(percent);
  const clamped = percent == null ? 0 : Math.max(0, Math.min(100, percent));

  return (
    <div className="flex items-center gap-2.5">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-tertiary">
        <div
          className={cn('h-full rounded-full transition-[width]', colors.fill)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className={cn('text-sm font-semibold tabular-nums', colors.text)}>
        {percent == null ? '—' : `${Math.round(percent)}%`}
      </span>
    </div>
  );
}

function ResourceUsageBadge() {
  const queryClient = useQueryClient();
  const { data: snapshot, isFetching } = useQuery<SystemResourceSnapshot | null>({
    queryKey: ['process-resources'],
    queryFn: async () => {
      try {
        return await window.shipcode.invoke<SystemResourceSnapshot>('process:list-resource-usage');
      } catch {
        return null;
      }
    },
    refetchInterval: 10_000,
    staleTime: 8_000,
    placeholderData: (prev) => prev,
  });

  const killProcess = useMutation({
    mutationFn: (processId: string) => window.shipcode.invoke('process:kill', { processId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['process-resources'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'running'] });
    },
  });

  if (!snapshot) return null;

  const cpuValue = snapshot.cpuPercent == null ? '—' : `${Math.round(snapshot.cpuPercent)}%`;
  const colors = cpuColorClass(snapshot.cpuPercent);
  const topTasks = snapshot.tasks.slice(0, 8);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="CPU usage"
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 app-region-no-drag',
            colors.border,
            colors.bg,
            colors.hover,
          )}
        >
          <Cpu size={12} className={colors.text} />
          <span className="text-[10px] font-medium tracking-[0.08em] uppercase tabular-nums">
            <span className="text-secondary">CPU </span>
            <span className={cn('inline-block min-w-[4ch] text-right', colors.text)}>
              {cpuValue}
            </span>
          </span>
          {isFetching ? <Loader2 size={10} className="animate-spin text-muted-foreground" /> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[calc(100vw-24px)] max-w-[560px] rounded-xl bg-primary p-4 shadow-2xl shadow-black/40"
      >
        <div className="mb-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-medium text-primary">CPU usage</div>
            <div className="text-[10px] text-muted-foreground">
              {snapshot.cpuPercent == null
                ? `${snapshot.cpuCoreCount} cores · warming up`
                : `${snapshot.cpuCoreCount} cores · ${snapshot.cpuPercent}% host CPU`}
            </div>
          </div>
          <CpuGauge percent={snapshot.cpuPercent} />
        </div>

        {topTasks.length > 0 ? (
          <div className="space-y-1.5">
            {topTasks.map((task) => {
              const title = task.threadTitle ?? `${task.type} ${task.processId.slice(0, 8)}`;
              return (
                <div
                  key={task.processId}
                  className={cn(
                    'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border px-2.5 py-2',
                    task.highCpu ? 'border-warning/25 bg-warning/5' : 'border-border/80',
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-medium text-primary">{title}</div>
                    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                      <span className="uppercase">{task.type}</span>
                      <span>{formatPhaseLabel(task.phase)}</span>
                      {task.projectName ? (
                        <span className="truncate">{task.projectName}</span>
                      ) : null}
                      <span className="font-mono">pid {task.pid ?? 'n/a'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right text-[10px] tabular-nums text-secondary">
                      <div className={task.highCpu ? 'text-warning' : 'text-primary'}>
                        {task.cpuPercent.toFixed(1)}%
                      </div>
                      <div className="text-muted-foreground">{formatBytes(task.memoryBytes)}</div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0 text-muted-foreground hover:text-danger"
                      title="Kill process"
                      aria-label={`Kill ${title}`}
                      disabled={killProcess.isPending}
                      onClick={() => killProcess.mutate(task.processId)}
                    >
                      <X size={12} />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-md border border-border/80 px-2.5 py-2 text-[11px] text-muted-foreground">
            No managed processes are running.
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function Titlebar() {
  const queryClient = useQueryClient();
  const settingsVisible = useAppStore((state) => state.settingsVisible);
  const toggleSettings = useAppStore((state) => state.toggleSettings);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const assistantVisible = useAppStore((state) => state.assistantVisible);
  const openAssistant = useAppStore((state) => state.openAssistant);
  const closeAssistant = useAppStore((state) => state.closeAssistant);
  const terminalVisible = useAppStore((state) => state.terminalVisible);
  const toggleTerminal = useAppStore((state) => state.toggleTerminal);
  const hasDetailView = useAppStore(
    (state) => state.activeIssue !== null || state.activeAutomationThreadId !== null,
  );

  const { data: activeProject } = useQuery<Project | null>({
    queryKey: ['project', activeProjectId],
    queryFn: () => {
      if (!activeProjectId) {
        throw new Error('Missing active project id');
      }
      return window.shipcode.invoke('project:get', { projectId: activeProjectId });
    },
    enabled: !!activeProjectId,
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });

  const { data: settings } = useQuery<AppSettings>({
    queryKey: ['settings'],
    queryFn: () => window.shipcode.invoke<AppSettings>('settings:get'),
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });

  // Polling owned by HealthBanner (health) and ProjectSidebar (provider-usage).
  // Titlebar piggybacks via shared query keys — no duplicate refetchInterval.
  const { data: systemHealth } = useQuery<SystemHealth>({
    queryKey: ['health'],
    queryFn: () => window.shipcode.invoke<SystemHealth>('health:check'),
    staleTime: 30_000,
  });

  const { data: providerUsage, isFetching: isProviderUsageFetching } =
    useQuery<CliProviderUsageMap>({
      queryKey: ['provider-usage'],
      queryFn: () => window.shipcode.invoke<CliProviderUsageMap>('provider-usage:check'),
      staleTime: 60_000,
    });

  const refreshProviderUsage = useMutation({
    mutationFn: () =>
      window.shipcode.invoke<CliProviderUsageMap>('provider-usage:check', { force: true }),
    onSuccess: (freshUsage) => {
      queryClient.setQueryData(['provider-usage'], freshUsage);
    },
  });

  const projectWarnings =
    activeProject && settings && systemHealth && providerUsage
      ? getProjectProviderWarnings(settings, activeProject, systemHealth, providerUsage)
      : [];
  const hasBlockedProjectWarning = projectWarnings.some(
    (warning) => warning.severity === 'blocked',
  );
  const projectWarningLabel = projectWarnings.length === 0 ? null : hasBlockedProjectWarning;

  // Live-running count intentionally NOT shown here — the sidebar
  // Mission Control entry already carries a pulsing "N live" badge, and
  // duplicating it in the titlebar adds noise without information.

  return (
    <div className="relative flex h-[var(--spacing-titlebar)] shrink-0 items-center justify-between border-b border-border bg-primary pl-[84px] pr-2 app-region-drag">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <button
          type="button"
          className="group relative flex size-6 shrink-0 items-center justify-center rounded-md app-region-no-drag hover:bg-elevated disabled:pointer-events-none disabled:opacity-50"
          onClick={toggleSidebar}
          title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          disabled={hasDetailView}
        >
          <ShipCodeLogoMark size={16} className="transition-opacity group-hover:opacity-0" />
          <span className="absolute inset-0 flex items-center justify-center text-secondary opacity-0 transition-opacity group-hover:opacity-100">
            {sidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </span>
        </button>
        {activeProject ? (
          <>
            <span className="text-muted-foreground">ShipCode</span>
            <span className="text-muted-foreground">/</span>
            <span className="truncate text-primary">{activeProject.name}</span>
            {projectWarningLabel && settings ? (
              <ProjectProviderWarningPopover
                settings={settings}
                project={activeProject}
                warnings={projectWarnings}
                className="shrink-0 app-region-no-drag"
              />
            ) : null}
          </>
        ) : (
          <span className="font-semibold tracking-tight text-primary">ShipCode</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <ResourceUsageBadge />
        {providerUsage ? (
          <ProviderStatusBadge
            providerUsage={providerUsage}
            onRefresh={() => refreshProviderUsage.mutate()}
            isRefreshing={isProviderUsageFetching || refreshProviderUsage.isPending}
          />
        ) : null}
        {!settingsVisible && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-7 w-7 app-region-no-drag hover:bg-elevated',
                assistantVisible && 'bg-elevated text-primary',
              )}
              onClick={assistantVisible ? closeAssistant : openAssistant}
              title={assistantVisible ? 'Hide agent' : 'Open agent'}
            >
              <MessageSquare
                size={14}
                className={assistantVisible ? 'text-primary' : 'text-secondary'}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-7 w-7 app-region-no-drag hover:bg-elevated',
                terminalVisible && 'bg-elevated text-primary',
              )}
              onClick={toggleTerminal}
              title={terminalVisible ? 'Hide terminal' : 'Show terminal'}
            >
              <Terminal size={14} className={terminalVisible ? 'text-primary' : 'text-secondary'} />
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'h-7 w-7 app-region-no-drag hover:bg-elevated',
            settingsVisible && 'bg-elevated text-primary',
          )}
          onClick={toggleSettings}
          title="Toggle Settings"
        >
          {settingsVisible ? (
            <X size={14} className="text-primary" />
          ) : (
            <Settings size={14} className="text-secondary" />
          )}
        </Button>
      </div>
    </div>
  );
}
