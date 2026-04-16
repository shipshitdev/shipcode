import type { AppSettings, CliProviderUsageMap, Project, SystemHealth } from '@shipcode/shared';
import { getProjectProviderWarnings } from '@shipcode/shared';
import {
  Badge,
  Button,
  cn,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Terminal,
  X,
} from '@shipcode/ui';
import { useQuery } from '@tanstack/react-query';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';

function ProviderMeter({
  tone,
  status,
  compact = false,
}: {
  tone: 'claude' | 'codex';
  status: CliProviderUsageMap['claude'];
  compact?: boolean;
}) {
  const fillClass =
    tone === 'codex'
      ? status.state === 'blocked'
        ? 'bg-danger'
        : status.state === 'warning'
          ? 'bg-agent'
          : 'bg-agent/80'
      : status.state === 'blocked'
        ? 'bg-danger'
        : status.state === 'warning'
          ? 'bg-warning'
          : 'bg-warning/80';

  const visibleWindows = status.windows.slice(0, compact ? 2 : 3);

  return (
    <>
      {status.available ? (
        <div className={cn('flex flex-col gap-0.5', compact ? 'w-8' : 'w-10')}>
          {visibleWindows.map((window) => (
            <div
              key={`${tone}-${window.key}`}
              className={cn(
                'overflow-hidden rounded-full bg-tertiary',
                compact ? 'h-[3px]' : 'h-[4px]',
              )}
            >
              <div
                className={cn('h-full rounded-full transition-[width]', fillClass)}
                style={{ width: `${Math.max(0, Math.min(100, window.leftPercent ?? 0))}%` }}
              />
            </div>
          ))}
        </div>
      ) : (
        <span className="text-[10px] text-muted">—</span>
      )}
      {(status.state === 'warning' || status.state === 'blocked') && (
        <span
          className={cn(
            'shrink-0 rounded-full',
            compact ? 'h-1.5 w-1.5' : 'h-2 w-2',
            status.state === 'blocked' ? 'bg-danger' : 'bg-warning',
          )}
        />
      )}
    </>
  );
}

function ProviderDetailRow({
  label,
  tone,
  status,
}: {
  label: string;
  tone: 'claude' | 'codex';
  status: CliProviderUsageMap['claude'];
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-2.5 py-2',
        status.state === 'blocked'
          ? 'border-danger/25 bg-danger/5'
          : status.state === 'warning'
            ? 'border-warning/25 bg-warning/5'
            : 'border-border/80 bg-secondary/40',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium tracking-tight text-primary">{label}</span>
          {status.loginMethod ? (
            <span className="text-[10px] uppercase tracking-wide text-muted">
              {status.loginMethod}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-col gap-0.5 text-[10px] text-secondary">
          {status.available ? (
            status.windows.map((window) => (
              <span key={`${label}-${window.key}`}>
                {window.label}: {window.leftPercent == null ? '—' : `${window.leftPercent}% left`}
                {window.resetDescription ? ` · ${window.resetDescription}` : ''}
              </span>
            ))
          ) : (
            <span>{status.message ?? 'usage unavailable'}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ProviderMeter tone={tone} status={status} />
      </div>
    </div>
  );
}

function ProviderStatusBadge({ providerUsage }: { providerUsage: CliProviderUsageMap }) {
  const overallState = [providerUsage.codex.state, providerUsage.claude.state].includes('blocked')
    ? 'blocked'
    : [providerUsage.codex.state, providerUsage.claude.state].includes('warning')
      ? 'warning'
      : 'ready';

  return (
    <div className="relative app-region-no-drag">
      <div className="group relative">
        <div
          className={cn(
            'flex items-center gap-2 rounded-md border px-2.5 py-1.5',
            overallState === 'blocked'
              ? 'border-danger/25 bg-danger/5'
              : overallState === 'warning'
                ? 'border-warning/25 bg-warning/5'
                : 'border-border/80 bg-secondary/40',
          )}
        >
          <span className="text-[10px] font-medium tracking-[0.08em] text-secondary uppercase">
            CLI
          </span>
          <div className="flex items-center gap-1.5">
            <ProviderMeter tone="codex" status={providerUsage.codex} compact />
            <ProviderMeter tone="claude" status={providerUsage.claude} compact />
          </div>
        </div>

        <div className="pointer-events-none absolute right-0 top-full z-30 pt-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <div className="pointer-events-auto w-[260px] rounded-lg border border-border bg-primary/98 p-2 shadow-2xl backdrop-blur-sm">
            <div className="mb-2 px-1">
              <div className="text-[11px] font-medium text-primary">CLI availability</div>
              <div className="text-[10px] text-muted">
                Soft quota status from the local Claude and Codex CLIs. Project warnings stay in the
                sidebar.
              </div>
            </div>
            <div className="space-y-2">
              <ProviderDetailRow label="Codex" tone="codex" status={providerUsage.codex} />
              <ProviderDetailRow label="Claude" tone="claude" status={providerUsage.claude} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Titlebar() {
  const {
    settingsVisible,
    toggleSettings,
    activeProjectId,
    sidebarCollapsed,
    toggleSidebar,
    terminalVisible,
    toggleTerminal,
  } = useAppStore();

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

  const { data: systemHealth } = useQuery<SystemHealth>({
    queryKey: ['health'],
    queryFn: () => window.shipcode.invoke<SystemHealth>('health:check'),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });

  const { data: providerUsage } = useQuery<CliProviderUsageMap>({
    queryKey: ['provider-usage'],
    queryFn: () => window.shipcode.invoke<CliProviderUsageMap>('provider-usage:check'),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });

  const projectWarnings =
    activeProject && settings && systemHealth && providerUsage
      ? getProjectProviderWarnings(settings, activeProject, systemHealth, providerUsage)
      : [];
  const hasBlockedProjectWarning = projectWarnings.some(
    (warning) => warning.severity === 'blocked',
  );
  const projectWarningLabel =
    projectWarnings.length === 0 ? null : hasBlockedProjectWarning ? 'Blocked' : 'Low';
  const projectWarningTitle =
    projectWarnings.length === 0
      ? undefined
      : projectWarnings.map((warning) => warning.message).join(' · ');

  // Live-running count intentionally NOT shown here — the sidebar
  // Mission Control entry already carries a pulsing "N live" badge, and
  // duplicating it in the titlebar adds noise without information.

  return (
    <div className="relative flex h-[var(--spacing-titlebar)] shrink-0 items-center justify-between border-b border-border bg-primary pl-[84px] pr-2 app-region-drag">
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[11px] font-semibold tracking-tight text-secondary select-none">
        ShipCode
      </span>
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 app-region-no-drag"
          onClick={toggleSidebar}
          title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </Button>
        {activeProject ? (
          <>
            <span className="text-muted">ShipCode</span>
            <span className="text-muted">/</span>
            <span className="truncate text-primary">{activeProject.name}</span>
            {projectWarningLabel ? (
              <Badge
                variant="warning"
                className={cn(
                  'shrink-0 text-[10px]',
                  hasBlockedProjectWarning && 'border-danger/30 bg-danger/10 text-danger',
                )}
                title={projectWarningTitle}
              >
                {projectWarningLabel}
              </Badge>
            ) : null}
          </>
        ) : (
          <span className="font-semibold tracking-tight text-primary">ShipCode</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {providerUsage ? <ProviderStatusBadge providerUsage={providerUsage} /> : null}
        {!settingsVisible && (
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(
              'app-region-no-drag hover:bg-elevated',
              terminalVisible && 'bg-elevated text-primary',
            )}
            onClick={toggleTerminal}
            title={terminalVisible ? 'Hide terminal' : 'Show terminal'}
          >
            <Terminal size={14} className={terminalVisible ? 'text-primary' : 'text-secondary'} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(
            'app-region-no-drag hover:bg-elevated',
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
