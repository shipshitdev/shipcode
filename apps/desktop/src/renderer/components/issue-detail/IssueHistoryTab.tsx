import type { ActivityEntry } from '@shipcode/shared';
import { Badge } from '@shipshitdev/ui';
import { timeAgo } from './helpers';

export function IssueHistoryTab({
  normalizedIssueActivity,
  runNumberByThreadId,
}: {
  normalizedIssueActivity: ActivityEntry[];
  runNumberByThreadId: Record<string, number>;
}) {
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">Activity</h4>
        <span className="text-[11px] text-muted">{normalizedIssueActivity.length} events</span>
      </div>
      {normalizedIssueActivity.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-secondary/10 px-4 py-8 text-center text-[12px] text-muted">
          No issue activity yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-tertiary">
          <div className="divide-y divide-border">
            {normalizedIssueActivity.map((entry) => {
              const runNumber =
                entry.threadId && runNumberByThreadId[entry.threadId]
                  ? runNumberByThreadId[entry.threadId]
                  : null;
              return (
                <div key={entry.id} className="flex items-start gap-3 px-3 py-2.5">
                  <span className="mt-0.5 inline-flex shrink-0 items-center justify-center rounded border border-border bg-tertiary px-1.5 py-0.5 text-[9px] uppercase text-muted">
                    {entry.actor}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 text-[12px] text-primary break-words">{entry.title}</p>
                      {runNumber ? (
                        <Badge variant="default" className="text-[10px]">
                          Run {runNumber}
                        </Badge>
                      ) : null}
                    </div>
                    {entry.subtitle ? (
                      <p className="mt-0.5 text-[11px] text-muted break-words">{entry.subtitle}</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-[10px] text-muted">
                    {timeAgo(entry.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
