import type { GitHubIssueCacheRecord, PlanRecord, Project } from '@shipcode/shared';
import { PIPELINE_PHASE } from '@shipcode/shared';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@shipshitdev/ui';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getShortcut } from '../data/shortcuts';
import { useOpenProjectTerminal } from '../hooks/useOpenProjectTerminal';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';

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
  const toggleIssueDetail = useAppStore((state) => state.toggleIssueDetail);
  const activeIssue = useAppStore((state) => state.activeIssue);
  const openOverview = useAppStore((state) => state.openOverview);
  const openActivity = useAppStore((state) => state.openActivity);
  const openInbox = useAppStore((state) => state.openInbox);
  const openCosts = useAppStore((state) => state.openCosts);
  const openSkills = useAppStore((state) => state.openSkills);
  const openTerminalSessions = useAppStore((state) => state.openTerminalSessions);
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
    enabled: !!activeThreadId && pipelinePhase === PIPELINE_PHASE.awaitingApproval,
  });
  const latestPlanStatus = activeThreadPlans[0]?.status ?? null;
  const approvedAwaitingExecution =
    pipelinePhase === PIPELINE_PHASE.awaitingApproval && latestPlanStatus === 'approved';

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

  const close = () => toggleCommandPalette();

  const runAction = (fn: () => void | Promise<void>) => {
    close();
    fn();
  };
  const runOpenTerminalAction = () => {
    runAction(() => {
      void openProjectTerminal().catch((error) => {
        window.alert(error instanceof Error ? error.message : 'Failed to open terminal');
      });
    });
  };

  return (
    <>
      <CommandInput placeholder="Search issues, commands..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {allIssues.length > 0 && (
          <CommandGroup heading="Issues">
            {allIssues.map(({ issue, project }) => (
              <CommandItem
                key={`${project.id}:${issue.issueNumber}`}
                value={`${project.name} #${issue.issueNumber} ${issue.title}`}
                onSelect={() => runAction(() => navigateToIssue(project.id, issue))}
              >
                <span className="shrink-0 text-muted font-mono text-xs">#{issue.issueNumber}</span>
                <span className="flex-1 truncate">{issue.title}</span>
                <CommandShortcut>{project.name}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="GitHub">
          {activeProjectId && (
            <>
              <CommandItem onSelect={() => runAction(() => openCreateIssueModal())}>
                <span className="flex-1">New Issue...</span>
                <CommandShortcut>{getShortcut('new-issue').glyph}</CommandShortcut>
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
                <span className="flex-1">Refresh Issues</span>
              </CommandItem>
            </>
          )}
        </CommandGroup>

        {activeThreadId && (
          <CommandGroup heading="Pipeline">
            {pipelinePhase === PIPELINE_PHASE.idle && (
              <CommandItem
                onSelect={() =>
                  runAction(() =>
                    window.shipcode.invoke('pipeline:start', { threadId: activeThreadId }),
                  )
                }
              >
                <span className="flex-1">Start Pipeline</span>
              </CommandItem>
            )}
            {pipelinePhase === PIPELINE_PHASE.awaitingApproval && !approvedAwaitingExecution && (
              <>
                <CommandItem
                  onSelect={() =>
                    runAction(() =>
                      window.shipcode.invoke('pipeline:approve', { threadId: activeThreadId }),
                    )
                  }
                >
                  <span className="flex-1">Approve Plan</span>
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
                  <span className="flex-1">Reject Plan</span>
                </CommandItem>
              </>
            )}
            {approvedAwaitingExecution && (
              <CommandItem disabled>
                <span className="flex-1">Waiting for execution slot</span>
              </CommandItem>
            )}
            <CommandItem
              onSelect={() =>
                runAction(() =>
                  window.shipcode.invoke('pipeline:cancel', { threadId: activeThreadId }),
                )
              }
            >
              <span className="flex-1">Cancel Pipeline</span>
            </CommandItem>
          </CommandGroup>
        )}

        <CommandGroup heading="Quick Actions">
          <CommandItem disabled={!activeProjectId} onSelect={runOpenTerminalAction}>
            <span className="flex-1">Open Terminal</span>
            <CommandShortcut>{getShortcut('open-project-terminal').glyph}</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Go to">
          <CommandItem onSelect={() => runAction(() => openOverview())}>
            <span className="flex-1">Overview</span>
          </CommandItem>
          <CommandItem onSelect={() => runAction(() => openInbox())}>
            <span className="flex-1">Inbox</span>
          </CommandItem>
          <CommandItem onSelect={() => runAction(() => openActivity())}>
            <span className="flex-1">Activity</span>
          </CommandItem>
          <CommandItem onSelect={() => runAction(() => openCosts())}>
            <span className="flex-1">Costs</span>
          </CommandItem>
          <CommandItem onSelect={() => runAction(() => openSkills())}>
            <span className="flex-1">Skills</span>
          </CommandItem>
          <CommandItem onSelect={() => runAction(() => openTerminalSessions())}>
            <span className="flex-1">Terminal Sessions</span>
          </CommandItem>
          <CommandItem onSelect={() => runAction(() => setProjectTab('pull-requests'))}>
            <span className="flex-1">Pull Requests</span>
          </CommandItem>
          <CommandItem onSelect={() => runAction(() => toggleSettings())}>
            <span className="flex-1">Settings</span>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Workspace">
          <CommandItem
            onSelect={() => {
              close();
              openAddProjectExplorer();
            }}
          >
            <span className="flex-1">Add Repository…</span>
          </CommandItem>
          <CommandItem onSelect={() => runAction(() => toggleSidebar())}>
            <span className="flex-1">{getShortcut('toggle-sidebar').label}</span>
            <CommandShortcut>{getShortcut('toggle-sidebar').glyph}</CommandShortcut>
          </CommandItem>
          {activeIssue && (
            <CommandItem onSelect={() => runAction(() => toggleIssueDetail())}>
              <span className="flex-1">{getShortcut('toggle-issue-detail').label}</span>
              <CommandShortcut>{getShortcut('toggle-issue-detail').glyph}</CommandShortcut>
            </CommandItem>
          )}
          <CommandItem onSelect={() => runAction(() => toggleTerminal())}>
            <span className="flex-1">{getShortcut('toggle-terminal').label}</span>
            <CommandShortcut>{getShortcut('toggle-terminal').glyph}</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        {activeProjectId && (
          <CommandGroup heading="Git">
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
              <span className="flex-1">Commit Changes</span>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                runAction(
                  () => void window.shipcode.invoke('git:push', { projectId: activeProjectId }),
                )
              }
            >
              <span className="flex-1">Push to Remote</span>
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </>
  );
}
