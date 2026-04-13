import type { Project } from '@shipcode/shared';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@shipcode/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getShortcut } from '../data/shortcuts';
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
    selectProject,
  } = useAppStore();

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
      <CommandInput placeholder="Type a command..." />
      <CommandList>
        <CommandEmpty>No commands found.</CommandEmpty>

        <CommandGroup heading="GitHub">
          {activeProjectId && (
            <>
              <CommandItem onSelect={() => runAction(() => openCreateIssueModal())}>
                <span className="flex-1">New PRD...</span>
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
                runAction(() =>
                  window.shipcode.invoke('git:commit', { projectId: activeProjectId, message: '' }),
                )
              }
            >
              <span className="flex-1">Commit Changes</span>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                runAction(() => window.shipcode.invoke('git:push', { projectId: activeProjectId }))
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
