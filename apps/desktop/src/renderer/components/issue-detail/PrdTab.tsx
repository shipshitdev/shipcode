import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import { Button, cn, Pencil, RefreshCw } from '@shipshitdev/ui';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PRD_PROSE_CLASSES } from './helpers';

export function PrdTab({
  activeIssue,
  expanded,
  isRefreshingFromGithub,
  onEditPrd,
  onRefreshFromGithub,
}: {
  activeIssue: GitHubIssueCacheRecord;
  expanded: boolean;
  isRefreshingFromGithub: boolean;
  onEditPrd: () => void;
  onRefreshFromGithub: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-primary">Issue brief</h3>
          <p className="mt-0.5 truncate text-[11px] text-muted">
            GitHub issue #{activeIssue.issueNumber} source content
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onRefreshFromGithub}
            disabled={isRefreshingFromGithub}
            title="Re-fetch issue from GitHub"
            aria-label="Refresh issue from GitHub"
          >
            <RefreshCw size={12} className={isRefreshingFromGithub ? 'animate-spin' : ''} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onEditPrd}
            title="Edit issue body"
            aria-label="Edit issue body"
          >
            <Pencil size={13} />
          </Button>
        </div>
      </div>

      {activeIssue.body ? (
        <div
          className={cn(
            'min-h-0 flex-1 rounded-md bg-secondary p-3 text-[13px] leading-relaxed text-primary',
            !expanded && 'overflow-y-auto',
          )}
        >
          <div className={PRD_PROSE_CLASSES}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeIssue.body}</ReactMarkdown>
          </div>
        </div>
      ) : (
        <div className="rounded-md bg-secondary p-3 text-[13px] text-muted">
          This issue has no PRD body yet. Click &quot;Edit PRD&quot; to author one.
        </div>
      )}
    </div>
  );
}
