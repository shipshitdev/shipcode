import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { NotificationRecord, NotificationKind } from '@shipcode/shared';
import { Button, Loader2, Layers, ArrowUpDown } from '@shipcode/ui';
import { useAppStore } from '../stores/app-store';

function timeAgo(input: string | number): string {
  const t = typeof input === 'number' ? input : new Date(input).getTime();
  const diff = Math.max(0, Date.now() - t);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const KIND_BADGE: Record<NotificationKind, string> = {
  awaiting_approval: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  failed: 'bg-danger/15 text-danger border-danger/30',
  completed: 'bg-success/15 text-success border-success/30',
  verification_exhausted: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
};

const KIND_LABEL: Record<NotificationKind, string> = {
  awaiting_approval: 'Awaiting approval',
  failed: 'Failed',
  completed: 'Completed',
  verification_exhausted: 'Retries exhausted',
};

const GROUP_SECTION_LABEL: Record<NotificationKind, string> = {
  awaiting_approval: 'Awaiting Approval',
  failed: 'Failed',
  verification_exhausted: 'Retries Exhausted',
  completed: 'Completed',
};

const GROUP_SECTION_COLOR: Record<NotificationKind, string> = {
  awaiting_approval: 'text-amber-400',
  failed: 'text-danger',
  verification_exhausted: 'text-orange-400',
  completed: 'text-success',
};

// Priority order for group sections
const GROUP_ORDER: NotificationKind[] = [
  'awaiting_approval',
  'failed',
  'verification_exhausted',
  'completed',
];

export function InboxView() {
  const queryClient = useQueryClient();
  const { removeNotification, clearNotifications, selectProject, selectThread } = useAppStore();

  const [groupBy, setGroupBy] = useState<'none' | 'kind'>('none');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

  const {
    data: notifications = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<NotificationRecord[]>({
    queryKey: ['notifications'],
    queryFn: () => window.shipcode.invoke<NotificationRecord[]>('notification:list'),
    refetchInterval: 5000,
  });

  const active = notifications.filter((n) => n.dismissedAt === null);

  // Non-mutating sort — always derive from active, never mutate
  const sorted = [...active].sort((a, b) =>
    sortOrder === 'newest'
      ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const dismiss = useMutation({
    mutationFn: (id: string) => window.shipcode.invoke('notification:dismiss', { id }),
    onSuccess: (_, id) => {
      removeNotification(id);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const dismissAll = useMutation({
    mutationFn: () => window.shipcode.invoke('notification:dismiss-all'),
    onSuccess: () => {
      clearNotifications();
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  useEffect(() => {
    const unsub = window.shipcode.on('notification:fire', () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
    return () => unsub();
  }, [queryClient]);

  const renderNotification = (n: NotificationRecord) => (
    <li key={n.id} className="rounded-lg border border-border bg-elevated p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${KIND_BADGE[n.kind]}`}
          >
            {KIND_LABEL[n.kind]}
          </span>
          <span className="text-[13px] font-medium text-primary">{n.title}</span>
        </div>
        <span className="shrink-0 text-[10px] text-muted">{timeAgo(n.createdAt)}</span>
      </div>

      {n.body && <p className="mt-2 text-[12px] text-secondary">{n.body}</p>}

      <div className="mt-3 flex items-center gap-2">
        {n.projectId !== null && (
          <Button
            variant="secondary"
            size="xs"
            onClick={() => {
              selectProject(n.projectId!);
              if (n.threadId) selectThread(n.threadId);
            }}
          >
            → Go to issue
          </Button>
        )}
        <Button
          variant="ghost"
          size="xs"
          onClick={() => dismiss.mutate(n.id)}
          disabled={dismiss.isPending && dismiss.variables === n.id}
        >
          Dismiss
        </Button>
      </div>
    </li>
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-base font-semibold text-primary">Inbox</h1>
          <p className="text-xs text-muted">Notifications requiring attention.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setGroupBy((g) => (g === 'none' ? 'kind' : 'none'))}
            className={`h-7 gap-1.5 text-[11px] ${groupBy === 'kind' ? 'text-primary bg-hover' : 'text-muted'}`}
            title={groupBy === 'kind' ? 'Ungroup' : 'Group by kind'}
          >
            <Layers size={12} />
            Group
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSortOrder((s) => (s === 'newest' ? 'oldest' : 'newest'))}
            className="h-7 gap-1.5 text-[11px] text-muted"
            title={sortOrder === 'newest' ? 'Showing newest first' : 'Showing oldest first'}
          >
            <ArrowUpDown size={12} />
            {sortOrder === 'newest' ? 'Newest' : 'Oldest'}
          </Button>
          {active.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => dismissAll.mutate()}
              disabled={dismissAll.isPending}
            >
              Dismiss all
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl">
          {isLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin text-muted" />
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-sm text-secondary">Failed to load notifications.</p>
              <Button variant="secondary" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          )}

          {!isLoading && !isError && active.length === 0 && (
            <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-xs text-muted">
              All caught up. No pending notifications.
            </div>
          )}

          {!isLoading && !isError && active.length > 0 && groupBy === 'none' && (
            <ul className="space-y-3">{sorted.map(renderNotification)}</ul>
          )}

          {!isLoading && !isError && active.length > 0 && groupBy === 'kind' && (
            <div className="space-y-6">
              {GROUP_ORDER.map((kind) => {
                const items = sorted.filter((n) => n.kind === kind);
                if (items.length === 0) return null;
                return (
                  <div key={kind}>
                    <div
                      className={`mb-2 text-[10px] font-semibold uppercase tracking-wider ${GROUP_SECTION_COLOR[kind]}`}
                    >
                      {GROUP_SECTION_LABEL[kind]} · {items.length}
                    </div>
                    <ul className="space-y-3">{items.map(renderNotification)}</ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
