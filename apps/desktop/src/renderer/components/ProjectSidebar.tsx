import { useState, type MouseEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Archive,
  ArrowUpDown,
  Button,
  Check,
  cn,
  DollarSign,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Folder,
  Inbox,
  LayoutGrid,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Trash2,
  Wrench,
} from '@shipcode/ui';
import { useAppStore } from '../stores/app-store';
import type { AppSettings, DashboardStats, NotificationRecord, Project } from '@shipcode/shared';

type SortOrder = AppSettings['projectSortOrder'];

const SORT_LABELS: Record<SortOrder, string> = {
  recent: 'Recently used',
  alpha: 'Alphabetical',
  added: 'Date added',
};

export function ProjectSidebar() {
  const {
    activeProjectId,
    viewMode,
    settingsVisible,
    selectProject,
    openDashboard,
    openActivity,
    openInbox,
    openCosts,
    openSkills,
    sidebarCollapsed,
  } = useAppStore();
  const queryClient = useQueryClient();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects-visible'],
    queryFn: () => window.shipcode.invoke('project:list-visible'),
  });

  const { data: settings } = useQuery<AppSettings>({
    queryKey: ['settings'],
    queryFn: () => window.shipcode.invoke<AppSettings>('settings:get'),
  });
  const sortOrder: SortOrder = settings?.projectSortOrder ?? 'recent';

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => window.shipcode.invoke<DashboardStats>('dashboard:get-stats'),
    refetchInterval: 5000,
  });

  const { data: notifs = [] } = useQuery<NotificationRecord[]>({
    queryKey: ['notifications'],
    queryFn: () => window.shipcode.invoke<NotificationRecord[]>('notification:list'),
    refetchInterval: 5000,
  });

  // Shared invalidation across every project query key. Titlebar/IssueDetail
  // use ['projects'] (full registry), sidebar uses ['projects-visible'],
  // Settings uses ['projects-archived'] — any project mutation refreshes all three.
  const invalidateProjects = () => {
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['projects-visible'] });
    queryClient.invalidateQueries({ queryKey: ['projects-archived'] });
  };

  const addProject = useMutation({
    mutationFn: async () => {
      const path = await window.shipcode.invoke<string | null>('dialog:open-directory');
      if (!path) return null;
      return window.shipcode.invoke<Project>('project:add', { path });
    },
    onSuccess: (project) => {
      if (project) {
        invalidateProjects();
        selectProject(project.id);
        window.shipcode.invoke('github:refresh-issues', { projectId: project.id }).catch(() => {});
      }
    },
  });

  const setSortOrder = useMutation({
    mutationFn: (projectSortOrder: SortOrder) =>
      window.shipcode.invoke('settings:set', { projectSortOrder }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  const pinProject = useMutation({
    mutationFn: ({ projectId, pinned }: { projectId: string; pinned: boolean }) =>
      window.shipcode.invoke('project:pin', { projectId, pinned }),
    onSuccess: invalidateProjects,
  });

  const archiveProject = useMutation({
    mutationFn: (projectId: string) => window.shipcode.invoke('project:archive', { projectId }),
    onSuccess: (_data, projectId) => {
      if (activeProjectId === projectId) {
        selectProject(null);
        openDashboard();
      }
      invalidateProjects();
    },
    onError: (error: Error) => {
      window.alert(error.message || 'Failed to archive project');
    },
  });

  const removeProject = useMutation({
    mutationFn: (projectId: string) => window.shipcode.invoke('project:remove', { projectId }),
    onSuccess: (_data, projectId) => {
      if (activeProjectId === projectId) {
        selectProject(null);
        openDashboard();
      }
      invalidateProjects();
    },
    onError: (error: Error) => {
      window.alert(error.message || 'Failed to remove project');
    },
  });

  if (sidebarCollapsed) {
    return null;
  }

  const liveCount = stats?.agentsRunning ?? 0;
  const inboxCount = notifs.filter((n) => n.dismissedAt === null).length;

  // Pinned projects always float to top; within each group, apply the selected sort order.
  const sortedProjects = [...projects].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sortOrder === 'alpha') return a.name.localeCompare(b.name);
    if (sortOrder === 'added') return (a.createdAt || '').localeCompare(b.createdAt || '');
    // 'recent'
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });

  return (
    <aside className="flex w-[256px] min-w-[256px] flex-col border-r border-border bg-primary">
      <div className="flex items-center px-4 py-3">
        <h1 className="text-sm font-semibold tracking-tight text-primary">ShipCode</h1>
      </div>

      <div className="px-2 space-y-0.5">
        {/* Dashboard */}
        <Button
          variant="ghost"
          className={cn(
            'h-auto w-full justify-start gap-2 px-3 py-2 text-[13px] font-normal text-secondary app-region-no-drag',
            !settingsVisible && viewMode === 'dashboard' && 'bg-tertiary text-primary font-medium',
          )}
          onClick={() => openDashboard()}
        >
          <LayoutGrid size={14} className="shrink-0 text-secondary" />
          <span className="flex-1 truncate">Mission Control</span>
          {liveCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-tertiary px-1.5 py-0.5 text-[10px] font-medium text-accent">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
              {liveCount} live
            </span>
          )}
        </Button>

        {/* Activity */}
        <Button
          variant="ghost"
          className={cn(
            'h-auto w-full justify-start gap-2 px-3 py-2 text-[13px] font-normal text-secondary app-region-no-drag',
            !settingsVisible && viewMode === 'activity' && 'bg-tertiary text-primary font-medium',
          )}
          onClick={() => openActivity()}
        >
          <Activity size={14} className="shrink-0 text-secondary" />
          <span className="flex-1 truncate">Activity</span>
        </Button>

        {/* Inbox */}
        <Button
          variant="ghost"
          className={cn(
            'h-auto w-full justify-start gap-2 px-3 py-2 text-[13px] font-normal text-secondary app-region-no-drag',
            !settingsVisible && viewMode === 'inbox' && 'bg-tertiary text-primary font-medium',
          )}
          onClick={() => openInbox()}
        >
          <Inbox size={14} className="shrink-0 text-secondary" />
          <span className="flex-1 truncate">Inbox</span>
          {inboxCount > 0 && (
            <span className="inline-flex items-center justify-center rounded-full bg-tertiary px-1.5 py-0.5 text-[10px] font-medium text-secondary">
              {inboxCount}
            </span>
          )}
        </Button>

        {/* Costs */}
        <Button
          variant="ghost"
          className={cn(
            'h-auto w-full justify-start gap-2 px-3 py-2 text-[13px] font-normal text-secondary app-region-no-drag',
            !settingsVisible && viewMode === 'costs' && 'bg-tertiary text-primary font-medium',
          )}
          onClick={() => openCosts()}
        >
          <DollarSign size={14} className="shrink-0 text-secondary" />
          <span className="flex-1 truncate">Costs</span>
        </Button>

        {/* Skills */}
        <Button
          variant="ghost"
          className={cn(
            'h-auto w-full justify-start gap-2 px-3 py-2 text-[13px] font-normal text-secondary app-region-no-drag',
            !settingsVisible && viewMode === 'skills' && 'bg-tertiary text-primary font-medium',
          )}
          onClick={() => openSkills()}
        >
          <Wrench size={14} className="shrink-0 text-secondary" />
          <span className="flex-1 truncate">Skills</span>
        </Button>
      </div>

      <div className="mt-3 flex items-center justify-between px-4 text-[10px] font-semibold uppercase tracking-wider text-muted">
        <span>Projects</span>
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted"
                title={`Sort: ${SORT_LABELS[sortOrder]}`}
                aria-label="Sort projects"
              >
                <ArrowUpDown size={12} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(Object.keys(SORT_LABELS) as SortOrder[]).map((key) => (
                <DropdownMenuItem key={key} onSelect={() => setSortOrder.mutate(key)}>
                  <span className="flex h-3.5 w-3.5 items-center justify-center">
                    {sortOrder === key ? <Check size={12} /> : null}
                  </span>
                  {SORT_LABELS[key]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted app-region-no-drag"
            title="Add repository"
            aria-label="Add repository"
            onClick={() => addProject.mutate()}
          >
            <Plus size={12} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-1">
        {sortedProjects.map((project) => (
          <div key={project.id} className="relative group">
            <Button
              variant="ghost"
              className={cn(
                'h-auto w-full justify-start gap-2 px-3 py-2 text-[13px] font-normal text-secondary app-region-no-drag',
                viewMode === 'project' &&
                  activeProjectId === project.id &&
                  'bg-tertiary text-primary font-medium',
              )}
              onClick={() => selectProject(project.id)}
              onContextMenu={(e: MouseEvent) => {
                e.preventDefault();
                setOpenMenuId(project.id);
              }}
            >
              {project.pinned ? (
                <Pin size={12} className="shrink-0 text-accent fill-accent" />
              ) : (
                <Folder size={14} className="shrink-0 text-secondary" />
              )}
              <span className="flex-1 truncate text-primary">{project.name}</span>
            </Button>

            <DropdownMenu
              open={openMenuId === project.id}
              onOpenChange={(open) => setOpenMenuId(open ? project.id : null)}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1.5 top-1/2 h-6 w-6 -translate-y-1/2 text-muted opacity-0 group-hover:opacity-100 focus:opacity-100"
                  aria-label={`More actions for ${project.name}`}
                >
                  <MoreHorizontal size={12} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() =>
                    pinProject.mutate({ projectId: project.id, pinned: !project.pinned })
                  }
                >
                  {project.pinned ? (
                    <>
                      <PinOff size={12} /> Unpin
                    </>
                  ) : (
                    <>
                      <Pin size={12} /> Pin to top
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => archiveProject.mutate(project.id)}>
                  <Archive size={12} /> Archive
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    if (
                      window.confirm(
                        `Remove "${project.name}" from ShipCode? This does not delete the repository on disk.`,
                      )
                    ) {
                      removeProject.mutate(project.id);
                    }
                  }}
                  className="text-danger"
                >
                  <Trash2 size={12} /> Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>
    </aside>
  );
}
