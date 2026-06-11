import type { ReviewFindingRecord, ReviewFindingStatus } from '@shipcode/shared';
import { clampError } from '@shipcode/shared';
import { Badge, Button, cn } from '@shipshitdev/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, CircleSlash, FileText } from 'lucide-react';
import { toast } from '../../stores/toast-store';
import { formatTimestamp } from '../format-timestamp';

const SEVERITY_CLASS: Record<string, string> = {
  critical: 'bg-danger/15 text-danger',
  blocker: 'bg-danger/15 text-danger',
  major: 'bg-warning/15 text-warning',
  warning: 'bg-warning/15 text-warning',
  minor: 'bg-accent/15 text-accent',
  nit: 'bg-muted text-muted-foreground',
};

function statusLabel(status: ReviewFindingStatus): string {
  if (status === 'open') return 'Open';
  if (status === 'fixed') return 'Fixed';
  if (status === 'ignored') return 'Ignored';
  if (status === 'superseded') return 'Superseded';
  return 'Closed';
}

export function FindingsTab({
  threadId,
  findings,
}: {
  threadId: string | null;
  findings: ReviewFindingRecord[];
}) {
  const queryClient = useQueryClient();
  const updateStatus = useMutation({
    mutationFn: (input: { findingId: string; status: Exclude<ReviewFindingStatus, 'open'> }) =>
      window.shipcode.invoke('review-findings:update-status', input),
    onSuccess: () => {
      if (threadId) queryClient.invalidateQueries({ queryKey: ['review-findings', threadId] });
    },
    onError: (error) => toast.error('Failed to update finding', clampError(error)),
  });

  if (!threadId) {
    return <p className="text-sm text-muted-foreground">No pipeline run is linked yet.</p>;
  }

  if (findings.length === 0) {
    return <p className="text-sm text-muted-foreground">No review findings recorded.</p>;
  }

  const openCount = findings.filter((finding) => finding.status === 'open').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-primary">
          {openCount} open / {findings.length} total
        </div>
      </div>

      <div className="space-y-3">
        {findings.map((finding) => (
          <article
            key={finding.id}
            className={cn(
              'rounded-md border border-border bg-secondary p-3',
              finding.status !== 'open' && 'opacity-70',
            )}
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge className={cn('text-[10px] uppercase', SEVERITY_CLASS[finding.severity])}>
                {finding.severity}
              </Badge>
              <Badge
                variant={finding.status === 'open' ? 'warning' : 'default'}
                className="text-[10px]"
              >
                {statusLabel(finding.status)}
              </Badge>
              <span className="text-[11px] text-muted-foreground">{finding.source}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">
                {formatTimestamp(finding.updatedAt)}
              </span>
            </div>

            <h4 className="text-sm font-medium text-primary">{finding.title}</h4>
            <p className="mt-1 whitespace-pre-wrap text-sm text-secondary">{finding.description}</p>

            {finding.suggestion ? (
              <p className="mt-2 whitespace-pre-wrap border-l border-border pl-3 text-xs text-muted-foreground">
                {finding.suggestion}
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {finding.filePath ? (
                <span className="inline-flex min-w-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  <FileText className="size-3 shrink-0" />
                  <span className="truncate">{finding.filePath}</span>
                </span>
              ) : null}
              {finding.status === 'open' ? (
                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      updateStatus.mutate({ findingId: finding.id, status: 'ignored' })
                    }
                    disabled={updateStatus.isPending}
                  >
                    <CircleSlash className="size-3" />
                    Ignore
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    onClick={() => updateStatus.mutate({ findingId: finding.id, status: 'fixed' })}
                    disabled={updateStatus.isPending}
                  >
                    <Check className="size-3" />
                    Fixed
                  </Button>
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
