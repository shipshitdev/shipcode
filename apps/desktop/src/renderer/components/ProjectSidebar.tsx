import type { DashboardStats, NotificationRecord } from '@shipcode/shared';
import { filterAttentionRequiredNotifications } from '@shipcode/shared';
import { Button, cn } from '@shipshitdev/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Clock3,
  Code2,
  DollarSign,
  GitBranch,
  GitPullRequest,
  Inbox,
  LayoutGrid,
  LayoutList,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  Terminal,
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { useEffect } from 'react';
import { COL_RESIZE_BODY_CLASS_NAMES, useDragResize } from '../hooks/useDragResize';
import { NOTIFICATIONS_STALE_TIME } from '../query-stale-times';
import { type ProjectTab, useAppStore } from '../stores/app-store';
import { ProjectSwitcher } from './ProjectSwitcher';
import { ThreadList } from './ThreadList';

const PROJECT_TAB_ITEMS: Array<{
  key: ProjectTab;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}> = [
  { key: 'conversations', label: 'Conversations', icon: MessageSquare },
  { key: 'issues', label: 'Board', icon: LayoutList },
  { key: 'git', label: 'Git', icon: GitBranch },
  { key: 'code', label: 'Code', icon: Code2 },
  { key: 'pull-requests', label: 'Pull Requests', icon: GitPullRequest },
  { key: 'insights', label: 'Insights', icon: Activity },
  { key: 'terminal', label: 'Terminal', icon: Terminal },
];

const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 280;
const SIDEBAR_DEFAULT = 256;

function SidebarLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </div>
  );
}

function SidebarNavButton({
  icon: Icon,
  label,
  isActive,
  disabled,
  badge,
  shortcut,
  onClick,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  isActive?: boolean;
  disabled?: boolean;
  badge?: ReactNode;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      disabled={disabled}
      className={cn(
        'group/item h-auto w-full justify-start gap-2 px-2.5 py-1.5 text-[13px] font-normal text-secondary app-region-no-drag',
        isActive && 'bg-tertiary text-primary font-medium',
      )}
      onClick={onClick}
    >
      <Icon size={14} className="shrink-0 text-secondary" />
      <span className="flex-1 truncate text-left">{label}</span>
      {badge}
      {shortcut ? (
        <kbd className="hidden group-hover/item:inline font-mono text-[10px] text-muted-foreground">
          {shortcut}
        </kbd>
      ) : null}
    </Button>
  );
}

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
  const workspaceActive = (mode: typeof viewMode) => !settingsVisible && viewMode === mode;

  const openProjectSurface = (tab: ProjectTab) => {
    if (!activeProjectId) return;
    if (tab === 'conversations') {
      useAppStore.getState().openConversations();
      return;
    }
    if (tab === 'issues') {
      useAppStore.getState().openBoard();
      return;
    }
    if (viewMode !== 'project') {
      selectProject(activeProjectId);
    }
    setProjectTab(tab);
    useAppStore.getState().selectIssue(null);
  };

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
        <div className="shrink-0 px-2 pt-2">
          <ProjectSwitcher />
        </div>

        <div className="shrink-0 px-1.5 pt-1">
          <SidebarNavButton
            icon={Search}
            label="Search"
            shortcut="⌘K"
            onClick={() => openCommandPalette()}
          />
        </div>

        <SidebarLabel>Workspace</SidebarLabel>
        <div className="shrink-0 px-1.5">
          <SidebarNavButton
            icon={LayoutGrid}
            label="Overview"
            isActive={workspaceActive('overview')}
            badge={
              liveCount > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-agent/30 bg-agent/10 px-1.5 py-0.5 text-[10px] font-medium text-agent">
                  <span className="relative flex size-1.5 items-center justify-center">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-agent opacity-60" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-agent" />
                  </span>
                  {liveCount} live
                </span>
              ) : null
            }
            onClick={() => openView('overview')}
          />
          <SidebarNavButton
            icon={Inbox}
            label="Inbox"
            isActive={workspaceActive('inbox')}
            badge={
              inboxCount > 0 ? (
                <span
                  className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${inboxBadgeClass}`}
                >
                  {inboxCount}
                </span>
              ) : null
            }
            onClick={() => openView('inbox')}
          />
          <SidebarNavButton
            icon={Activity}
            label="Activity"
            isActive={workspaceActive('activity')}
            onClick={() => openView('activity')}
          />
        </div>

        {activeProjectId ? (
          <>
            <SidebarLabel>Project</SidebarLabel>
            <div className="shrink-0 px-1.5" data-testid="sidebar-project-nav">
              <SidebarNavButton
                icon={Plus}
                label="New Issue"
                shortcut="⌘N"
                disabled={!activeProjectId}
                onClick={() => openCreateIssueModal()}
              />
              {PROJECT_TAB_ITEMS.map(({ key, label, icon }) => (
                <SidebarNavButton
                  key={key}
                  icon={icon}
                  label={label}
                  isActive={!settingsVisible && viewMode === 'project' && projectTab === key}
                  onClick={() => openProjectSurface(key)}
                />
              ))}
            </div>
            <ThreadList />
          </>
        ) : (
          <div
            className="flex min-h-0 flex-1 flex-col justify-start px-3 pt-6 text-[12px] leading-5 text-muted-foreground"
            data-testid="sidebar-no-project"
          >
            Select a project to open its conversations and issues.
          </div>
        )}

        <div className="mt-auto shrink-0 border-t border-border px-1.5 py-2">
          <SidebarNavButton
            icon={Sparkles}
            label="Skills"
            isActive={workspaceActive('skills')}
            onClick={() => openView('skills')}
          />
          <SidebarNavButton
            icon={Clock3}
            label="Automations"
            isActive={workspaceActive('automations')}
            onClick={() => openView('automations')}
          />
          <SidebarNavButton
            icon={DollarSign}
            label="Costs"
            isActive={workspaceActive('costs')}
            onClick={() => openView('costs')}
          />
        </div>

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
