import type { GitHubIssueComment } from '@shipcode/shared';
import { Button, Textarea } from '@shipshitdev/ui';
import { LoadingButtonContent } from '@shipshitdev/ui/common';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PRD_PROSE_CLASSES, timeAgo } from './helpers';

export function CommentsTab({
  projectId,
  issueNumber,
  focusComposerRequestId,
}: {
  projectId: string;
  issueNumber: number;
  focusComposerRequestId?: number | null;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const {
    data: comments = [],
    isLoading,
    isRefetching,
  } = useQuery<GitHubIssueComment[]>({
    queryKey: ['issue-comments', projectId, issueNumber],
    queryFn: () => window.shipcode.invoke('github:list-comments', { projectId, issueNumber }),
    enabled: !!projectId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const refreshComments = useMutation({
    mutationFn: () =>
      window.shipcode.invoke<GitHubIssueComment[]>('github:list-comments', {
        projectId,
        issueNumber,
        force: true,
      }),
    onSuccess: (freshComments) => {
      queryClient.setQueryData(['issue-comments', projectId, issueNumber], freshComments);
    },
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

  useEffect(() => {
    if (focusComposerRequestId == null) return;
    composerRef.current?.focus();
  }, [focusComposerRequestId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">Comments</h4>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => refreshComments.mutate()}
          disabled={isRefetching || refreshComments.isPending}
          title="Refresh comments from GitHub"
          aria-label="Refresh comments"
        >
          <RefreshCw
            size={12}
            className={isRefetching || refreshComments.isPending ? 'animate-spin' : ''}
          />
        </Button>
      </div>

      {isLoading ? (
        <p className="py-4 text-center text-[13px] text-muted-foreground">Loading comments…</p>
      ) : comments.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-secondary/10 px-4 py-10 text-center">
          <div className="flex size-9 items-center justify-center rounded-full bg-muted/10">
            <MessageSquare size={18} className="text-muted-foreground/50" />
          </div>
          <p className="text-[12px] text-muted-foreground">No comments yet.</p>
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
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {timeAgo(comment.createdAt)}
                  </span>
                </div>
                <div
                  className={`text-[12px] leading-relaxed text-secondary break-words ${PRD_PROSE_CLASSES}`}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{comment.body}</ReactMarkdown>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2">
        <Textarea
          ref={composerRef}
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
            <LoadingButtonContent loading={isPosting}>Post Comment</LoadingButtonContent>
          </Button>
        </div>
      </div>
    </div>
  );
}
