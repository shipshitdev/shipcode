import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import { Button, ChevronDown, ChevronUp, cn, Pencil, RefreshCw } from '@shipcode/ui';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PRD_PROSE_CLASSES } from './helpers';

export function PrdTab({
  activeIssue,
  expanded,
  prdCollapsed,
  isRefreshingFromGithub,
  onEditPrd,
  onPrdCollapsedChange,
  onRefreshFromGithub,
}: {
  activeIssue: GitHubIssueCacheRecord;
  expanded: boolean;
  prdCollapsed: boolean;
  isRefreshingFromGithub: boolean;
  onEditPrd: () => void;
  onPrdCollapsedChange: (collapsed: boolean) => void;
  onRefreshFromGithub: () => void;
}) {
  const prdCollapseLabel = prdCollapsed ? 'Expand PRD' : 'Collapse PRD';

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center text-left"
          onClick={() => onPrdCollapsedChange(!prdCollapsed)}
          title={prdCollapseLabel}
          aria-label={prdCollapseLabel}
        >
          <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">PRD</h4>
        </button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={(event) => {
              event.stopPropagation();
              onRefreshFromGithub();
            }}
            disabled={isRefreshingFromGithub}
            title="Re-fetch issue body from GitHub"
            aria-label="Refresh PRD from GitHub"
          >
            <RefreshCw size={12} className={isRefreshingFromGithub ? 'animate-spin' : ''} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={(event) => {
              event.stopPropagation();
              onEditPrd();
            }}
            title="Edit the PRD body"
            aria-label="Edit PRD"
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={(event) => {
              event.stopPropagation();
              onPrdCollapsedChange(!prdCollapsed);
            }}
            title={prdCollapseLabel}
            aria-label={prdCollapseLabel}
          >
            {prdCollapsed ? (
              <ChevronDown size={16} strokeWidth={2.25} className="text-muted" />
            ) : (
              <ChevronUp size={16} strokeWidth={2.25} className="text-muted" />
            )}
          </Button>
        </div>
      </div>
      {!prdCollapsed &&
        (activeIssue.body ? (
          <div
            className={cn(
              'rounded-md bg-secondary p-3 text-[13px] leading-relaxed text-primary',
              !expanded && 'max-h-[300px] overflow-y-auto',
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
        ))}
    </div>
  );
}
