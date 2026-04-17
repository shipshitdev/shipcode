import type {
  AppSettings,
  CliProviderUsageMap,
  CliProviderUsageStatus,
  CliProviderUsageWindow,
  Project,
  SystemHealth,
} from '@shipcode/shared';
import { getProjectProviderWarnings } from '@shipcode/shared';
import {
  Badge,
  Button,
  cn,
  PanelLeftClose,
  PanelLeftOpen,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Settings,
  Terminal,
  X,
} from '@shipcode/ui';
import { useQuery } from '@tanstack/react-query';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';

type ProviderTone = 'claude' | 'codex';

function dotClass(tone: ProviderTone, state: CliProviderUsageStatus['state']): string {
  if (state === 'blocked') return 'bg-danger';
  if (state === 'warning') return 'bg-warning';
  if (state === 'unknown') return 'bg-tertiary ring-1 ring-inset ring-border';
  return tone === 'codex' ? 'bg-agent' : 'bg-warning/80';
}

function barFillClass(tone: ProviderTone, state: CliProviderUsageStatus['state']): string {
  if (state === 'blocked') return 'bg-danger';
  if (state === 'warning') return 'bg-warning';
  return tone === 'codex' ? 'bg-agent/80' : 'bg-warning/80';
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
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', dotClass(tone, state))}
    />
  );
}

function formatCheckedAt(checkedAt: string | null): string | null {
  if (!checkedAt) return null;
  const checked = new Date(checkedAt).getTime();
  if (Number.isNaN(checked)) return null;
  const diffMs = Date.now() - checked;
  if (diffMs < 0) return 'just now';
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 45) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
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
  const used = window.usedPercent == null ? null : Math.max(0, Math.min(100, window.usedPercent));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-[10px] text-secondary">
        <span className="truncate">{window.label}</span>
        <span className="shrink-0 tabular-nums text-muted">
          {used == null ? '—' : `${used}% used`}
          {window.resetDescription ? ` · ${window.resetDescription}` : ''}
        </span>
      </div>
      <div className="h-[3px] overflow-hidden rounded-full bg-tertiary">
        <div
          className={cn('h-full rounded-full transition-[width]', barFillClass(tone, state))}
          style={{ width: `${used ?? 0}%` }}
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
  const checked = formatCheckedAt(status.checkedAt);
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-md border px-2.5 py-2',
        status.state === 'blocked'
          ? 'border-danger/25 bg-danger/5'
          : status.state === 'warning'
            ? 'border-warning/25 bg-warning/5'
            : 'border-border/80 bg-secondary/40',
      )}
    >
      <div className="flex items-center gap-2">
        <ProviderStatusDot tone={tone} state={status.state} title={`${label}: ${status.state}`} />
        <span className="text-[11px] font-medium tracking-tight text-primary">{label}</span>
        {status.loginMethod ? (
          <span className="rounded-sm border border-border/70 px-1 text-[9px] uppercase tracking-wide text-muted">
            {status.loginMethod}
          </span>
        ) : null}
        {status.version ? (
          <span className="ml-auto truncate text-[10px] tabular-nums text-muted">
            v{status.version}
          </span>
        ) : null}
      </div>

      {status.accountEmail ? (
        <div className="truncate text-[10px] text-muted">{status.accountEmail}</div>
      ) : null}

      {status.creditsRemaining != null ? (
        <div className="text-[10px] text-secondary">
          <span className="tabular-nums text-primary">{status.creditsRemaining}</span>
          <span className="text-muted"> credits remaining</span>
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
          <span className="ml-1 text-muted">Retries on the next check.</span>
        </div>
      )}

      {(checked || status.stale) && (
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted">
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

function ProviderStatusBadge({ providerUsage }: { providerUsage: CliProviderUsageMap }) {
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
        <button
          type="button"
          aria-label="CLI availability"
          className={cn(
            'flex items-center gap-2 rounded-md border px-2.5 py-1.5 outline-none app-region-no-drag transition-colors',
            'focus-visible:ring-1 focus-visible:ring-accent',
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
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[320px] bg-primary/98 p-2 shadow-2xl backdrop-blur-sm"
      >
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
      </PopoverContent>
    </Popover>
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
