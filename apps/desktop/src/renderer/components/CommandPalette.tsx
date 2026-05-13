import type { GitHubIssueCacheRecord, PlanRecord, Project } from '@shipcode/shared';
import { PIPELINE_PHASE } from '@shipcode/shared';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@shipshitdev/ui';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Ban,
  CheckCircle2,
  CircleDot,
  Cog,
  Columns3,
  FolderPlus,
  GitBranch,
  GitPullRequest,
  Inbox,
  LayoutDashboard,
  MessageSquare,
  PanelLeft,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  SquareTerminal,
  Terminal,
  Upload,
  Wallet,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { getShortcut } from '../data/shortcuts';

const GROUP_CLS = [
  '[&_[cmdk-group-heading]]:uppercase',
  '[&_[cmdk-group-heading]]:tracking-wider',
  '[&_[cmdk-group-heading]]:text-[11px]',
  '[&_[cmdk-group-heading]]:font-semibold',
  '[&_[cmdk-group-heading]]:py-2',
  '[&_[cmdk-group-heading]]:px-3',
  '[&_[cmdk-item]]:px-3',
].join(' ');

import { useOpenProjectTerminal } from '../hooks/useOpenProjectTerminal';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';
import { toast } from '../stores/toast-store';

/**
 * Thin wrapper: only subscribes to open/toggle. When closed the inner
 * component is unmounted so its 20+ selectors, queries, and derived
 * state cost exactly zero.
 */
export function CommandPalette() {
  const commandPaletteOpen = useAppStore((state) => state.commandPaletteOpen);
  const toggleCommandPalette = useAppStore((state) => state.toggleCommandPalette);

  return (
    <CommandDialog open={commandPaletteOpen} onOpenChange={toggleCommandPalette}>
      {commandPaletteOpen && <CommandPaletteContent />}
    </CommandDialog>
  );
}

function CommandPaletteContent() {
  const queryClient = useQueryClient();
  const toggleCommandPalette = useAppStore((state) => state.toggleCommandPalette);
  const openCreateIssueModal = useAppStore((state) => state.openCreateIssueModal);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const activeThreadId = useAppStore((state) => state.activeThreadId);
  const pipelinePhase = useAppStore((state) => state.pipelinePhase);
  const toggleTerminal = useAppStore((state) => state.toggleTerminal);
  const toggleSettings = useAppStore((state) => state.toggleSettings);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const selectIssue = useAppStore((state) => state.selectIssue);
  const activeIssue = useAppStore((state) => state.activeIssue);
  const activeAutomationThreadId = useAppStore((state) => state.activeAutomationThreadId);
  const hasDetailView = activeIssue !== null || activeAutomationThreadId !== null;
  const openOverview = useAppStore((state) => state.openOverview);
  const openActivity = useAppStore((state) => state.openActivity);
  const openInbox = useAppStore((state) => state.openInbox);
  const openCosts = useAppStore((state) => state.openCosts);
  const openSkills = useAppStore((state) => state.openSkills);
  const openAssistant = useAppStore((state) => state.openAssistant);
  const openTerminalTab = useAppStore((state) => state.openTerminalTab);
  const setProjectTab = useAppStore((state) => state.setProjectTab);
  const navigateToIssue = useAppStore((state) => state.navigateToIssue);
  const { openProjectTerminal } = useOpenProjectTerminal();

  // Cross-project issue search
  const { data: allProjects = [] } = useQuery<Project[]>({
    queryKey: ['projects-visible'],
    queryFn: () => window.shipcode.invoke('project:list-visible'),
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });

  const issueResults = useQueries({
    queries: allProjects.map((p) => ({
      queryKey: ['github-issues', p.id] as const,
      queryFn: () =>
        window.shipcode.invoke<GitHubIssueCacheRecord[]>('github:list-issues', {
          projectId: p.id,
        }),
      staleTime: STABLE_APP_STATE_STALE_TIME,
    })),
  });
  const { data: activeThreadPlans = [] } = useQuery<PlanRecord[]>({
    queryKey: ['command-palette-plan-history', activeThreadId],
    queryFn: () => window.shipcode.invoke('plan:list', { threadId: activeThreadId }),
    staleTime: STABLE_APP_STATE_STALE_TIME,
    enabled: !!activeThreadId && pipelinePhase === PIPELINE_PHASE.approval,
  });
  const latestPlanStatus = activeThreadPlans[0]?.status ?? null;
  const approvedAwaitingExecution =
    pipelinePhase === PIPELINE_PHASE.approval && latestPlanStatus === 'approved';

  const allIssues = useMemo(() => {
    const result: Array<{ issue: GitHubIssueCacheRecord; project: Project }> = [];
    for (let i = 0; i < issueResults.length; i++) {
      const data = issueResults[i]?.data;
      const project = allProjects[i];
      if (!data || !project) continue;
      for (const issue of data) {
        result.push({ issue, project });
      }
    }
    return result;
  }, [issueResults, allProjects]);

  const openAddProjectExplorer = useAppStore((s) => s.openAddProjectExplorer);

  const [search, setSearch] = useState('');
  const isSearching = search.trim().length > 0;
  const visibleIssues = isSearching ? allIssues : allIssues.slice(0, 3);

  const close = () => toggleCommandPalette();

  const runAction = (fn: () => void | Promise<void>) => {
    close();
    fn();
  };
  const runOpenTerminalAction = () => {
    runAction(() => {
      void openProjectTerminal().catch((error) => {
        toast.error('Failed to open terminal', error instanceof Error ? error.message : undefined);
      });
    });
  };

  const commandCount = useMemo(() => {
    let count = visibleIssues.length;
    if (activeProjectId) count += 2; // New Issue, Refresh Issues
    if (activeThreadId) {
      count += 1; // Cancel Pipeline
      if (pipelinePhase === PIPELINE_PHASE.idle) count += 1;
      if (pipelinePhase === PIPELINE_PHASE.approval && !approvedAwaitingExecution) count += 2;
      if (approvedAwaitingExecution) count += 1;
    }
    count += 1; // Open Terminal
    count += 9; // Go to items
    count += 2 + (hasDetailView ? 0 : 1) + (activeIssue ? 1 : 0); // Workspace
    if (activeProjectId) count += 2; // Git
    return count;
  }, [
    visibleIssues.length,
    activeProjectId,
    activeThreadId,
    pipelinePhase,
    approvedAwaitingExecution,
    hasDetailView,
    activeIssue,
  ]);

  return (
    <>
      <CommandInput
        placeholder="Search issues, commands..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList className="max-h-[min(50vh,400px)]">
        <CommandEmpty>No results found.</CommandEmpty>

        {visibleIssues.length > 0 && (
          <CommandGroup heading="Issues" className={GROUP_CLS}>
            {visibleIssues.map(({ issue, project }) => (
              <CommandItem
                key={`${project.id}:${issue.issueNumber}`}
                value={`${project.name} #${issue.issueNumber} ${issue.title}`}
                onSelect={() => runAction(() => navigateToIssue(project.id, issue))}
              >
                <CircleDot className="size-4 shrink-0 opacity-70" />
                <div className="flex-1 overflow-hidden">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">
                      <span className="text-muted font-mono text-xs mr-1.5">
                        #{issue.issueNumber}
                      </span>
                      {issue.title}
                    </span>
                    <CommandShortcut>{project.name}</CommandShortcut>
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="GitHub" className={GROUP_CLS}>
          {activeProjectId && (
            <>
              <CommandItem onSelect={() => runAction(() => openCreateIssueModal())}>
                <Plus className="size-4 shrink-0 opacity-70" />
                <div className="flex-1 overflow-hidden">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">New Issue…</span>
                    <CommandShortcut>{getShortcut('new-issue').glyph}</CommandShortcut>
                  </div>
                  <p className="truncate text-xs opacity-50">Create a new GitHub issue or PRD</p>
                </div>
              </CommandItem>
              <CommandItem
                onSelect={() =>
                  runAction(async () => {
                    await window.shipcode.invoke('github:refresh-issues', {
                      projectId: activeProjectId,
                      force: true,
                    });
                    queryClient.invalidateQueries({ queryKey: ['github-issues'] });
                  })
                }
              >
                <RefreshCw className="size-4 shrink-0 opacity-70" />
                <div className="flex-1 overflow-hidden">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">Refresh Issues</span>
                  </div>
                  <p className="truncate text-xs opacity-50">Sync latest issues from GitHub</p>
                </div>
              </CommandItem>
            </>
          )}
        </CommandGroup>

        {activeThreadId && (
          <CommandGroup heading="Pipeline" className={GROUP_CLS}>
            {pipelinePhase === PIPELINE_PHASE.idle && (
              <CommandItem
                onSelect={() =>
                  runAction(() =>
                    window.shipcode.invoke('pipeline:start', { threadId: activeThreadId }),
                  )
                }
              >
                <Play className="size-4 shrink-0 opacity-70" />
                <div className="flex-1 overflow-hidden">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">Start Pipeline</span>
                  </div>
                  <p className="truncate text-xs opacity-50">Begin plan → execute → verify cycle</p>
                </div>
              </CommandItem>
            )}
            {pipelinePhase === PIPELINE_PHASE.approval && !approvedAwaitingExecution && (
              <>
                <CommandItem
                  onSelect={() =>
                    runAction(() =>
                      window.shipcode.invoke('pipeline:approve', { threadId: activeThreadId }),
                    )
                  }
                >
                  <CheckCircle2 className="size-4 shrink-0 opacity-70" />
                  <div className="flex-1 overflow-hidden">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">Approve Plan</span>
                    </div>
                    <p className="truncate text-xs opacity-50">
                      Accept plan and proceed to execution
                    </p>
                  </div>
                </CommandItem>
                <CommandItem
                  onSelect={() =>
                    runAction(() =>
                      window.shipcode.invoke('pipeline:reject', {
                        threadId: activeThreadId,
                        feedback: '',
                      }),
                    )
                  }
                >
                  <XCircle className="size-4 shrink-0 opacity-70" />
                  <div className="flex-1 overflow-hidden">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">Reject Plan</span>
                    </div>
                    <p className="truncate text-xs opacity-50">Send plan back for revision</p>
                  </div>
                </CommandItem>
              </>
            )}
            {approvedAwaitingExecution && (
              <CommandItem disabled>
                <Play className="size-4 shrink-0 opacity-70" />
                <div className="flex-1 overflow-hidden">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">Waiting for execution slot</span>
                  </div>
                </div>
              </CommandItem>
            )}
            <CommandItem
              onSelect={() =>
                runAction(() =>
                  window.shipcode.invoke('pipeline:cancel', { threadId: activeThreadId }),
                )
              }
            >
              <Ban className="size-4 shrink-0 opacity-70" />
              <div className="flex-1 overflow-hidden">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">Cancel Pipeline</span>
                </div>
                <p className="truncate text-xs opacity-50">Stop current pipeline run</p>
              </div>
            </CommandItem>
          </CommandGroup>
        )}

        <CommandGroup heading="Quick Actions" className={GROUP_CLS}>
          <CommandItem disabled={!activeProjectId} onSelect={runOpenTerminalAction}>
            <Terminal className="size-4 shrink-0 opacity-70" />
            <div className="flex-1 overflow-hidden">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">Open Terminal</span>
                <CommandShortcut>{getShortcut('open-project-terminal').glyph}</CommandShortcut>
              </div>
              <p className="truncate text-xs opacity-50">Launch terminal in project directory</p>
            </div>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Go to" className={GROUP_CLS}>
          <CommandItem onSelect={() => runAction(() => openOverview())}>
            <LayoutDashboard className="size-4 shrink-0 opacity-70" />
            <div className="flex-1 overflow-hidden">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">Overview</span>
              </div>
              <p className="truncate text-xs opacity-50">Project dashboard and status</p>
            </div>
          </CommandItem>
          <CommandItem onSelect={() => runAction(() => openInbox())}>
            <Inbox className="size-4 shrink-0 opacity-70" />
            <div className="flex-1 overflow-hidden">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">Inbox</span>
              </div>
              <p className="truncate text-xs opacity-50">Notifications and updates</p>
            </div>
          </CommandItem>
          <CommandItem onSelect={() => runAction(() => openActivity())}>
            <Activity className="size-4 shrink-0 opacity-70" />
            <div className="flex-1 overflow-hidden">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">Activity</span>
              </div>
              <p className="truncate text-xs opacity-50">Recent pipeline and project events</p>
            </div>
          </CommandItem>
          <CommandItem onSelect={() => runAction(() => openCosts())}>
            <Wallet className="size-4 shrink-0 opacity-70" />
            <div className="flex-1 overflow-hidden">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">Costs</span>
              </div>
              <p className="truncate text-xs opacity-50">AI model usage and spend</p>
            </div>
          </CommandItem>
          <CommandItem onSelect={() => runAction(() => openSkills())}>
            <Sparkles className="size-4 shrink-0 opacity-70" />
            <div className="flex-1 overflow-hidden">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">Skills</span>
              </div>
              <p className="truncate text-xs opacity-50">Manage pipeline prompt skills</p>
            </div>
          </CommandItem>
          <CommandItem onSelect={() => runAction(() => openAssistant())}>
            <MessageSquare className="size-4 shrink-0 opacity-70" />
            <div className="flex-1 overflow-hidden">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">Copilot</span>
              </div>
              <p className="truncate text-xs opacity-50">AI assistant chat</p>
            </div>
          </CommandItem>
          <CommandItem onSelect={() => runAction(() => openTerminalTab())}>
            <SquareTerminal className="size-4 shrink-0 opacity-70" />
            <div className="flex-1 overflow-hidden">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">Terminal</span>
              </div>
              <p className="truncate text-xs opacity-50">Built-in terminal view</p>
            </div>
          </CommandItem>
          <CommandItem onSelect={() => runAction(() => setProjectTab('pull-requests'))}>
            <GitPullRequest className="size-4 shrink-0 opacity-70" />
            <div className="flex-1 overflow-hidden">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">Pull Requests</span>
              </div>
              <p className="truncate text-xs opacity-50">View and manage open PRs</p>
            </div>
          </CommandItem>
          <CommandItem onSelect={() => runAction(() => toggleSettings())}>
            <Cog className="size-4 shrink-0 opacity-70" />
            <div className="flex-1 overflow-hidden">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">Settings</span>
              </div>
              <p className="truncate text-xs opacity-50">App and project configuration</p>
            </div>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Workspace" className={GROUP_CLS}>
          <CommandItem
            onSelect={() => {
              close();
              openAddProjectExplorer();
            }}
          >
            <FolderPlus className="size-4 shrink-0 opacity-70" />
            <div className="flex-1 overflow-hidden">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">Add Repository…</span>
              </div>
              <p className="truncate text-xs opacity-50">Connect a new GitHub repository</p>
            </div>
          </CommandItem>
          {!hasDetailView && (
            <CommandItem onSelect={() => runAction(() => toggleSidebar())}>
              <PanelLeft className="size-4 shrink-0 opacity-70" />
              <div className="flex-1 overflow-hidden">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">
                    {getShortcut('toggle-sidebar').label}
                  </span>
                  <CommandShortcut>{getShortcut('toggle-sidebar').glyph}</CommandShortcut>
                </div>
                <p className="truncate text-xs opacity-50">Show or hide project sidebar</p>
              </div>
            </CommandItem>
          )}
          {activeIssue && (
            <CommandItem onSelect={() => runAction(() => selectIssue(null))}>
              <Columns3 className="size-4 shrink-0 opacity-70" />
              <div className="flex-1 overflow-hidden">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">
                    {getShortcut('toggle-issue-detail').label}
                  </span>
                  <CommandShortcut>{getShortcut('toggle-issue-detail').glyph}</CommandShortcut>
                </div>
                <p className="truncate text-xs opacity-50">Return to board view</p>
              </div>
            </CommandItem>
          )}
          <CommandItem onSelect={() => runAction(() => toggleTerminal())}>
            <SquareTerminal className="size-4 shrink-0 opacity-70" />
            <div className="flex-1 overflow-hidden">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{getShortcut('toggle-terminal').label}</span>
                <CommandShortcut>{getShortcut('toggle-terminal').glyph}</CommandShortcut>
              </div>
              <p className="truncate text-xs opacity-50">Show or hide terminal drawer</p>
            </div>
          </CommandItem>
        </CommandGroup>

        {activeProjectId && (
          <CommandGroup heading="Git" className={GROUP_CLS}>
            <CommandItem
              onSelect={() =>
                runAction(
                  () =>
                    void window.shipcode.invoke('git:commit', {
                      projectId: activeProjectId,
                      message: '',
                    }),
                )
              }
            >
              <GitBranch className="size-4 shrink-0 opacity-70" />
              <div className="flex-1 overflow-hidden">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">Commit Changes</span>
                </div>
                <p className="truncate text-xs opacity-50">Stage and commit current changes</p>
              </div>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                runAction(
                  () => void window.shipcode.invoke('git:push', { projectId: activeProjectId }),
                )
              }
            >
              <Upload className="size-4 shrink-0 opacity-70" />
              <div className="flex-1 overflow-hidden">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">Push to Remote</span>
                </div>
                <p className="truncate text-xs opacity-50">Push commits to remote repository</p>
              </div>
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>

      <CommandSeparator alwaysRender />
      <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted">
        <div className="flex gap-4">
          <span>
            <kbd className="rounded bg-hover px-1.5 py-0.5 font-mono text-[10px]">↑↓</kbd> Navigate
          </span>
          <span>
            <kbd className="rounded bg-hover px-1.5 py-0.5 font-mono text-[10px]">↵</kbd> Execute
          </span>
          <span>
            <kbd className="rounded bg-hover px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd> Close
          </span>
        </div>
        <span>{commandCount} commands</span>
      </div>
    </>
  );
}
