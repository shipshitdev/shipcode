import { type ActivityEntry, formatRelativeTime } from '@shipcode/shared';
import { PageHeader } from '@shipcode/ui';
import {
  Button,
  Card,
  CardContent,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@shipshitdev/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/app-store';

const PAGE_SIZE = 25;

function dayLabel(isoStr: string): string {
  const date = new Date(isoStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function groupByDay(entries: ActivityEntry[]): { label: string; entries: ActivityEntry[] }[] {
  const groups: { label: string; entries: ActivityEntry[] }[] = [];
  let currentLabel: string | null = null;

  for (const entry of entries) {
    const label = dayLabel(entry.createdAt);
    if (label !== currentLabel) {
      currentLabel = label;
      groups.push({ label, entries: [] });
    }
    groups[groups.length - 1].entries.push(entry);
  }

  return groups;
}

export function ActivityView() {
  const queryClient = useQueryClient();
  const selectProject = useAppStore((state) => state.selectProject);
  const selectThread = useAppStore((state) => state.selectThread);
  const [page, setPage] = useState(1);

  const {
    data: activity = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<ActivityEntry[]>({
    queryKey: ['activity', { limit: 500 }],
    queryFn: () =>
      window.shipcode.invoke<ActivityEntry[]>('dashboard:get-activity', { limit: 500 }),
  });

  useEffect(() => {
    const unsub = window.shipcode.on('dashboard:invalidate', (data: unknown) => {
      const kinds = (data as { kinds?: string[] } | null)?.kinds;
      if (kinds?.includes('activity')) {
        queryClient.invalidateQueries({ queryKey: ['activity', { limit: 500 }] });
      }
    });
    return () => unsub();
  }, [queryClient]);

  const totalPages = Math.max(1, Math.ceil(activity.length / PAGE_SIZE));
  const pageEntries = activity.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const groups = groupByDay(pageEntries);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader title="Activity" subtitle="Timeline of all pipeline runs and agent actions." />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-5xl">
          {isLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin text-muted" />
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-sm text-secondary">Failed to load activity.</p>
              <Button variant="secondary" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          )}

          {!isLoading && !isError && activity.length === 0 && (
            <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-xs text-muted">
              No activity yet.
            </div>
          )}

          {!isLoading &&
            !isError &&
            groups.map((group) => (
              <div key={group.label} className="mb-6">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  {group.label}
                </div>
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableBody>
                        {group.entries.map((entry) => {
                          const clickable = entry.projectId !== null;

                          return (
                            <TableRow
                              key={entry.id}
                              className={clickable ? 'cursor-pointer hover:bg-hover' : undefined}
                              onClick={() => {
                                if (entry.projectId) {
                                  selectProject(entry.projectId);
                                  if (entry.threadId) selectThread(entry.threadId);
                                }
                              }}
                            >
                              <TableCell className="w-px whitespace-nowrap pr-2 align-top pt-2.5">
                                <span className="inline-flex items-center justify-center rounded border border-border bg-tertiary px-1 py-0.5 text-[9px] uppercase text-muted">
                                  {entry.actor}
                                </span>
                              </TableCell>
                              <TableCell className="max-w-0 w-full">
                                <div className="truncate text-[12px] text-primary">
                                  {entry.title}
                                </div>
                                {entry.subtitle && (
                                  <div className="truncate text-[11px] text-muted">
                                    {entry.subtitle}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="w-px whitespace-nowrap text-right text-[10px] text-muted">
                                {formatRelativeTime(entry.createdAt)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            ))}

          {!isLoading && !isError && totalPages > 1 && (
            <div className="mt-2">
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
                className="w-full"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
