import type { PullRequestDetailResponse } from '@shipcode/shared';
import { SideBySideDiffViewer } from '@shipcode/ui';
import { Button, cn } from '@shipshitdev/ui';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, GitPullRequest } from 'lucide-react';
import { useAppStore } from '../../stores/app-store';
import { PullRequestDetailActions } from './PullRequestDetailActions';

export function PullRequestDetailPanel({ prNumber }: { prNumber: number }) {
  const activeProjectId = useAppStore((state) => state.activeProjectId);

  const { data: detail, isLoading } = useQuery<PullRequestDetailResponse>({
    queryKey: ['pr-detail', activeProjectId, prNumber],
    queryFn: () => {
      if (!activeProjectId) {
        throw new Error('Missing active project id');
      }
      return window.shipcode.invoke('github:get-pr-detail', {
        projectId: activeProjectId,
        prNumber,
      });
    },
    enabled: !!activeProjectId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  if (isLoading || !detail) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-4">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <GitPullRequest size={16} className="shrink-0 text-secondary" />
          <h2 className="text-sm font-medium text-primary">{detail.title}</h2>
          <span className="text-xs font-mono text-muted-foreground">#{detail.number}</span>
          <div className="flex-1" />
          <Button
            variant="ghost"
            className="h-6 gap-1 px-2 text-[11px] text-secondary"
            onClick={() => window.shipcode.invoke('shell:open-external', { url: detail.url })}
          >
            <ExternalLink size={11} />
            GitHub
          </Button>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          {detail.author && <span>{detail.author}</span>}
          <span>·</span>
          <span>
            {detail.headRefName} ← {detail.baseRefName}
          </span>
          <span>·</span>
          <span
            className={cn(
              detail.state === 'OPEN' && 'text-green-400',
              detail.state === 'MERGED' && 'text-purple-400',
              detail.state === 'CLOSED' && 'text-red-400',
            )}
          >
            {detail.state}
          </span>
          {detail.isDraft && <span className="text-muted-foreground">(Draft)</span>}
        </div>
      </div>

      {/* Diff stats */}
      <div className="mb-4 flex items-center gap-3 rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs">
        <span className="text-muted-foreground">{detail.changedFiles} files changed</span>
        <span className="text-green-400">+{detail.additions}</span>
        <span className="text-red-400">-{detail.deletions}</span>
      </div>

      <div className="mb-4">
        <h3 className="mb-2 text-xs font-medium text-primary">Code Changes</h3>
        {detail.diffs.length > 0 ? (
          <div className="h-[500px] overflow-hidden rounded-md border border-border bg-secondary/20">
            <SideBySideDiffViewer diffs={detail.diffs} className="h-full" />
          </div>
        ) : (
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-[11px] text-muted-foreground">
            {detail.linkedThreadId
              ? 'No local execution diff is stored for this PR yet.'
              : 'This PR is not linked to a ShipCode pipeline thread, so no local execution diff is available.'}
          </div>
        )}
      </div>

      {/* CI Checks */}
      {detail.failingChecks.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 text-xs font-medium text-primary">
            Failing Checks ({detail.failingChecks.length})
          </h3>
          <div className="space-y-1">
            {detail.failingChecks.map((check) => (
              <div
                key={check.name}
                className="flex items-center gap-2 rounded border border-border bg-secondary/30 px-2.5 py-1.5 text-[11px]"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                <span className="flex-1 truncate text-primary">{check.name}</span>
                {check.workflowName && (
                  <span className="text-muted-foreground">{check.workflowName}</span>
                )}
                {check.detailsUrl && (
                  <Button
                    variant="ghost"
                    className="h-5 w-5 p-0 text-secondary"
                    onClick={() =>
                      check.detailsUrl
                        ? window.shipcode.invoke('shell:open-external', { url: check.detailsUrl })
                        : Promise.resolve()
                    }
                  >
                    <ExternalLink size={10} />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Review Comments */}
      {detail.unresolvedReviewComments.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 text-xs font-medium text-primary">
            Review Comments ({detail.unresolvedReviewCommentCount})
          </h3>
          <div className="space-y-2">
            {detail.unresolvedReviewComments.map((comment) => (
              <div key={comment.url} className="rounded border border-border bg-secondary/30 p-2.5">
                <div className="flex items-center gap-2 text-[11px]">
                  {comment.author && (
                    <span className="font-medium text-primary">{comment.author}</span>
                  )}
                  {comment.path && (
                    <span className="font-mono text-muted-foreground">
                      {comment.path}
                      {comment.line != null ? `:${comment.line}` : ''}
                    </span>
                  )}
                  <div className="flex-1" />
                  <Button
                    variant="ghost"
                    className="h-5 w-5 p-0 text-secondary"
                    onClick={() =>
                      window.shipcode.invoke('shell:open-external', { url: comment.url })
                    }
                  >
                    <ExternalLink size={10} />
                  </Button>
                </div>
                <p className="mt-1 line-clamp-3 text-[11px] text-secondary">{comment.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <PullRequestDetailActions
        prNumber={detail.number}
        prUrl={detail.url}
        prState={detail.state}
        hasUnresolvedComments={detail.unresolvedReviewCommentCount > 0}
      />

      {/* Linked Issues */}
      {detail.linkedIssueNumbers.length > 0 && (
        <div className="mt-4 text-[11px] text-muted-foreground">
          Linked issues: {detail.linkedIssueNumbers.map((n) => `#${n}`).join(', ')}
        </div>
      )}
    </div>
  );
}
