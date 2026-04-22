import {
  type AppSettings,
  type GitHubIssueCacheRecord,
  githubProjectsUrl,
  githubRepoUrl,
  type IssuePipelineStatus,
  type Project,
  type Thread,
  type ThreadPanelData,
} from '@shipcode/shared';
import { KanbanBoard, RefreshCw } from '@shipcode/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import log from 'electron-log/renderer';
import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/app-store';
import { ThreadPanelArchiveDialog } from './ThreadPanelArchiveDialog';

const EMPTY_ISSUES: GitHubIssueCacheRecord[] = [];
const DONE_PIPELINE_STATUSES: IssuePipelineStatus[] = ['completed', 'done'];

export function ThreadPanel() {
  const queryClient = useQueryClient();
  const { activeProjectId, selectIssue, activeIssue, setGithubIssues } = useAppStore();
  const [isRefreshingBranches, setIsRefreshingBranches] = useState(false);
  const [archiveFeedback, setArchiveFeedback] = useState<{
    tone: 'pending' | 'success' | 'error';
    message: string;
  } | null>(null);

  const { data: issuesData } = useQuery<GitHubIssueCacheRecord[]>({
    queryKey: ['github-issues', activeProjectId],
    queryFn: () => window.shipcode.invoke('github:list-issues', { projectId: activeProjectId }),
    enabled: !!activeProjectId,
    staleTime: 5_000,
  });
  const issues = issuesData ?? EMPTY_ISSUES;

  useEffect(() => {
    if (issuesData === undefined) return;
    setGithubIssues(issuesData);
  }, [issuesData, setGithubIssues]);

  const refreshIssues = useMutation({
    mutationFn: (projectId: string) =>
      window.shipcode.invoke<GitHubIssueCacheRecord[]>('github:refresh-issues', {
        projectId,
        force: true,
      }),
    onSuccess: (freshIssues, projectId) => {
      queryClient.setQueryData(['github-issues', projectId], freshIssues);
    },
    onError: (err) => {
      log.error('[threadpanel] refresh-issues failed', { err });
    },
  });

  useEffect(() => {
    if (!archiveFeedback || archiveFeedback.tone === 'pending') return;
    const id = setTimeout(() => setArchiveFeedback(null), 5000);
    return () => clearTimeout(id);
  }, [archiveFeedback]);

  const { data: panelData } = useQuery<ThreadPanelData>({
    queryKey: ['thread-panel-data', activeProjectId],
    queryFn: () =>
      window.shipcode.invoke<ThreadPanelData>('thread-panel:get-data', {
        projectId: activeProjectId ?? '',
      }),
    enabled: !!activeProjectId,
    staleTime: 5_000,
  });
  const project: Project | null = panelData?.project ?? null;
  const settings: AppSettings | undefined = panelData?.settings;
  const threads: Thread[] = panelData?.threads ?? [];
  const branches: string[] = panelData?.branches ?? [];
  const threadById = new Map(threads.map((thread) => [thread.id, thread] as const));

  // Optimistically flip a single issue's pipelineStatus in the local cache so
  // the card jumps to its new column instantly on drop, instead of waiting
  // for the round-trip to the main process. On error we force a refetch to
  // reconcile with the real state.
  const queryKey = ['github-issues', activeProjectId] as const;

  const [archiveConfirm, setArchiveConfirm] = useState<
    { type: 'one'; issue: GitHubIssueCacheRecord } | { type: 'all'; count: number } | null
  >(null);

  const archiveIssuesOptimistic = (ids: string[]) => {
    queryClient.setQueryData<GitHubIssueCacheRecord[]>(queryKey, (prev) =>
      prev ? prev.filter((issue) => !ids.includes(issue.id)) : prev,
    );
  };

  const handleArchiveConfirm = () => {
    if (!archiveConfirm || !activeProjectId) return;
    const confirm = archiveConfirm;
    setArchiveConfirm(null);

    if (confirm.type === 'one') {
      archiveIssuesOptimistic([confirm.issue.id]);
      setArchiveFeedback({
        tone: 'pending',
        message: `Archiving issue #${confirm.issue.issueNumber} on GitHub…`,
      });
      window.shipcode
        .invoke('github:archive-issue', {
          projectId: activeProjectId,
          issueNumber: confirm.issue.issueNumber,
        })
        .then(() => {
          setArchiveFeedback({
            tone: 'success',
            message: `Issue #${confirm.issue.issueNumber} archived. GitHub Projects can take 1-2 minutes to reflect it.`,
          });
          refreshIssues.mutate(activeProjectId);
        })
        .catch((err) => {
          setArchiveFeedback({
            tone: 'error',
            message: `Failed to archive issue #${confirm.issue.issueNumber}.`,
          });
          refreshIssues.mutate(activeProjectId);
          log.error('[threadpanel] archive-issue failed', { err });
          window.alert(`Failed to archive issue: ${err?.message ?? err}`);
        });
    } else {
      const doneIssues = issues.filter((issue) =>
        DONE_PIPELINE_STATUSES.includes(issue.pipelineStatus),
      );
      archiveIssuesOptimistic(doneIssues.map((issue) => issue.id));
      setArchiveFeedback({
        tone: 'pending',
        message: `Archiving ${doneIssues.length} done issue${doneIssues.length === 1 ? '' : 's'} on GitHub…`,
      });
      window.shipcode
        .invoke('github:archive-all-done', { projectId: activeProjectId })
        .then((result) => {
          const { archivedCount, failedCount } = result as {
            archivedCount: number;
            failedCount: number;
          };
          setArchiveFeedback({
            tone: failedCount > 0 ? 'error' : 'success',
            message:
              failedCount > 0
                ? `Archived ${archivedCount} issues. ${failedCount} still need GitHub cleanup or retry.`
                : `Archived ${archivedCount} issues. GitHub Projects can take 1-2 minutes to reflect it.`,
          });
          refreshIssues.mutate(activeProjectId);
          if (failedCount > 0) {
            window.alert(
              `Archived ${archivedCount} issues. ${failedCount} could not be fully archived on GitHub and may still be visible in Done.`,
            );
          }
        })
        .catch((err) => {
          setArchiveFeedback({
            tone: 'error',
            message: 'Failed to archive done issues.',
          });
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
  const handleIssueClick = (issue: GitHubIssueCacheRecord) => {
    selectIssue(issue);
    const store = useAppStore.getState();
    if (store.issueDetailCollapsed) {
      store.toggleIssueDetail();
    }
  };

  return (
    <div className="relative flex flex-1 min-h-0 min-w-0 flex-col bg-primary">
      <KanbanBoard
        issues={issues}
        onIssueClick={handleIssueClick}
        selectedIssueNumber={activeIssue?.issueNumber}
        onRefresh={() => activeProjectId && refreshIssues.mutate(activeProjectId)}
        baseBranch={project?.defaultBranch}
        branches={branches}
        refreshingBranches={isRefreshingBranches}
        onRefreshBranches={() => {
          setIsRefreshingBranches(true);
          window.shipcode
            .invoke<string[]>('git:list-branches', {
              projectId: activeProjectId ?? '',
              fetch: true,
            })
            .then((fresh) => {
              queryClient.setQueryData(['git-branches', activeProjectId], fresh);
              queryClient.setQueryData<ThreadPanelData | undefined>(
                ['thread-panel-data', activeProjectId],
                (prev) => (prev ? { ...prev, branches: fresh } : prev),
              );
            })
            .catch((err) => log.error('[threadpanel] refresh branches failed', err))
            .finally(() => setIsRefreshingBranches(false));
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
        onOpenPullRequest={(url) =>
          window.shipcode.invoke('shell:open-external', { url }).catch((err) => {
            log.error('[threadpanel] open-pull-request failed', { url, err });
          })
        }
        onBaseBranchChange={(branch) => {
          // Optimistic cache update so the toolbar reflects the new branch
          // on the same frame as the click, without waiting for IPC.
          queryClient.setQueryData<Project | null>(['project', activeProjectId], (prev) =>
            prev ? { ...prev, defaultBranch: branch } : prev,
          );
          queryClient.setQueryData<ThreadPanelData | undefined>(
            ['thread-panel-data', activeProjectId],
            (prev) =>
              prev?.project
                ? { ...prev, project: { ...prev.project, defaultBranch: branch } }
                : prev,
          );
          window.shipcode
            .invoke('project:set-default-branch', {
              projectId: activeProjectId ?? '',
              branch,
            })
            .catch((err) => {
              queryClient.invalidateQueries({ queryKey: ['project', activeProjectId] });
              queryClient.invalidateQueries({ queryKey: ['thread-panel-data', activeProjectId] });
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
          const request = issue.threadId
            ? window.shipcode.invoke('pipeline:retry', { threadId: issue.threadId })
            : window.shipcode.invoke('github:retry-issue', {
                projectId: activeProjectId,
                issueNumber: issue.issueNumber,
              });
          request
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
          const doneCount = issues.filter((i) =>
            DONE_PIPELINE_STATUSES.includes(i.pipelineStatus),
          ).length;
          setArchiveConfirm({ type: 'all', count: doneCount });
        }}
        onMarkDone={(issue) => {
          if (!activeProjectId) return;
          const linkedThread = issue.threadId ? threadById.get(issue.threadId) : null;
          const nextStatus: IssuePipelineStatus =
            issue.state === 'closed'
              ? 'done'
              : issue.linkedPrNumber != null || linkedThread?.status === 'completed'
                ? 'completed'
                : 'done';
          setPipelineStatusOptimistic(issue.id, nextStatus);
          window.shipcode
            .invoke('github:mark-done', {
              projectId: activeProjectId,
              issueNumber: issue.issueNumber,
            })
            .then(() => activeProjectId && refreshIssues.mutate(activeProjectId))
            .catch((err) => {
              if (activeProjectId) refreshIssues.mutate(activeProjectId);
              log.error('[threadpanel] close-issue failed', {
                issueNumber: issue.issueNumber,
                err,
              });
              window.alert(
                `Failed to mark issue #${issue.issueNumber} as done: ${err?.message ?? err}`,
              );
            });
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
      <ThreadPanelArchiveDialog
        open={archiveConfirm !== null}
        issueNumber={archiveConfirm?.type === 'one' ? archiveConfirm.issue.issueNumber : undefined}
        count={archiveConfirm?.type === 'all' ? archiveConfirm.count : undefined}
        onClose={() => setArchiveConfirm(null)}
        onConfirm={handleArchiveConfirm}
      />
      {archiveFeedback && (
        <div className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div
            className={
              archiveFeedback.tone === 'error'
                ? 'flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 shadow-lg text-xs text-danger'
                : archiveFeedback.tone === 'pending'
                  ? 'flex items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2 shadow-lg text-xs text-secondary'
                  : 'flex items-center gap-2 rounded-lg border border-agent/30 bg-agent/10 px-3 py-2 shadow-lg text-xs text-agent'
            }
          >
            <RefreshCw
              size={12}
              className={archiveFeedback.tone === 'pending' ? 'animate-spin text-muted' : ''}
            />
            {archiveFeedback.message}
          </div>
        </div>
      )}
    </div>
  );
}
