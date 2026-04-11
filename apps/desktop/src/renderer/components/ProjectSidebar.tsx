import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  cn,
  Folder,
  Plus,
  Pin,
  PinOff,
  Archive,
  Trash2,
  MoreHorizontal,
  ArrowUpDown,
  Check,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
        <button
          type="button"
          className={cn(
            'flex w-full cursor-pointer items-center gap-2 rounded-md border-none bg-transparent px-3 py-2 text-left text-[13px] text-secondary app-region-no-drag hover:bg-hover hover:text-primary focus:outline-none',
            !settingsVisible && viewMode === 'dashboard' && 'bg-tertiary text-primary font-medium',
          )}
          onClick={() => openDashboard()}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            className="shrink-0 text-secondary"
          >
            <rect
              x="1.5"
              y="1.5"
              width="5.5"
              height="5.5"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <rect
              x="9"
              y="1.5"
              width="5.5"
              height="5.5"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <rect
              x="1.5"
              y="9"
              width="5.5"
              height="5.5"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <rect
              x="9"
              y="9"
              width="5.5"
              height="5.5"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.4"
            />
          </svg>
          <span className="flex-1 truncate">Mission Control</span>
          {liveCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-tertiary px-1.5 py-0.5 text-[10px] font-medium text-accent">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
              {liveCount} live
            </span>
          )}
        </button>

        {/* Activity */}
        <button
          type="button"
          className={cn(
            'flex w-full cursor-pointer items-center gap-2 rounded-md border-none bg-transparent px-3 py-2 text-left text-[13px] text-secondary app-region-no-drag hover:bg-hover hover:text-primary focus:outline-none',
            !settingsVisible && viewMode === 'activity' && 'bg-tertiary text-primary font-medium',
          )}
          onClick={() => openActivity()}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            className="shrink-0 text-secondary"
          >
            <line
              x1="3"
              y1="4"
              x2="13"
              y2="4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <line
              x1="3"
              y1="8"
              x2="13"
              y2="8"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <line
              x1="3"
              y1="12"
              x2="9"
              y2="12"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
          <span className="flex-1 truncate">Activity</span>
        </button>

        {/* Inbox */}
        <button
          type="button"
          className={cn(
            'flex w-full cursor-pointer items-center gap-2 rounded-md border-none bg-transparent px-3 py-2 text-left text-[13px] text-secondary app-region-no-drag hover:bg-hover hover:text-primary focus:outline-none',
            !settingsVisible && viewMode === 'inbox' && 'bg-tertiary text-primary font-medium',
          )}
          onClick={() => openInbox()}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            className="shrink-0 text-secondary"
          >
            <path
              d="M8 1.5A4.5 4.5 0 0 0 3.5 6v3.5L2 11h12l-1.5-1.5V6A4.5 4.5 0 0 0 8 1.5z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path d="M6.5 11.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          <span className="flex-1 truncate">Inbox</span>
          {inboxCount > 0 && (
            <span className="inline-flex items-center justify-center rounded-full bg-tertiary px-1.5 py-0.5 text-[10px] font-medium text-secondary">
              {inboxCount}
            </span>
          )}
        </button>

        {/* Costs */}
        <button
          type="button"
          className={cn(
            'flex w-full cursor-pointer items-center gap-2 rounded-md border-none bg-transparent px-3 py-2 text-left text-[13px] text-secondary app-region-no-drag hover:bg-hover hover:text-primary focus:outline-none',
            !settingsVisible && viewMode === 'costs' && 'bg-tertiary text-primary font-medium',
          )}
          onClick={() => openCosts()}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            className="shrink-0 text-secondary"
          >
            <line
              x1="12"
              y1="1"
              x2="12"
              y2="23"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="flex-1 truncate">Costs</span>
        </button>

        {/* Skills */}
        <button
          type="button"
          className={cn(
            'flex w-full cursor-pointer items-center gap-2 rounded-md border-none bg-transparent px-3 py-2 text-left text-[13px] text-secondary app-region-no-drag hover:bg-hover hover:text-primary focus:outline-none',
            !settingsVisible && viewMode === 'skills' && 'bg-tertiary text-primary font-medium',
          )}
          onClick={() => openSkills()}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            className="shrink-0 text-secondary"
          >
            <path
              d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="flex-1 truncate">Skills</span>
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between px-4 text-[10px] font-semibold uppercase tracking-wider text-muted">
        <span>Projects</span>
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="cursor-pointer rounded border-none bg-transparent p-0.5 text-muted hover:text-primary"
                title={`Sort: ${SORT_LABELS[sortOrder]}`}
                aria-label="Sort projects"
              >
                <ArrowUpDown size={12} />
              </button>
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
          <button
            type="button"
            className="cursor-pointer rounded border-none bg-transparent p-0.5 text-muted hover:text-primary app-region-no-drag"
            title="Add repository"
            aria-label="Add repository"
            onClick={() => addProject.mutate()}
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-1">
        {sortedProjects.map((project) => (
          <div key={project.id} className="relative group">
            <button
              type="button"
              className={cn(
                'flex w-full cursor-pointer items-center gap-2 rounded-md border-none bg-transparent px-3 py-2 text-left text-[13px] text-secondary app-region-no-drag hover:bg-hover hover:text-primary focus:outline-none',
                viewMode === 'project' &&
                  activeProjectId === project.id &&
                  'bg-tertiary text-primary font-medium',
              )}
              onClick={() => selectProject(project.id)}
              onContextMenu={(e) => {
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
            </button>

            <DropdownMenu
              open={openMenuId === project.id}
              onOpenChange={(open) => setOpenMenuId(open ? project.id : null)}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer rounded border-none bg-transparent p-1 text-muted opacity-0 group-hover:opacity-100 hover:bg-tertiary hover:text-primary focus:opacity-100 focus:outline-none"
                  aria-label={`More actions for ${project.name}`}
                >
                  <MoreHorizontal size={12} />
                </button>
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
