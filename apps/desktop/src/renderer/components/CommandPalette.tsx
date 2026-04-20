import type { GitHubIssueCacheRecord, Project } from '@shipcode/shared';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@shipcode/ui';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getShortcut } from '../data/shortcuts';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';

export function CommandPalette() {
  const queryClient = useQueryClient();
  const {
    commandPaletteOpen,
    toggleCommandPalette,
    openCreateIssueModal,
    activeProjectId,
    activeThreadId,
    pipelinePhase,
    toggleTerminal,
    toggleSettings,
    toggleSidebar,
    toggleIssueDetail,
    activeIssue,
    openOverview,
    openActivity,
    openInbox,
    openCosts,
    openSkills,
    openTerminalSessions,
    setProjectTab,
    selectProject,
    openProjectSettingsModal,
    openInstantFixModal,
    navigateToIssue,
  } = useAppStore();

  // Cross-project issue search — only fetches when palette is open
  const { data: allProjects = [] } = useQuery<Project[]>({
    queryKey: ['projects-visible'],
    queryFn: () => window.shipcode.invoke('project:list-visible'),
    staleTime: STABLE_APP_STATE_STALE_TIME,
    enabled: commandPaletteOpen,
  });

  const issueResults = useQueries({
    queries: allProjects.map((p) => ({
      queryKey: ['github-issues', p.id] as const,
      queryFn: () =>
        window.shipcode.invoke<GitHubIssueCacheRecord[]>('github:list-issues', {
          projectId: p.id,
        }),
      staleTime: STABLE_APP_STATE_STALE_TIME,
      enabled: commandPaletteOpen,
    })),
  });

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

  const addProject = useMutation({
    mutationFn: async () => {
      const path = await window.shipcode.invoke<string | null>('dialog:open-directory');
      if (!path) return null;
      return window.shipcode.invoke<Project>('project:add', { path });
    },
    onSuccess: (project) => {
      if (project) {
        queryClient.invalidateQueries({ queryKey: ['projects'] });
        queryClient.invalidateQueries({ queryKey: ['projects-visible'] });
        queryClient.invalidateQueries({ queryKey: ['projects-archived'] });
        selectProject(project.id);
        openProjectSettingsModal(project.id, 'setup');
      }
    },
  });

  const close = () => toggleCommandPalette();

  const runAction = (fn: () => void | Promise<void>) => {
    close();
    fn();
  };

  return (
    <CommandDialog open={commandPaletteOpen} onOpenChange={toggleCommandPalette}>
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
            {pipelinePhase === 'idle' && (
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
            {pipelinePhase === 'awaiting_approval' && (
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
          <CommandItem onSelect={() => runAction(() => openInstantFixModal())}>
            <span className="flex-1">New Terminal Session...</span>
            <CommandShortcut>{getShortcut('instant-fix').glyph}</CommandShortcut>
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
          <CommandItem onSelect={() => runAction(() => addProject.mutate())}>
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
    </CommandDialog>
  );
}
