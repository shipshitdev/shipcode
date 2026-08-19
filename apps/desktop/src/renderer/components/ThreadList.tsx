import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import { ISSUE_PIPELINE_STATUS, stripIssueTitlePriorityPrefix } from '@shipcode/shared';
import { PhaseChip } from '@shipcode/ui';
import { Button, cn, Skeleton } from '@shipshitdev/ui';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';

const THREAD_LOADING_KEYS = ['thread-loading-1', 'thread-loading-2', 'thread-loading-3'];

const ATTENTION_STATUSES = new Set([
  ISSUE_PIPELINE_STATUS.failed,
  ISSUE_PIPELINE_STATUS.paused,
  ISSUE_PIPELINE_STATUS.clarifying,
  ISSUE_PIPELINE_STATUS.approval,
]);

function threadRank(issue: GitHubIssueCacheRecord): number {
  if (ATTENTION_STATUSES.has(issue.pipelineStatus)) return 0;
  if (issue.threadId) return 1;
  if (issue.state === 'open') return 2;
  return 3;
}

export function ThreadList() {
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const activeIssue = useAppStore((state) => state.activeIssue);
  const selectIssue = useAppStore((state) => state.selectIssue);
  const githubIssues = useAppStore((state) => state.githubIssues);

  const { data: queriedIssues, isLoading } = useQuery<GitHubIssueCacheRecord[]>({
    queryKey: ['github-issues', activeProjectId],
    queryFn: () => {
      if (!activeProjectId) throw new Error('Missing active project id');
      return window.shipcode.invoke('github:list-issues', { projectId: activeProjectId });
    },
    enabled: !!activeProjectId,
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });

  const issues = (queriedIssues ?? githubIssues ?? []).toSorted((a, b) => {
    const rankDelta = threadRank(a) - threadRank(b);
    if (rankDelta !== 0) return rankDelta;
    return b.issueNumber - a.issueNumber;
  });

  if (!activeProjectId) {
    return null;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="thread-list">
      <div className="flex items-center justify-between px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <span>Conversations</span>
        <span className="font-mono font-normal normal-case tracking-normal text-muted-foreground/80">
          {isLoading && issues.length === 0 ? '—' : issues.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {isLoading && issues.length === 0
          ? THREAD_LOADING_KEYS.map((key) => (
              <div key={key} className="flex items-center gap-2 px-2.5 py-2">
                <Skeleton className="h-3 w-8 rounded" />
                <Skeleton className="h-3 flex-1 rounded" />
              </div>
            ))
          : null}
        {!isLoading && issues.length === 0 ? (
          <div className="px-3 py-6 text-[12px] leading-5 text-muted-foreground">
            No issues in this project yet. Create one to start an agent thread.
          </div>
        ) : null}
        {issues.map((issue) => {
          const isActive = activeIssue?.id === issue.id;
          const title = stripIssueTitlePriorityPrefix(issue.title);
          return (
            <Button
              key={issue.id}
              type="button"
              variant="ghost"
              data-testid={`thread-row-${issue.issueNumber}`}
              className={cn(
                'h-auto w-full items-start gap-2 rounded-md px-2.5 py-2 text-left font-normal app-region-no-drag',
                isActive && 'bg-tertiary',
              )}
              onClick={() => selectIssue(issue)}
            >
              <MessageSquare
                size={13}
                className={cn(
                  'mt-0.5 shrink-0',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    #{issue.issueNumber}
                  </span>
                  <PhaseChip status={issue.pipelineStatus} className="text-[9px]" />
                </span>
                <span
                  className={cn(
                    'mt-0.5 block truncate text-[12px] leading-4',
                    isActive ? 'text-primary' : 'text-secondary',
                  )}
                >
                  {title}
                </span>
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
