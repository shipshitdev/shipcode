import {
  type AppSettings,
  type CliProviderUsageMap,
  type DashboardStats,
  filterAttentionRequiredNotifications,
  getProjectProviderWarnings,
  type IntegrationStatus,
  type NotificationRecord,
  type Project,
} from '@shipcode/shared';
import {
  Activity,
  Archive,
  ArrowUpDown,
  Badge,
  Button,
  Check,
  Code2,
  cn,
  DollarSign,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Folder,
  FolderOpen,
  Ghost,
  Inbox,
  LayoutGrid,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Settings,
  Sparkles,
  Terminal,
  Trash2,
  Wrench,
} from '@shipcode/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NOTIFICATIONS_STALE_TIME, STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 256;
const SIDEBAR_DEFAULT = SIDEBAR_MAX;

type SortOrder = AppSettings['projectSortOrder'];
type ProjectWithPathState = Project & { pathExists?: boolean };

const SORT_LABELS: Record<SortOrder, string> = {
  recent: 'Recently used',
  alpha: 'Alphabetical',
  added: 'Date added',
};

const PROJECT_OPEN_TARGETS: AppSettings['projectOpenTarget'][] = [
  'cursor',
  'finder',
  'terminal',
  'ghostty',
  'vscode',
];

type AppIcon = ComponentType<{ size?: number; className?: string }>;

const PROJECT_OPEN_TARGET_ICONS: Record<AppSettings['projectOpenTarget'], AppIcon> = {
  cursor: Sparkles,
  finder: FolderOpen,
  terminal: Terminal,
  ghostty: Ghost,
  vscode: Code2,
};

export function ProjectSidebar() {
  const {
    activeProjectId,
    viewMode,
    settingsVisible,
    selectProject,
    openOverview,
    openActivity,
    openInbox,
    openCosts,
    openSkills,
    openProjectSettingsModal,
    openProjectSetupModal,
    sidebarCollapsed,
  } = useAppStore();
  const queryClient = useQueryClient();

  const { data: projects = [] } = useQuery<ProjectWithPathState[]>({
    queryKey: ['projects-visible'],
    queryFn: () => window.shipcode.invoke('project:list-visible'),
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });

  const { data: settings } = useQuery<AppSettings>({
    queryKey: ['settings'],
    queryFn: () => window.shipcode.invoke<AppSettings>('settings:get'),
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });
  const sortOrder: SortOrder = settings?.projectSortOrder ?? 'recent';

  const { data: integrations } = useQuery<IntegrationStatus>({
    queryKey: ['integrations'],
    queryFn: () => window.shipcode.invoke('integrations:check'),
    staleTime: 30_000,
  });

  const { data: providerUsage } = useQuery<CliProviderUsageMap>({
    queryKey: ['provider-usage'],
    queryFn: () => window.shipcode.invoke<CliProviderUsageMap>('provider-usage:check'),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => window.shipcode.invoke<DashboardStats>('dashboard:get-stats'),
  });

  const { data: notifs = [] } = useQuery<NotificationRecord[]>({
    queryKey: ['notifications'],
    queryFn: () => window.shipcode.invoke<NotificationRecord[]>('notification:list'),
    staleTime: NOTIFICATIONS_STALE_TIME,
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
        openProjectSetupModal(project.id);
        window.shipcode
          .invoke('github:refresh-issues', { projectId: project.id, force: true })
          .catch(() => {});
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
        openOverview();
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
        openOverview();
      }
      invalidateProjects();
    },
    onError: (error: Error) => {
      window.alert(error.message || 'Failed to remove project');
    },
  });

  const relinkProject = useMutation({
    mutationFn: async (projectId: string) => {
      const path = await window.shipcode.invoke<string | null>('dialog:open-directory');
      if (!path) return null;
      return window.shipcode.invoke<Project>('project:relink-path', { projectId, path });
    },
    onSuccess: (project) => {
      if (!project) return;
      invalidateProjects();
      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      queryClient.invalidateQueries({ queryKey: ['github-issues', project.id] });
      queryClient.invalidateQueries({ queryKey: ['threads', project.id] });
      queryClient.invalidateQueries({ queryKey: ['git-branches', project.id] });
      queryClient.invalidateQueries({ queryKey: ['thread-panel-data', project.id] });
      window.shipcode
        .invoke('github:refresh-issues', { projectId: project.id, force: true })
        .catch(() => {});
    },
    onError: (error: Error) => {
      window.alert(error.message || 'Failed to relink project folder');
    },
  });

  const openProjectPath = useMutation({
    mutationFn: ({
      projectId,
      target,
    }: {
      projectId: string;
      target: 'default' | AppSettings['projectOpenTarget'];
    }) => window.shipcode.invoke('project:open-path', { projectId, target }),
    onError: (error: Error) => {
      window.alert(error.message || 'Failed to open project folder');
    },
  });

  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

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

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startW: sidebarWidth };
      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const delta = ev.clientX - dragRef.current.startX;
        const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, dragRef.current.startW + delta));
        setSidebarWidth(next);
      };
      const onUp = () => {
        dragRef.current = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [sidebarWidth],
  );

  if (sidebarCollapsed) {
    return null;
  }

  const liveCount = stats?.agentsRunning ?? 0;
  const inboxCount = filterAttentionRequiredNotifications(
    notifs.filter((n) => n.dismissedAt === null),
  ).length;

  // Pinned projects always float to top; within each group, apply the selected sort order.
  const sortedProjects = [...projects].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sortOrder === 'alpha') return a.name.localeCompare(b.name);
    if (sortOrder === 'added') return (a.createdAt || '').localeCompare(b.createdAt || '');
    // 'recent'
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });

  return (
    <aside
      data-project-sidebar
      className="relative flex flex-col border-r border-border bg-primary"
      style={{ width: sidebarWidth, minWidth: SIDEBAR_MIN, maxWidth: SIDEBAR_MAX }}
    >
      <div className="px-2 pt-3 space-y-0.5">
        {/* Overview */}
        <Button
          variant="ghost"
          className={cn(
            'h-auto w-full justify-start gap-2 pl-3 pr-5 py-2 text-[13px] font-normal text-secondary app-region-no-drag',
            !settingsVisible && viewMode === 'overview' && 'bg-tertiary text-primary font-medium',
          )}
          onClick={() => openOverview()}
        >
          <LayoutGrid size={14} className="shrink-0 text-secondary" />
          <span className="flex-1 truncate">Overview</span>
          {liveCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-agent/30 bg-agent/10 px-1.5 py-0.5 text-[10px] font-medium text-agent">
              <span className="relative flex h-1.5 w-1.5 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-agent opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-agent" />
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

        {/* Activity */}
        <Button
          variant="ghost"
          className={cn(
            'h-auto w-full justify-start gap-2 pl-3 pr-5 py-2 text-[13px] font-normal text-secondary app-region-no-drag',
            !settingsVisible && viewMode === 'activity' && 'bg-tertiary text-primary font-medium',
          )}
          onClick={() => openActivity()}
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
          onClick={() => openSkills()}
        >
          <Sparkles size={14} className="shrink-0 text-secondary" />
          <span className="flex-1 truncate">Skills</span>
        </Button>

        {/* Costs */}
        <Button
          variant="ghost"
          className={cn(
            'h-auto w-full justify-start gap-2 pl-3 pr-5 py-2 text-[13px] font-normal text-secondary app-region-no-drag',
            !settingsVisible && viewMode === 'costs' && 'bg-tertiary text-primary font-medium',
          )}
          onClick={() => openCosts()}
        >
          <DollarSign size={14} className="shrink-0 text-secondary" />
          <span className="flex-1 truncate">Costs</span>
        </Button>
      </div>

      <div className="mt-3 flex items-center justify-between px-4 text-[10px] font-semibold uppercase tracking-wider text-muted">
        <span>Projects</span>
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted"
                title={`Sort: ${SORT_LABELS[sortOrder]}`}
                aria-label="Sort projects"
              >
                <ArrowUpDown size={14} />
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
            size="icon-xs"
            className="text-muted app-region-no-drag"
            title="Add repository"
            aria-label="Add repository"
            onClick={() => addProject.mutate()}
          >
            <Plus size={14} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-1" data-project-list>
        {sortedProjects.map((project) => (
          <div key={project.id} className="relative group">
            {(() => {
              const projectWarnings =
                settings && integrations?.system && providerUsage
                  ? getProjectProviderWarnings(
                      settings,
                      project,
                      integrations.system,
                      providerUsage,
                    )
                  : [];
              const hasBlockedWarning = projectWarnings.some(
                (warning) => warning.severity === 'blocked',
              );
              const warningBadgeLabel =
                projectWarnings.length === 0 ? null : hasBlockedWarning ? 'Blocked' : 'Low';
              const warningTitle =
                projectWarnings.length === 0
                  ? undefined
                  : projectWarnings.map((warning) => warning.message).join(' · ');

              return (
                <>
                  <Button
                    variant="ghost"
                    className={cn(
                      'h-auto w-full justify-start gap-2 pl-3 pr-8 py-2 text-[13px] font-normal text-secondary app-region-no-drag',
                      project.pathExists === false && 'opacity-50',
                      viewMode === 'project' &&
                        activeProjectId === project.id &&
                        'bg-tertiary text-primary font-medium',
                    )}
                    onClick={() => selectProject(project.id)}
                    title={
                      project.pathExists === false
                        ? `Project folder missing: ${project.path}`
                        : project.path
                    }
                  >
                    {project.pinned ? (
                      <Pin size={12} className="shrink-0 text-accent fill-accent" />
                    ) : (
                      <Folder
                        size={14}
                        className={cn(
                          'shrink-0 text-secondary',
                          project.pathExists === false && 'text-warning',
                        )}
                      />
                    )}
                    <span className="flex-1 truncate text-primary">{project.name}</span>
                    {project.pathExists === false && (
                      <Badge variant="warning" className="shrink-0 text-[10px]">
                        Missing
                      </Badge>
                    )}
                    {project.pathExists !== false && project.setupStatus === 'missing' && (
                      <Badge variant="default" className="shrink-0 text-[10px]">
                        Setup
                      </Badge>
                    )}
                    {project.pathExists !== false && project.setupStatus === 'invalid' && (
                      <Badge variant="warning" className="shrink-0 text-[10px]">
                        Setup!
                      </Badge>
                    )}
                    {warningBadgeLabel ? (
                      <Badge
                        variant="warning"
                        className={cn(
                          'shrink-0 text-[10px]',
                          hasBlockedWarning && 'border-danger/30 bg-danger/10 text-danger',
                        )}
                        title={warningTitle}
                      >
                        {warningBadgeLabel}
                      </Badge>
                    ) : null}
                    {(stats?.agentsRunningByProject?.[project.id] ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-1 shrink-0 rounded-full border border-agent/30 bg-agent/10 px-1.5 py-0.5 text-[10px] font-medium text-agent">
                        <span className="relative flex h-1.5 w-1.5 items-center justify-center">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-agent opacity-60" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-agent" />
                        </span>
                        {stats?.agentsRunningByProject[project.id]} live
                      </span>
                    )}
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className={cn(
                          'absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus:opacity-100',
                          warningBadgeLabel ? 'text-warning' : 'text-muted',
                        )}
                        aria-label={`More actions for ${project.name}`}
                        title={warningTitle}
                      >
                        <MoreHorizontal size={14} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      collisionPadding={{ top: 44, right: 8, bottom: 8, left: 8 }}
                      className="min-w-[220px]"
                      onInteractOutside={(e) => {
                        const target = e.target as Element | null;
                        if (target?.closest('[data-project-list]')) {
                          e.preventDefault();
                        }
                      }}
                    >
                      {(() => {
                        const availableTargets = PROJECT_OPEN_TARGETS.filter(
                          (target) => integrations?.desktopApps?.[target]?.available,
                        );

                        if (availableTargets.length === 0) return null;

                        return (
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger disabled={project.pathExists === false}>
                              <FolderOpen size={12} />
                              <span className="truncate">Open in</span>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="min-w-[240px]">
                              {availableTargets.map((target) => {
                                const app = integrations?.desktopApps?.[target];
                                if (!app) return null;

                                const isDefaultTarget =
                                  (settings?.projectOpenTarget ?? 'cursor') === target;
                                const Icon = PROJECT_OPEN_TARGET_ICONS[target];

                                return (
                                  <DropdownMenuItem
                                    key={target}
                                    onSelect={() =>
                                      openProjectPath.mutate({ projectId: project.id, target })
                                    }
                                  >
                                    <span className="flex h-3.5 w-3.5 items-center justify-center">
                                      {isDefaultTarget ? <Check size={12} /> : null}
                                    </span>
                                    <Icon size={12} className="shrink-0 text-secondary" />
                                    <span className="flex-1 truncate">{app.label}</span>
                                    {isDefaultTarget ? (
                                      <span className="text-[11px] text-muted">Default</span>
                                    ) : null}
                                  </DropdownMenuItem>
                                );
                              })}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        );
                      })()}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => openProjectSettingsModal(project.id)}>
                        <Settings size={12} /> Settings
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => openProjectSetupModal(project.id)}>
                        <Wrench size={12} /> Configure setup...
                      </DropdownMenuItem>
                      {project.pathExists === false && (
                        <DropdownMenuItem onSelect={() => relinkProject.mutate(project.id)}>
                          <Wrench size={12} /> Relink folder…
                        </DropdownMenuItem>
                      )}
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
                </>
              );
            })()}
          </div>
        ))}
      </div>
      {/* Drag handle for resizing */}
      <button
        type="button"
        aria-label="Resize project sidebar"
        className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/20 active:bg-accent/30 transition-colors"
        onMouseDown={handleResizeMouseDown}
      />
    </aside>
  );
}
