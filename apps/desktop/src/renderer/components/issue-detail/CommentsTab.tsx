import type { GitHubIssueComment } from '@shipcode/shared';
import { Button, RefreshCw, Textarea } from '@shipcode/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { timeAgo } from './helpers';

export function CommentsTab({
  projectId,
  issueNumber,
}: {
  projectId: string;
  issueNumber: number;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [isPosting, setIsPosting] = useState(false);

  const {
    data: comments = [],
    isLoading,
    isRefetching,
    refetch,
  } = useQuery<GitHubIssueComment[]>({
    queryKey: ['issue-comments', projectId, issueNumber],
    queryFn: () => window.shipcode.invoke('github:list-comments', { projectId, issueNumber }),
    enabled: !!projectId,
  });

  const handlePost = async () => {
    if (!body.trim()) return;
    setIsPosting(true);
    try {
      await window.shipcode.invoke('github:add-comment', {
        projectId,
        issueNumber,
        body: body.trim(),
      });
      setBody('');
      await queryClient.invalidateQueries({
        queryKey: ['issue-comments', projectId, issueNumber],
      });
    } finally {
      setIsPosting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">Comments</h4>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => void refetch()}
          disabled={isRefetching}
          title="Refresh comments from GitHub"
          aria-label="Refresh comments"
        >
          <RefreshCw size={12} className={isRefetching ? 'animate-spin' : ''} />
        </Button>
      </div>

      {isLoading ? (
        <p className="py-4 text-center text-[13px] text-muted">Loading comments…</p>
      ) : comments.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-secondary/10 px-4 py-8 text-center text-[12px] text-muted">
          No comments yet.
        </div>
      ) : (
        <div className="mb-4 overflow-hidden rounded-md border border-border bg-secondary/20">
          <div className="divide-y divide-border">
            {comments.map((comment) => (
              <div key={comment.id} className="px-3 py-2.5">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-primary">
                    {comment.author ?? 'unknown'}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted">
                    {timeAgo(comment.createdAt)}
                  </span>
                </div>
                <p className="text-[12px] leading-relaxed text-secondary whitespace-pre-wrap break-words">
                  {comment.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write a comment…"
          rows={3}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handlePost()}
            disabled={isPosting || !body.trim()}
          >
            {isPosting ? 'Posting…' : 'Post Comment'}
          </Button>
        </div>
      </div>
    </div>
  );
}
