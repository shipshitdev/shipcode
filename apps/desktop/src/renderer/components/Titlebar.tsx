import type { Project } from '@shipcode/shared';
import { Button, cn, PanelLeftClose, PanelLeftOpen, Settings, Terminal, X } from '@shipcode/ui';
import { useQuery } from '@tanstack/react-query';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';

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
          </>
        ) : (
          <span className="font-semibold tracking-tight text-primary">ShipCode</span>
        )}
      </div>
      <div className="flex items-center gap-2">
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
