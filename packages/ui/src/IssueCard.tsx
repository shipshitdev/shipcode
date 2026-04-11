import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import { getStatusBadgeVariant } from './lib/status-variant';
import { Badge } from './primitives/badge';

function ActiveDot() {
  return <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse" />;
}

interface IssueCardProps {
  issue: GitHubIssueCacheRecord;
  onClick: () => void;
}

export function IssueCard({ issue, onClick }: IssueCardProps) {
  return (
    <button
      type="button"
      className="w-full text-left rounded-md border border-border bg-primary p-3 cursor-pointer hover:border-text-muted transition-colors"
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted font-mono">#{issue.issueNumber}</span>
        <Badge variant={getStatusBadgeVariant(issue.pipelineStatus)}>
          {getStatusBadgeVariant(issue.pipelineStatus) === 'accent' && <ActiveDot />}
          {issue.pipelineStatus}
        </Badge>
      </div>
      <div className="text-[13px] font-medium text-primary mt-1">{issue.title}</div>
      <div className="flex flex-wrap gap-1 mt-2">
        {issue.labels
          .filter((l) => l.startsWith('agent:'))
          .map((l) => (
            <Badge key={l} variant="accent">
              {l}
            </Badge>
          ))}
      </div>
    </button>
  );
}
