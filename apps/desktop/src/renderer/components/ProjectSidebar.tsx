import type { DashboardStats, NotificationRecord } from '@shipcode/shared';
import { filterAttentionRequiredNotifications } from '@shipcode/shared';
import { Button, cn } from '@shipshitdev/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Clock3,
  Code2,
  DollarSign,
  GitPullRequest,
  Inbox,
  LayoutGrid,
  LayoutList,
  Plus,
  Search,
  Sparkles,
  Terminal,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useEffect } from 'react';
import { COL_RESIZE_BODY_CLASS_NAMES, useDragResize } from '../hooks/useDragResize';
import { NOTIFICATIONS_STALE_TIME } from '../query-stale-times';
import { type ProjectTab, useAppStore } from '../stores/app-store';
import { ThreadList } from './ThreadList';

const PROJECT_TAB_ITEMS: Array<{
  key: ProjectTab;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}> = [
  { key: 'issues', label: 'Board', icon: LayoutList },
  { key: 'git', label: 'Git', icon: GitPullRequest },
  { key: 'code', label: 'Code', icon: Code2 },
  { key: 'pull-requests', label: 'Pull Requests', icon: GitPullRequest },
  { key: 'insights', label: 'Insights', icon: Activity },
  { key: 'terminal', label: 'Terminal', icon: Terminal },
];

const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 280;
const SIDEBAR_DEFAULT = 256;

function useProjectSidebarView() {
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const viewMode = useAppStore((state) => state.viewMode);
  const settingsVisible = useAppStore((state) => state.settingsVisible);
  const selectProject = useAppStore((state) => state.selectProject);
  const openView = useAppStore((state) => state.openView);
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const openCreateIssueModal = useAppStore((state) => state.openCreateIssueModal);
  const openCommandPalette = useAppStore((state) => state.openCommandPalette);
  const projectTab = useAppStore((state) => state.projectTab);
  const setProjectTab = useAppStore((state) => state.setProjectTab);
  const queryClient = useQueryClient();

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => window.shipcode.invoke<DashboardStats>('dashboard:get-stats'),
    staleTime: 15_000,
  });

  const { data: notifs = [] } = useQuery<NotificationRecord[]>({
    queryKey: ['notifications'],
    queryFn: () => window.shipcode.invoke<NotificationRecord[]>('notification:list'),
    staleTime: NOTIFICATIONS_STALE_TIME,
  });

  // Left-anchored panel: dragging its right edge rightwards widens it.
  const { size: sidebarWidth, handleResizeMouseDown } = useDragResize({
    initialSize: SIDEBAR_DEFAULT,
    axis: 'x',
    min: SIDEBAR_MIN,
    max: SIDEBAR_MAX,
    bodyClassNames: COL_RESIZE_BODY_CLASS_NAMES,
  });

  useEffect(() => {
    const unsubFire = window.shipcode.on('notification:fire', () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
    const unsubDismiss = window.shipcode.on('notification:dismiss', () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
    return () => {
      unsubFire();
      unsubDismiss();
    };
  }, [queryClient]);

  const liveCount = stats?.agentsRunning ?? 0;
  const inboxItems = filterAttentionRequiredNotifications(
    notifs.filter((n) => n.dismissedAt === null),
  );
  const inboxCount = inboxItems.length;
  const hasFailure = inboxItems.some((n) => n.kind === 'failed' || n.kind === 'ci_blocked');
  const hasWarning = inboxItems.some(
    (n) => n.kind === 'approval' || n.kind === 'verification_exhausted',
  );
  const inboxBadgeClass = hasFailure
    ? 'bg-danger/15 text-danger'
    : hasWarning
      ? 'bg-warning/15 text-warning'
      : 'bg-tertiary text-secondary';

  return (
    <div
      className={cn(
        'shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-out',
        sidebarCollapsed ? 'w-0 opacity-0' : 'opacity-100',
      )}
      style={
        sidebarCollapsed
          ? { width: 0 }
          : { width: sidebarWidth, minWidth: SIDEBAR_MIN, maxWidth: SIDEBAR_MAX }
      }
    >
      <aside
        data-project-sidebar
        className="relative flex h-full flex-col border-r border-border bg-primary"
        style={{ width: sidebarWidth, minWidth: SIDEBAR_MIN }}
      >
        <div className="px-2 pt-3 space-y-0.5">
          {/* New Issue */}
          <Button
            variant="ghost"
            className="group/item h-auto w-full justify-start gap-2 pl-3 pr-5 py-2 text-[13px] font-normal text-secondary app-region-no-drag"
            onClick={() => openCreateIssueModal()}
            disabled={!activeProjectId}
          >
            <Plus size={14} className="shrink-0 text-secondary" />
            <span className="flex-1 truncate">New Issue</span>
            <kbd className="hidden group-hover/item:inline text-[10px] text-muted-foreground font-mono">
              ⌘N
            </kbd>
          </Button>

          {/* Search */}
          <Button
            variant="ghost"
            className="group/item h-auto w-full justify-start gap-2 pl-3 pr-5 py-2 text-[13px] font-normal text-secondary app-region-no-drag"
            onClick={() => openCommandPalette()}
          >
            <Search size={14} className="shrink-0 text-secondary" />
            <span className="flex-1 truncate">Search</span>
            <kbd className="hidden group-hover/item:inline text-[10px] text-muted-foreground font-mono">
              ⌘K
            </kbd>
          </Button>

          {/* Overview */}
          <Button
            variant="ghost"
            className={cn(
              'h-auto w-full justify-start gap-2 pl-3 pr-5 py-2 text-[13px] font-normal text-secondary app-region-no-drag',
              !settingsVisible && viewMode === 'overview' && 'bg-tertiary text-primary font-medium',
            )}
            onClick={() => openView('overview')}
          >
            <LayoutGrid size={14} className="shrink-0 text-secondary" />
            <span className="flex-1 truncate">Overview</span>
            {liveCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-agent/30 bg-agent/10 px-1.5 py-0.5 text-[10px] font-medium text-agent">
                <span className="relative flex size-1.5 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-agent opacity-60" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-agent" />
                </span>
                {liveCount} live
              </span>
            )}
          </Button>

          {/* Inbox */}
          <Button
            variant="ghost"
            className={cn(
              'h-auto w-full justify-start gap-2 pl-3 pr-5 py-2 text-[13px] font-normal text-secondary app-region-no-drag',
              !settingsVisible && viewMode === 'inbox' && 'bg-tertiary text-primary font-medium',
            )}
            onClick={() => openView('inbox')}
          >
            <Inbox size={14} className="shrink-0 text-secondary" />
            <span className="flex-1 truncate">Inbox</span>
            {inboxCount > 0 && (
              <span
                className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${inboxBadgeClass}`}
              >
                {inboxCount}
              </span>
            )}
          </Button>

          {/* Activity */}
          <Button
            variant="ghost"
            className={cn(
              'h-auto w-full justify-start gap-2 pl-3 pr-5 py-2 text-[13px] font-normal text-secondary app-region-no-drag',
              !settingsVisible && viewMode === 'activity' && 'bg-tertiary text-primary font-medium',
            )}
            onClick={() => openView('activity')}
          >
            <Activity size={14} className="shrink-0 text-secondary" />
            <span className="flex-1 truncate">Activity</span>
          </Button>

          {/* Skills */}
          <Button
            variant="ghost"
            className={cn(
              'h-auto w-full justify-start gap-2 pl-3 pr-5 py-2 text-[13px] font-normal text-secondary app-region-no-drag',
              !settingsVisible && viewMode === 'skills' && 'bg-tertiary text-primary font-medium',
            )}
            onClick={() => openView('skills')}
          >
            <Sparkles size={14} className="shrink-0 text-secondary" />
            <span className="flex-1 truncate">Skills</span>
          </Button>

          {/* Automations */}
          <Button
            variant="ghost"
            className={cn(
              'h-auto w-full justify-start gap-2 pl-3 pr-5 py-2 text-[13px] font-normal text-secondary app-region-no-drag',
              !settingsVisible &&
                viewMode === 'automations' &&
                'bg-tertiary text-primary font-medium',
            )}
            onClick={() => openView('automations')}
          >
            <Clock3 size={14} className="shrink-0 text-secondary" />
            <span className="flex-1 truncate">Automations</span>
          </Button>

          {/* Costs */}
          <Button
            variant="ghost"
            className={cn(
              'h-auto w-full justify-start gap-2 pl-3 pr-5 py-2 text-[13px] font-normal text-secondary app-region-no-drag',
              !settingsVisible && viewMode === 'costs' && 'bg-tertiary text-primary font-medium',
            )}
            onClick={() => openView('costs')}
          >
            <DollarSign size={14} className="shrink-0 text-secondary" />
            <span className="flex-1 truncate">Costs</span>
          </Button>
        </div>

        <ThreadList />

        {activeProjectId ? (
          <div className="shrink-0 border-t border-border px-1.5 py-1.5">
            {PROJECT_TAB_ITEMS.map(({ key, label, icon: Icon }) => (
              <Button
                key={key}
                variant="ghost"
                className={cn(
                  'h-auto w-full justify-start gap-2 px-2.5 py-1.5 text-[12px] font-normal text-secondary app-region-no-drag',
                  !settingsVisible &&
                    viewMode === 'project' &&
                    projectTab === key &&
                    'text-primary font-medium',
                )}
                onClick={() => {
                  if (key === 'issues') {
                    useAppStore.getState().openBoard();
                    return;
                  }
                  if (viewMode !== 'project') {
                    selectProject(activeProjectId);
                  }
                  setProjectTab(key);
                  useAppStore.getState().selectIssue(null);
                }}
              >
                <Icon size={12} className="shrink-0" />
                {label}
              </Button>
            ))}
          </div>
        ) : null}
        {/* Drag handle for resizing */}
        <Button
          type="button"
          variant="ghost"
          aria-label="Resize project sidebar"
          className="absolute top-0 right-0 bottom-0 h-auto w-1 cursor-col-resize rounded-none p-0 hover:bg-accent/20 active:bg-accent/30 transition-colors"
          onMouseDown={handleResizeMouseDown}
        />
      </aside>
    </div>
  );
}

export function ProjectSidebar() {
  return useProjectSidebarView();
}
