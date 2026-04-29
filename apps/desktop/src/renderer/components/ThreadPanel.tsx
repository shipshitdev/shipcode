import {
  type AppSettings,
  type GitHubIssueCacheRecord,
  githubRepoUrl,
  ISSUE_PIPELINE_STATUS,
  type IssuePipelineStatus,
  PIPELINE_PHASE,
  type Project,
  type Thread,
  type ThreadPanelData,
} from '@shipcode/shared';
import { KanbanBoard } from '@shipcode/ui';
import { Button, RefreshCw, X } from '@shipshitdev/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import log from 'electron-log/renderer';
import { useEffect, useMemo, useState } from 'react';
import { ProjectGraphTab } from '../features/project/project-graph-tab';
import { useAppStore } from '../stores/app-store';
import { ThreadPanelArchiveDialog } from './ThreadPanelArchiveDialog';

const EMPTY_ISSUES: GitHubIssueCacheRecord[] = [];
const DONE_PIPELINE_STATUSES: IssuePipelineStatus[] = [
  ISSUE_PIPELINE_STATUS.completed,
  ISSUE_PIPELINE_STATUS.done,
];

export function ThreadPanel() {
  const queryClient = useQueryClient();
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const selectedIssueNumber = useAppStore((state) => state.activeIssue?.issueNumber);
  const commandPaletteOpen = useAppStore((state) => state.commandPaletteOpen);
  const createIssueModalOpen = useAppStore((state) => state.createIssueModalOpen);
  const projectSettingsModalOpen = useAppStore((state) => state.projectSettingsModalOpen);
  const settingsVisible = useAppStore((state) => state.settingsVisible);
  const selectIssue = useAppStore((state) => state.selectIssue);
  const requestCommentComposer = useAppStore((state) => state.requestCommentComposer);
  const setGithubIssues = useAppStore((state) => state.setGithubIssues);
  const [isRefreshingBranches, setIsRefreshingBranches] = useState(false);
  const [archiveFeedback, setArchiveFeedback] = useState<{
    tone: 'pending' | 'success' | 'error';
    message: string;
  } | null>(null);
  const [doneUndo, setDoneUndo] = useState<{
    issueId: string;
    issueNumber: number;
    previousStatus: IssuePipelineStatus;
    previousState: GitHubIssueCacheRecord['state'];
    undoing: boolean;
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

  useEffect(() => {
    if (!doneUndo || doneUndo.undoing) return;
    const id = setTimeout(() => {
      setDoneUndo((current) => (current?.issueId === doneUndo.issueId ? null : current));
    }, 8000);
    return () => clearTimeout(id);
  }, [doneUndo]);

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
  const latestPlanStatusByThreadId = panelData?.latestPlanStatusByThreadId ?? {};
  const branches: string[] = panelData?.branches ?? [];
  const threadById = useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread] as const)),
    [threads],
  );
  const approvedAwaitingExecutionIssueIds = useMemo(() => {
    const issueIds = new Set<string>();
    for (const issue of issues) {
      if (
        issue.pipelineStatus === ISSUE_PIPELINE_STATUS.awaitingApproval &&
        issue.threadId &&
        latestPlanStatusByThreadId[issue.threadId] === 'approved'
      ) {
        issueIds.add(issue.id);
      }
    }
    return issueIds;
  }, [issues, latestPlanStatusByThreadId]);

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

  const patchIssueOptimistic = (
    id: string,
    patch: Partial<Pick<GitHubIssueCacheRecord, 'pipelineStatus' | 'state'>>,
  ) => {
    queryClient.setQueryData<GitHubIssueCacheRecord[]>(queryKey, (prev) =>
      prev ? prev.map((issue) => (issue.id === id ? { ...issue, ...patch } : issue)) : prev,
    );
    useAppStore.setState((state) => ({
      githubIssues: state.githubIssues.map((issue) =>
        issue.id === id ? { ...issue, ...patch } : issue,
      ),
      activeIssue:
        state.activeIssue?.id === id ? { ...state.activeIssue, ...patch } : state.activeIssue,
    }));
  };

  const repoUrl = githubRepoUrl(project?.gitRemote);
  const projectsUrl = project?.githubProjectUrl?.trim() ? project.githubProjectUrl.trim() : null;
  const handleIssueClick = (issue: GitHubIssueCacheRecord) => {
    selectIssue(issue);
    const store = useAppStore.getState();
    if (store.issueDetailCollapsed) {
      store.toggleIssueDetail();
    }
  };
  const handleIssueComment = (issue: GitHubIssueCacheRecord) => {
    handleIssueClick(issue);
    requestCommentComposer(issue.id);
  };

  return (
    <div className="relative flex flex-1 min-h-0 min-w-0 flex-col bg-primary">
      <KanbanBoard
        issues={issues}
        onIssueClick={handleIssueClick}
        onCommentIssue={handleIssueComment}
        keyboardShortcutsEnabled={
          !commandPaletteOpen &&
          !createIssueModalOpen &&
          !projectSettingsModalOpen &&
          !settingsVisible
        }
        selectedIssueNumber={selectedIssueNumber}
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
        approvedAwaitingExecutionIssueIds={approvedAwaitingExecutionIssueIds}
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
          patchIssueOptimistic(issue.id, { pipelineStatus: ISSUE_PIPELINE_STATUS.planning });
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
          patchIssueOptimistic(issue.id, {
            pipelineStatus: ISSUE_PIPELINE_STATUS.todo,
            state: 'open',
          });
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
        graphContent={<ProjectGraphTab embedded />}
        onMarkDone={(issue) => {
          if (!activeProjectId) return;
          const linkedThread = issue.threadId ? threadById.get(issue.threadId) : null;
          const nextStatus: IssuePipelineStatus =
            issue.state === 'closed'
              ? ISSUE_PIPELINE_STATUS.done
              : issue.linkedPrNumber != null || linkedThread?.status === PIPELINE_PHASE.completed
                ? ISSUE_PIPELINE_STATUS.completed
                : ISSUE_PIPELINE_STATUS.done;
          const nextState: GitHubIssueCacheRecord['state'] =
            nextStatus === ISSUE_PIPELINE_STATUS.done ? 'closed' : issue.state;
          patchIssueOptimistic(issue.id, { pipelineStatus: nextStatus, state: nextState });
          setDoneUndo(
            nextStatus === ISSUE_PIPELINE_STATUS.done
              ? {
                  issueId: issue.id,
                  issueNumber: issue.issueNumber,
                  previousStatus: issue.pipelineStatus,
                  previousState: issue.state,
                  undoing: false,
                }
              : null,
          );
          window.shipcode
            .invoke('github:mark-done', {
              projectId: activeProjectId,
              issueNumber: issue.issueNumber,
            })
            .then(() => activeProjectId && refreshIssues.mutate(activeProjectId))
            .catch((err) => {
              setDoneUndo((current) => (current?.issueId === issue.id ? null : current));
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
          patchIssueOptimistic(issue.id, {
            pipelineStatus: ISSUE_PIPELINE_STATUS.planning,
            state: 'open',
          });
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
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {doneUndo && (
          <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-warning/30 bg-elevated px-3 py-2 shadow-lg">
            <div className="min-w-0 text-xs text-secondary">
              <div className="font-medium text-primary">Moved #{doneUndo.issueNumber} to Done</div>
              <div className="truncate">
                Reopen the issue and restore it to {doneUndo.previousStatus.replaceAll('_', ' ')}.
              </div>
            </div>
            <Button
              variant="ghost"
              size="xs"
              disabled={doneUndo.undoing}
              onClick={() => {
                if (!activeProjectId) return;
                const target = doneUndo;
                setDoneUndo((current) =>
                  current?.issueId === target.issueId ? { ...current, undoing: true } : current,
                );
                patchIssueOptimistic(target.issueId, {
                  pipelineStatus: target.previousStatus,
                  state: target.previousState,
                });
                window.shipcode
                  .invoke('github:reopen-issue', {
                    projectId: activeProjectId,
                    issueNumber: target.issueNumber,
                  })
                  .then(() => {
                    setDoneUndo((current) =>
                      current?.issueId === target.issueId ? null : current,
                    );
                    activeProjectId && refreshIssues.mutate(activeProjectId);
                  })
                  .catch((err) => {
                    setDoneUndo((current) =>
                      current?.issueId === target.issueId ? null : current,
                    );
                    activeProjectId && refreshIssues.mutate(activeProjectId);
                    log.error('[threadpanel] undo mark-done failed', {
                      issueNumber: target.issueNumber,
                      err,
                    });
                    window.alert(
                      `Failed to restore issue #${target.issueNumber}: ${err?.message ?? err}`,
                    );
                  });
              }}
            >
              {doneUndo.undoing ? 'Undoing…' : 'Undo'}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted hover:bg-transparent hover:text-primary"
              title="Dismiss undo"
              aria-label="Dismiss undo"
              onClick={() => setDoneUndo(null)}
            >
              <X size={12} />
            </Button>
          </div>
        )}
        {archiveFeedback && (
          <div
            className={
              archiveFeedback.tone === 'error'
                ? 'pointer-events-auto flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 shadow-lg text-xs text-danger'
                : archiveFeedback.tone === 'pending'
                  ? 'pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2 shadow-lg text-xs text-secondary'
                  : 'pointer-events-auto flex items-center gap-2 rounded-lg border border-agent/30 bg-agent/10 px-3 py-2 shadow-lg text-xs text-agent'
            }
          >
            <RefreshCw
              size={12}
              className={archiveFeedback.tone === 'pending' ? 'animate-spin text-muted' : ''}
            />
            {archiveFeedback.message}
          </div>
        )}
      </div>
    </div>
  );
}
