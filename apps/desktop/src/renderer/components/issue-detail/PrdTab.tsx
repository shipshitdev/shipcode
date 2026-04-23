import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import { cn } from '@shipshitdev/ui';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PRD_PROSE_CLASSES } from './helpers';

export function PrdTab({
  activeIssue,
  expanded,
}: {
  activeIssue: GitHubIssueCacheRecord;
  expanded: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
