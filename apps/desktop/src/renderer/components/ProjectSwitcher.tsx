import type {
  AppSettings,
  CliProviderUsageMap,
  DashboardStats,
  IntegrationStatus,
  Project,
} from '@shipcode/shared';
import { getProjectProviderWarnings } from '@shipcode/shared';
import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
} from '@shipshitdev/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Check,
  ChevronDown,
  Folder,
  Pin,
  PinOff,
  Plus,
  Settings,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useMemo } from 'react';
import { useAppSettings } from '../hooks/useAppSettings';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';
import { toast } from '../stores/toast-store';
import { ProjectProviderWarningPopover } from './ProjectProviderWarningPopover';

type SortOrder = AppSettings['projectSortOrder'];
type ProjectWithPathState = Project & { pathExists?: boolean };

const PROJECT_LOADING_KEYS = ['switcher-loading-1', 'switcher-loading-2', 'switcher-loading-3'];

export function ProjectSwitcher() {
  const queryClient = useQueryClient();
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const selectProject = useAppStore((state) => state.selectProject);
  const openProjectSettingsModal = useAppStore((state) => state.openProjectSettingsModal);
  const openAddProjectExplorer = useAppStore((state) => state.openAddProjectExplorer);
  const openView = useAppStore((state) => state.openView);

  const { data: queriedProjects, isLoading: projectsLoading } = useQuery<ProjectWithPathState[]>({
    queryKey: ['projects-visible'],
    queryFn: () => window.shipcode.invoke('project:list-visible'),
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });
  const projects = queriedProjects ?? [];

  const { data: settings } = useAppSettings();
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
  });

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => window.shipcode.invoke<DashboardStats>('dashboard:get-stats'),
    staleTime: 15_000,
  });

  const invalidateProjects = () => {
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['projects-visible'] });
    queryClient.invalidateQueries({ queryKey: ['projects-archived'] });
  };

  const pinProject = useMutation({
    mutationFn: ({ projectId, pinned }: { projectId: string; pinned: boolean }) =>
      window.shipcode.invoke('project:pin', { projectId, pinned }),
    onSuccess: () => invalidateProjects(),
  });

  const archiveProject = useMutation({
    mutationFn: (projectId: string) => window.shipcode.invoke('project:archive', { projectId }),
    onSuccess: (_data, projectId) => {
      if (activeProjectId === projectId) {
        selectProject(null);
        openView('overview');
      }
      invalidateProjects();
    },
    onError: (error: Error) => {
      toast.error('Failed to archive project', error.message);
    },
  });

  const removeProject = useMutation({
    mutationFn: (projectId: string) => window.shipcode.invoke('project:remove', { projectId }),
    onSuccess: (_data, projectId) => {
      if (activeProjectId === projectId) {
        selectProject(null);
        openView('overview');
      }
      invalidateProjects();
    },
    onError: (error: Error) => {
      toast.error('Failed to remove project', error.message);
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
      toast.error('Failed to relink project', error.message);
    },
  });

  const sortedProjects = useMemo(
    () =>
      projects.toSorted((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (a.pinned && b.pinned) return a.name.localeCompare(b.name);
        if (sortOrder === 'alpha') return a.name.localeCompare(b.name);
        if (sortOrder === 'added') return a.createdAt.localeCompare(b.createdAt);
        return b.updatedAt.localeCompare(a.updatedAt);
      }),
    [projects, sortOrder],
  );

  const activeProject = sortedProjects.find((project) => project.id === activeProjectId) ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          data-testid="project-switcher"
          aria-label="Switch project"
          className="h-7 max-w-[220px] gap-1.5 rounded-md px-2 text-[13px] font-medium text-primary app-region-no-drag"
        >
          <Folder size={13} className="shrink-0 text-secondary" />
          <span className="min-w-0 truncate">
            {activeProject?.name ?? (projectsLoading ? 'Projects' : 'Select project')}
          </span>
          <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[280px] p-1"
        collisionPadding={{ top: 44, right: 8, bottom: 8, left: 8 }}
      >
        <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Projects
        </div>
        {projectsLoading && projects.length === 0
          ? PROJECT_LOADING_KEYS.map((key) => (
              <div key={key} className="flex items-center gap-2 px-2 py-1.5">
                <Skeleton className="size-3.5 shrink-0 rounded" />
                <Skeleton className="h-3.5 flex-1 rounded" />
              </div>
            ))
          : null}
        {sortedProjects.map((project) => {
          const projectWarnings =
            settings && integrations?.system && providerUsage
              ? getProjectProviderWarnings(settings, project, integrations.system, providerUsage)
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
          const isActive = activeProjectId === project.id;

          return (
            <div key={project.id} className="group relative">
              <DropdownMenuItem
                className={cn('h-auto items-center gap-2 py-1.5 pr-16', isActive && 'bg-tertiary')}
                onSelect={() => selectProject(project.id)}
                title={
                  project.pathExists === false
                    ? `Project folder missing: ${project.path}`
                    : project.path
                }
              >
                {isActive ? (
                  <Check size={12} className="shrink-0 text-primary" />
                ) : project.pinned ? (
                  <Pin size={12} className="shrink-0 text-accent fill-accent" />
                ) : (
                  <Folder size={12} className="shrink-0 text-secondary" />
                )}
                <span className="min-w-0 flex-1 truncate text-[13px] text-primary">
                  {project.name}
                </span>
                {project.pathExists === false ? (
                  <Badge variant="warning" className="shrink-0 text-[10px]">
                    Missing
                  </Badge>
                ) : null}
                {(stats?.pendingApprovalsByProject?.[project.id] ?? 0) > 0 ? (
                  <Badge variant="warning" className="shrink-0 text-[10px]">
                    {stats?.pendingApprovalsByProject[project.id]}{' '}
                    {stats?.pendingApprovalsByProject[project.id] === 1 ? 'approval' : 'approvals'}
                  </Badge>
                ) : null}
                {(stats?.agentsRunningByProject?.[project.id] ?? 0) > 0 ? (
                  <span className="inline-flex items-center gap-1 shrink-0 rounded-full border border-agent/30 bg-agent/10 px-1.5 py-0.5 text-[10px] font-medium text-agent">
                    {stats?.agentsRunningByProject[project.id]} live
                  </span>
                ) : null}
              </DropdownMenuItem>
              <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                {warningBadgeLabel && settings ? (
                  <ProjectProviderWarningPopover
                    settings={settings}
                    project={project}
                    warnings={projectWarnings}
                    className="app-region-no-drag"
                  />
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground"
                      aria-label={`More actions for ${project.name}`}
                      title={warningTitle}
                    >
                      <Settings size={12} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[200px]">
                    <DropdownMenuItem onSelect={() => openProjectSettingsModal(project.id)}>
                      <Settings size={12} /> Settings
                    </DropdownMenuItem>
                    {project.pathExists !== false &&
                    (project.setupStatus === 'missing' || project.setupStatus === 'invalid') ? (
                      <DropdownMenuItem
                        onSelect={() => openProjectSettingsModal(project.id, 'setup')}
                      >
                        <Wrench size={12} /> Setup
                      </DropdownMenuItem>
                    ) : null}
                    {project.pathExists === false ? (
                      <DropdownMenuItem onSelect={() => relinkProject.mutate(project.id)}>
                        <Wrench size={12} /> Relink folder…
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      onSelect={() =>
                        pinProject.mutate({
                          projectId: project.id,
                          pinned: !project.pinned,
                        })
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
            </div>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openAddProjectExplorer()}>
          <Plus size={12} /> Add repository
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
