import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import log from 'electron-log/renderer';
import { useAppStore } from '../stores/app-store';
import { KanbanBoard, Modal, ModalFooter, Button } from '@shipcode/ui';
import {
  type AppSettings,
  githubRepoUrl,
  githubProjectsUrl,
  type GitHubIssueCacheRecord,
  type IssuePipelineStatus,
  type Project,
  type Thread,
} from '@shipcode/shared';

export function ThreadPanel() {
  const queryClient = useQueryClient();
  const { activeProjectId, selectIssue, openCreateIssueModal, activeIssue } = useAppStore();

  const { data: issues = [] } = useQuery<GitHubIssueCacheRecord[]>({
    queryKey: ['github-issues', activeProjectId],
    queryFn: () => window.shipcode.invoke('github:list-issues', { projectId: activeProjectId }),
    enabled: !!activeProjectId,
    staleTime: 5_000,
  });

  const refreshIssues = useMutation({
    mutationFn: (projectId: string) =>
      window.shipcode.invoke<GitHubIssueCacheRecord[]>('github:refresh-issues', { projectId }),
    onSuccess: (freshIssues, projectId) => {
      queryClient.setQueryData(['github-issues', projectId], freshIssues);
    },
    onError: (err) => {
      log.error('[threadpanel] refresh-issues failed', { err });
    },
  });

  useEffect(() => {
    if (!activeProjectId) return;
    refreshIssues.mutate(activeProjectId);
  }, [activeProjectId]);

  // The per-project base branch drives the Kanban toolbar Select. Read via
  // the narrow `project:get` channel rather than scanning the full list.
  const { data: project } = useQuery<Project | null>({
    queryKey: ['project', activeProjectId],
    queryFn: () => window.shipcode.invoke('project:get', { projectId: activeProjectId! }),
    enabled: !!activeProjectId,
    staleTime: 30_000,
  });

  const { data: settings } = useQuery<AppSettings>({
    queryKey: ['settings'],
    queryFn: () => window.shipcode.invoke('settings:get'),
  });

  const { data: threads = [] } = useQuery<Thread[]>({
    queryKey: ['threads', activeProjectId],
    queryFn: () => window.shipcode.invoke('thread:list', { projectId: activeProjectId! }),
    enabled: !!activeProjectId,
    staleTime: 5_000,
  });

  // Local git branches (normalized) — source for the toolbar dropdown.
  const { data: branches = [] } = useQuery<string[]>({
    queryKey: ['git-branches', activeProjectId],
    queryFn: () => window.shipcode.invoke('git:list-branches', { projectId: activeProjectId! }),
    enabled: !!activeProjectId,
    staleTime: 60_000,
  });

  // Optimistically flip a single issue's pipelineStatus in the local cache so
  // the card jumps to its new column instantly on drop, instead of waiting
  // for the round-trip to the main process. On error we force a refetch to
  // reconcile with the real state.
  const queryKey = ['github-issues', activeProjectId] as const;

  const [archiveConfirm, setArchiveConfirm] = useState<
    | { type: 'one'; issue: GitHubIssueCacheRecord }
    | { type: 'all'; count: number }
    | null
  >(null);

  const handleArchiveConfirm = () => {
    if (!archiveConfirm || !activeProjectId) return;
    const confirm = archiveConfirm;
    setArchiveConfirm(null);

    if (confirm.type === 'one') {
      window.shipcode
        .invoke('github:archive-issue', {
          projectId: activeProjectId,
          issueNumber: confirm.issue.issueNumber,
        })
        .then(() => refreshIssues.mutate(activeProjectId))
        .catch((err) => {
          refreshIssues.mutate(activeProjectId);
          log.error('[threadpanel] archive-issue failed', { err });
          window.alert(`Failed to archive issue: ${err?.message ?? err}`);
        });
    } else {
      window.shipcode
        .invoke('github:archive-all-done', { projectId: activeProjectId })
        .then((result) => {
          const { archivedCount, failedCount } = result as { archivedCount: number; failedCount: number };
          refreshIssues.mutate(activeProjectId);
          if (failedCount > 0) {
            window.alert(`Archived ${archivedCount} issues. ${failedCount} could not be closed on GitHub.`);
          }
        })
        .catch((err) => {
          refreshIssues.mutate(activeProjectId);
          log.error('[threadpanel] archive-all-done failed', { err });
          window.alert(`Failed to archive done issues: ${err?.message ?? err}`);
        });
    }
  };

  const setPipelineStatusOptimistic = (id: string, status: IssuePipelineStatus) => {
    queryClient.setQueryData<GitHubIssueCacheRecord[]>(queryKey, (prev) =>
      prev ? prev.map((i) => (i.id === id ? { ...i, pipelineStatus: status } : i)) : prev,
    );
  };

  const repoUrl = githubRepoUrl(project?.gitRemote);
  const projectsUrl = githubProjectsUrl(project?.gitRemote, project?.githubProjectUrl);

  return (
    <div className="flex flex-1 min-w-0 flex-col bg-primary">
      <KanbanBoard
        issues={issues}
        onIssueClick={(issue) => selectIssue(issue)}
        selectedIssueNumber={activeIssue?.issueNumber}
        onRefresh={() => activeProjectId && refreshIssues.mutate(activeProjectId)}
        onNewIssue={() => openCreateIssueModal()}
        baseBranch={project?.defaultBranch}
        branches={branches}
        onRefreshBranches={() => {
          window.shipcode
            .invoke('git:list-branches', { projectId: activeProjectId!, fetch: true })
            .then((fresh) => {
              queryClient.setQueryData(['git-branches', activeProjectId], fresh);
            })
            .catch((err) => log.error('[threadpanel] refresh branches failed', err));
        }}
        projectName={project?.name}
        project={project}
        settings={settings}
        threads={threads}
        repoUrl={repoUrl}
        projectsUrl={projectsUrl}
        onOpenExternal={(url) =>
          window.shipcode.invoke('shell:open-external', { url }).catch((err) => {
            log.error('[threadpanel] open-external failed', { url, err });
          })
        }
        onBaseBranchChange={(branch) => {
          // Optimistic cache update so the toolbar reflects the new branch
          // on the same frame as the click, without waiting for IPC.
          queryClient.setQueryData<Project | null>(['project', activeProjectId], (prev) =>
            prev ? { ...prev, defaultBranch: branch } : prev,
          );
          window.shipcode
            .invoke('project:set-default-branch', {
              projectId: activeProjectId!,
              branch,
            })
            .catch((err) => {
              queryClient.invalidateQueries({ queryKey: ['project', activeProjectId] });
              log.error('[threadpanel] set-default-branch failed', err);
              window.alert(`Failed to set base branch: ${err?.message ?? err}`);
            });
        }}
        onStartPipeline={(issue) => {
          setPipelineStatusOptimistic(issue.id, 'planning');
          window.shipcode
            .invoke('github:start-issue', {
              projectId: activeProjectId,
              issueNumber: issue.issueNumber,
            })
            .then(() => activeProjectId && refreshIssues.mutate(activeProjectId))
            .catch((err) => {
              if (activeProjectId) refreshIssues.mutate(activeProjectId);
              log.error('[threadpanel] start-issue failed', {
                issueNumber: issue.issueNumber,
                err,
              });
              window.alert(`Failed to start issue #${issue.issueNumber}: ${err?.message ?? err}`);
            });
        }}
        onRetry={(issue) => {
          setPipelineStatusOptimistic(issue.id, 'todo');
          window.shipcode
            .invoke('github:retry-issue', {
              projectId: activeProjectId,
              issueNumber: issue.issueNumber,
            })
            .then(() => activeProjectId && refreshIssues.mutate(activeProjectId))
            .catch((err) => {
              if (activeProjectId) refreshIssues.mutate(activeProjectId);
              log.error('[threadpanel] retry-issue failed', {
                issueNumber: issue.issueNumber,
                err,
              });
              window.alert(`Failed to retry issue #${issue.issueNumber}: ${err?.message ?? err}`);
            });
        }}
        onArchiveIssue={(issue) => setArchiveConfirm({ type: 'one', issue })}
        onArchiveAllDone={() => {
          const doneCount = issues.filter((i) => i.pipelineStatus === 'completed').length;
          setArchiveConfirm({ type: 'all', count: doneCount });
        }}
        onRerun={(issue) => {
          setPipelineStatusOptimistic(issue.id, 'planning');
          window.shipcode
            .invoke('github:start-issue', {
              projectId: activeProjectId,
              issueNumber: issue.issueNumber,
            })
            .then(() => activeProjectId && refreshIssues.mutate(activeProjectId))
            .catch((err) => {
              if (activeProjectId) refreshIssues.mutate(activeProjectId);
              log.error('[threadpanel] rerun failed', { issueNumber: issue.issueNumber, err });
              window.alert(`Failed to re-run issue #${issue.issueNumber}: ${err?.message ?? err}`);
            });
        }}
        onCancel={(issue) => {
          if (!issue.threadId) return;
          window.shipcode
            .invoke('pipeline:cancel', { threadId: issue.threadId })
            .then(() => activeProjectId && refreshIssues.mutate(activeProjectId))
            .catch((err) => {
              log.error('[threadpanel] cancel failed', { issueNumber: issue.issueNumber, err });
            });
        }}
      />
      <Modal
        open={archiveConfirm !== null}
        onClose={() => setArchiveConfirm(null)}
        title={
          archiveConfirm?.type === 'one'
            ? `Close issue #${archiveConfirm.issue.issueNumber}?`
            : `Close ${archiveConfirm?.count ?? 0} done issue${(archiveConfirm?.count ?? 0) !== 1 ? 's' : ''}?`
        }
        className="max-w-sm"
      >
        <p className="text-sm text-secondary">
          This will close the issue on GitHub and remove it from the board.
        </p>
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={() => setArchiveConfirm(null)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleArchiveConfirm}>
            Close issue
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
