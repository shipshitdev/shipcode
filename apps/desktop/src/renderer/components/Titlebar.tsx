import type { DashboardStats, Project } from '@shipcode/shared';
import { Button, PanelLeftClose, PanelLeftOpen, Settings, Terminal, X } from '@shipcode/ui';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../stores/app-store';

export function Titlebar() {
  const {
    settingsVisible,
    toggleSettings,
    openDashboard,
    activeProjectId,
    sidebarCollapsed,
    toggleSidebar,
    terminalVisible,
    toggleTerminal,
  } = useAppStore();

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => window.shipcode.invoke('project:list'),
  });

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => window.shipcode.invoke<DashboardStats>('dashboard:get-stats'),
    refetchInterval: 5000,
  });

  const activeProject = activeProjectId
    ? (projects.find((p) => p.id === activeProjectId) ?? null)
    : null;

  const liveCount = stats?.agentsRunning ?? 0;

  return (
    <div className="relative flex h-[var(--spacing-titlebar)] shrink-0 items-center justify-between border-b border-border bg-primary pl-[84px] pr-2 app-region-drag">
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[11px] font-semibold tracking-tight text-secondary select-none">
        ShipCode
      </span>
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 app-region-no-drag"
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
          </>
        ) : (
          <span className="font-semibold tracking-tight text-primary">ShipCode</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {liveCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openDashboard()}
            className="h-7 gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2 text-[11px] font-medium text-accent app-region-no-drag hover:bg-accent/20 hover:text-accent"
            title="Open Mission Control"
          >
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            {liveCount} running
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 app-region-no-drag hover:bg-elevated"
          onClick={toggleTerminal}
          title={terminalVisible ? 'Hide terminal' : 'Show terminal'}
        >
          <Terminal
            size={14}
            className={terminalVisible ? 'text-primary' : 'text-secondary'}
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 app-region-no-drag hover:bg-elevated"
          onClick={toggleSettings}
          title="Toggle Settings"
        >
          {settingsVisible ? <X size={14} /> : <Settings size={14} />}
        </Button>
      </div>
    </div>
  );
}
