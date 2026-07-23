import {
  type GitHubIssueCacheRecord,
  ISSUE_PIPELINE_STATUS,
  type IssuePipelineStatus,
  PIPELINE_PHASE,
  type Thread,
} from '@shipcode/shared';
import { useQueryClient } from '@tanstack/react-query';
import log from 'electron-log/renderer';
import { useCallback } from 'react';
import { toast } from '../stores/toast-store';
import { currentIsoTimestamp } from './format-timestamp';

type IssuesPanelActionIssue = Pick<
  GitHubIssueCacheRecord,
  'id' | 'issueNumber' | 'pipelineStatus' | 'threadId'
>;

type IssuePatch = Partial<Pick<GitHubIssueCacheRecord, 'pipelineStatus' | 'state'>>;

type ThreadPatch = Partial<
  Pick<Thread, 'status' | 'doneAt' | 'updatedAt' | 'archivedAt' | 'pausedPhase' | 'pausedAt'>
>;

interface UseIssuesPanelActionsOptions {
  activeProjectId: string | null;
  threadById: ReadonlyMap<string, Thread>;
  patchIssueOptimistic: (issueId: string, patch: IssuePatch) => void;
  patchThreadOptimistic: (threadId: string, patch: ThreadPatch) => void;
  refreshIssues: (projectId: string) => void;
}

export function useIssuesPanelActions({
  activeProjectId,
  threadById,
  patchIssueOptimistic,
  patchThreadOptimistic,
  refreshIssues,
}: UseIssuesPanelActionsOptions) {
  const queryClient = useQueryClient();

  const refreshIssueState = useCallback(() => {
    if (activeProjectId) refreshIssues(activeProjectId);
  }, [activeProjectId, refreshIssues]);

  const refreshIssueAndThreadState = useCallback(() => {
    if (!activeProjectId) return;
    refreshIssues(activeProjectId);
    queryClient.invalidateQueries({
      queryKey: ['thread-panel-data', activeProjectId],
    });
  }, [activeProjectId, queryClient, refreshIssues]);

  const startPipeline = useCallback(
    (issue: IssuesPanelActionIssue) => {
      patchIssueOptimistic(issue.id, {
        pipelineStatus: ISSUE_PIPELINE_STATUS.planning,
      });
      return window.shipcode
        .invoke('github:start-issue', {
          projectId: activeProjectId,
          issueNumber: issue.issueNumber,
        })
        .then(refreshIssueState)
        .catch((err) => {
          refreshIssueState();
          log.error('[threadpanel] start-issue failed', {
            issueNumber: issue.issueNumber,
            err,
          });
          toast.error(`Failed to start issue #${issue.issueNumber}`, err?.message ?? String(err));
        });
    },
    [activeProjectId, patchIssueOptimistic, refreshIssueState],
  );

  const pausePipeline = useCallback(
    (issue: IssuesPanelActionIssue) => {
      if (!issue.threadId) return;
      const pausedAt = currentIsoTimestamp();
      patchIssueOptimistic(issue.id, {
        pipelineStatus: ISSUE_PIPELINE_STATUS.paused,
      });
      patchThreadOptimistic(issue.threadId, {
        status: PIPELINE_PHASE.paused,
        pausedPhase: issue.pipelineStatus as Thread['pausedPhase'],
        pausedAt,
        updatedAt: pausedAt,
      });
      return window.shipcode
        .invoke('pipeline:pause', { threadId: issue.threadId })
        .then(refreshIssueAndThreadState)
        .catch((err) => {
          refreshIssueAndThreadState();
          log.error('[threadpanel] pause failed', {
            issueNumber: issue.issueNumber,
            err,
          });
          toast.error('Failed to pause task', err?.message ?? String(err));
        });
    },
    [patchIssueOptimistic, patchThreadOptimistic, refreshIssueAndThreadState],
  );

  const resumePipeline = useCallback(
    (issue: IssuesPanelActionIssue) => {
      if (!issue.threadId) return;
      const resumedAt = currentIsoTimestamp();
      const thread = threadById.get(issue.threadId);
      const nextStatus = (thread?.pausedPhase ?? PIPELINE_PHASE.executing) as IssuePipelineStatus;
      patchIssueOptimistic(issue.id, { pipelineStatus: nextStatus });
      patchThreadOptimistic(issue.threadId, {
        status: nextStatus as Thread['status'],
        pausedPhase: null,
        pausedAt: null,
        updatedAt: resumedAt,
      });
      return window.shipcode
        .invoke('pipeline:resume', { threadId: issue.threadId })
        .then(refreshIssueAndThreadState)
        .catch((err) => {
          refreshIssueAndThreadState();
          log.error('[threadpanel] resume failed', {
            issueNumber: issue.issueNumber,
            err,
          });
          toast.error('Failed to resume task', err?.message ?? String(err));
        });
    },
    [patchIssueOptimistic, patchThreadOptimistic, refreshIssueAndThreadState, threadById],
  );

  return { pausePipeline, resumePipeline, startPipeline };
}
