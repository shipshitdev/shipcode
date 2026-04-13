import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import { Button, cn, Pencil, RefreshCw } from '@shipcode/ui';
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onRefreshFromGithub}
          disabled={isRefreshingFromGithub}
          title="Re-fetch issue body from GitHub"
          aria-label="Refresh PRD from GitHub"
        >
          <RefreshCw size={12} className={isRefreshingFromGithub ? 'animate-spin' : ''} />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onEditPrd}
          title="Edit the PRD body"
          aria-label="Edit PRD"
        >
          <Pencil size={13} />
        </Button>
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
