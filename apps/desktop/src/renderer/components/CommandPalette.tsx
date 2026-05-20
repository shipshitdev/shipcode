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

type RunAction = (fn: () => void | Promise<void>) => void;

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
        <IssuesCommandGroup visibleIssues={visibleIssues} runAction={runAction} />
        <GithubCommandGroup
          activeProjectId={activeProjectId}
          runAction={runAction}
          openCreateIssueModal={openCreateIssueModal}
          invalidateIssues={() => queryClient.invalidateQueries({ queryKey: ['github-issues'] })}
        />
        <PipelineCommandGroup
          activeThreadId={activeThreadId}
          pipelinePhase={pipelinePhase}
          approvedAwaitingExecution={approvedAwaitingExecution}
          runAction={runAction}
        />
        <QuickActionsCommandGroup
          activeProjectId={activeProjectId}
          onOpenTerminal={runOpenTerminalAction}
        />
        <GotoCommandGroup
          runAction={runAction}
          openOverview={openOverview}
          openInbox={openInbox}
          openActivity={openActivity}
          openCosts={openCosts}
          openSkills={openSkills}
          openAssistant={openAssistant}
          openTerminalTab={openTerminalTab}
          openPullRequests={() => setProjectTab('pull-requests')}
          toggleSettings={toggleSettings}
        />
        <WorkspaceCommandGroup
          activeIssue={activeIssue}
          hasDetailView={hasDetailView}
          runAction={runAction}
          close={close}
          openAddProjectExplorer={openAddProjectExplorer}
          selectIssue={selectIssue}
          toggleSidebar={toggleSidebar}
          toggleTerminal={toggleTerminal}
        />
        <GitCommandGroup activeProjectId={activeProjectId} runAction={runAction} />
      </CommandList>
      <CommandPaletteFooter commandCount={commandCount} />
    </>
  );
}

function CommandItemBody({
  title,
  description,
  shortcut,
}: {
  title: string;
  description?: string;
  shortcut?: string;
}) {
  return (
    <div className="flex-1 overflow-hidden">
      <div className="flex items-center gap-2">
        <span className="truncate font-medium">{title}</span>
        {shortcut ? <CommandShortcut>{shortcut}</CommandShortcut> : null}
      </div>
      {description ? <p className="truncate text-xs opacity-50">{description}</p> : null}
    </div>
  );
}

function IssuesCommandGroup({
  visibleIssues,
  runAction,
}: {
  visibleIssues: Array<{ issue: GitHubIssueCacheRecord; project: Project }>;
  runAction: RunAction;
}) {
  const navigateToIssue = useAppStore((state) => state.navigateToIssue);
  if (visibleIssues.length === 0) return null;

  return (
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
                <span className="text-muted font-mono text-xs mr-1.5">#{issue.issueNumber}</span>
                {issue.title}
              </span>
              <CommandShortcut>{project.name}</CommandShortcut>
            </div>
          </div>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

function GithubCommandGroup({
  activeProjectId,
  runAction,
  openCreateIssueModal,
  invalidateIssues,
}: {
  activeProjectId: string | null;
  runAction: RunAction;
  openCreateIssueModal: () => void;
  invalidateIssues: () => Promise<unknown>;
}) {
  return (
    <CommandGroup heading="GitHub" className={GROUP_CLS}>
      {activeProjectId && (
        <>
          <CommandItem onSelect={() => runAction(() => openCreateIssueModal())}>
            <Plus className="size-4 shrink-0 opacity-70" />
            <CommandItemBody
              title="New Issue…"
              description="Create a new GitHub issue or PRD"
              shortcut={getShortcut('new-issue').glyph}
            />
          </CommandItem>
          <CommandItem
            onSelect={() =>
              runAction(async () => {
                await window.shipcode.invoke('github:refresh-issues', {
                  projectId: activeProjectId,
                  force: true,
                });
                await invalidateIssues();
              })
            }
          >
            <RefreshCw className="size-4 shrink-0 opacity-70" />
            <CommandItemBody title="Refresh Issues" description="Sync latest issues from GitHub" />
          </CommandItem>
        </>
      )}
    </CommandGroup>
  );
}

function PipelineCommandGroup({
  activeThreadId,
  pipelinePhase,
  approvedAwaitingExecution,
  runAction,
}: {
  activeThreadId: string | null;
  pipelinePhase: string;
  approvedAwaitingExecution: boolean;
  runAction: RunAction;
}) {
  if (!activeThreadId) return null;

  return (
    <CommandGroup heading="Pipeline" className={GROUP_CLS}>
      {pipelinePhase === PIPELINE_PHASE.idle && (
        <CommandItem
          onSelect={() =>
            runAction(() => window.shipcode.invoke('pipeline:start', { threadId: activeThreadId }))
          }
        >
          <Play className="size-4 shrink-0 opacity-70" />
          <CommandItemBody
            title="Start Pipeline"
            description="Begin plan to execute to verify cycle"
          />
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
            <CommandItemBody
              title="Approve Plan"
              description="Accept plan and proceed to execution"
            />
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
            <CommandItemBody title="Reject Plan" description="Send plan back for revision" />
          </CommandItem>
        </>
      )}
      {approvedAwaitingExecution && (
        <CommandItem disabled>
          <Play className="size-4 shrink-0 opacity-70" />
          <CommandItemBody title="Waiting for execution slot" />
        </CommandItem>
      )}
      <CommandItem
        onSelect={() =>
          runAction(() => window.shipcode.invoke('pipeline:cancel', { threadId: activeThreadId }))
        }
      >
        <Ban className="size-4 shrink-0 opacity-70" />
        <CommandItemBody title="Cancel Pipeline" description="Stop current pipeline run" />
      </CommandItem>
    </CommandGroup>
  );
}

function QuickActionsCommandGroup({
  activeProjectId,
  onOpenTerminal,
}: {
  activeProjectId: string | null;
  onOpenTerminal: () => void;
}) {
  return (
    <CommandGroup heading="Quick Actions" className={GROUP_CLS}>
      <CommandItem disabled={!activeProjectId} onSelect={onOpenTerminal}>
        <Terminal className="size-4 shrink-0 opacity-70" />
        <CommandItemBody
          title="Open Terminal"
          description="Launch terminal in project directory"
          shortcut={getShortcut('open-project-terminal').glyph}
        />
      </CommandItem>
    </CommandGroup>
  );
}

function GotoCommandGroup({
  runAction,
  openOverview,
  openInbox,
  openActivity,
  openCosts,
  openSkills,
  openAssistant,
  openTerminalTab,
  openPullRequests,
  toggleSettings,
}: {
  runAction: RunAction;
  openOverview: () => void;
  openInbox: () => void;
  openActivity: () => void;
  openCosts: () => void;
  openSkills: () => void;
  openAssistant: () => void;
  openTerminalTab: () => void;
  openPullRequests: () => void;
  toggleSettings: () => void;
}) {
  const items = [
    {
      title: 'Overview',
      description: 'Project dashboard and status',
      icon: LayoutDashboard,
      action: openOverview,
    },
    { title: 'Inbox', description: 'Notifications and updates', icon: Inbox, action: openInbox },
    {
      title: 'Activity',
      description: 'Recent pipeline and project events',
      icon: Activity,
      action: openActivity,
    },
    { title: 'Costs', description: 'AI model usage and spend', icon: Wallet, action: openCosts },
    {
      title: 'Skills',
      description: 'Manage pipeline prompt skills',
      icon: Sparkles,
      action: openSkills,
    },
    {
      title: 'Copilot',
      description: 'AI assistant chat',
      icon: MessageSquare,
      action: openAssistant,
    },
    {
      title: 'Terminal',
      description: 'Built-in terminal view',
      icon: SquareTerminal,
      action: openTerminalTab,
    },
    {
      title: 'Pull Requests',
      description: 'View and manage open PRs',
      icon: GitPullRequest,
      action: openPullRequests,
    },
    {
      title: 'Settings',
      description: 'App and project configuration',
      icon: Cog,
      action: toggleSettings,
    },
  ];

  return (
    <CommandGroup heading="Go to" className={GROUP_CLS}>
      {items.map(({ title, description, icon: Icon, action }) => (
        <CommandItem key={title} onSelect={() => runAction(action)}>
          <Icon className="size-4 shrink-0 opacity-70" />
          <CommandItemBody title={title} description={description} />
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

function WorkspaceCommandGroup({
  activeIssue,
  hasDetailView,
  runAction,
  close,
  openAddProjectExplorer,
  selectIssue,
  toggleSidebar,
  toggleTerminal,
}: {
  activeIssue: GitHubIssueCacheRecord | null;
  hasDetailView: boolean;
  runAction: RunAction;
  close: () => void;
  openAddProjectExplorer: () => void;
  selectIssue: (issue: GitHubIssueCacheRecord | null) => void;
  toggleSidebar: () => void;
  toggleTerminal: () => void;
}) {
  return (
    <CommandGroup heading="Workspace" className={GROUP_CLS}>
      <CommandItem
        onSelect={() => {
          close();
          openAddProjectExplorer();
        }}
      >
        <FolderPlus className="size-4 shrink-0 opacity-70" />
        <CommandItemBody title="Add Repository…" description="Connect a new GitHub repository" />
      </CommandItem>
      {!hasDetailView && (
        <CommandItem onSelect={() => runAction(() => toggleSidebar())}>
          <PanelLeft className="size-4 shrink-0 opacity-70" />
          <CommandItemBody
            title={getShortcut('toggle-sidebar').label}
            description="Show or hide project sidebar"
            shortcut={getShortcut('toggle-sidebar').glyph}
          />
        </CommandItem>
      )}
      {activeIssue && (
        <CommandItem onSelect={() => runAction(() => selectIssue(null))}>
          <Columns3 className="size-4 shrink-0 opacity-70" />
          <CommandItemBody
            title={getShortcut('toggle-issue-detail').label}
            description="Return to board view"
            shortcut={getShortcut('toggle-issue-detail').glyph}
          />
        </CommandItem>
      )}
      <CommandItem onSelect={() => runAction(() => toggleTerminal())}>
        <SquareTerminal className="size-4 shrink-0 opacity-70" />
        <CommandItemBody
          title={getShortcut('toggle-terminal').label}
          description="Show or hide terminal drawer"
          shortcut={getShortcut('toggle-terminal').glyph}
        />
      </CommandItem>
    </CommandGroup>
  );
}

function GitCommandGroup({
  activeProjectId,
  runAction,
}: {
  activeProjectId: string | null;
  runAction: RunAction;
}) {
  if (!activeProjectId) return null;

  return (
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
        <CommandItemBody title="Commit Changes" description="Stage and commit current changes" />
      </CommandItem>
      <CommandItem
        onSelect={() =>
          runAction(() => void window.shipcode.invoke('git:push', { projectId: activeProjectId }))
        }
      >
        <Upload className="size-4 shrink-0 opacity-70" />
        <CommandItemBody title="Push to Remote" description="Push commits to remote repository" />
      </CommandItem>
    </CommandGroup>
  );
}

function CommandPaletteFooter({ commandCount }: { commandCount: number }) {
  return (
    <>
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
