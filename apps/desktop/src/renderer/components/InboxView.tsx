import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  filterAttentionRequiredNotifications,
  type GitHubIssueCacheRecord,
  type NotificationKind,
  type NotificationRecord,
  type Thread,
} from '@shipcode/shared';
import {
  ArrowUpDown,
  Badge,
  Button,
  Card,
  CardContent,
  Loader2,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  X,
} from '@shipcode/ui';
import { useAppStore } from '../stores/app-store';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

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

const KIND_BADGE_VARIANT: Record<NotificationKind, BadgeVariant> = {
  awaiting_approval: 'warning',
  failed: 'danger',
  completed: 'success',
  verification_exhausted: 'warning',
};

const KIND_LABEL: Record<NotificationKind, string> = {
  awaiting_approval: 'Awaiting approval',
  failed: 'Failed',
  completed: 'Completed',
  verification_exhausted: 'Retries exhausted',
};

export function InboxView() {
  const queryClient = useQueryClient();
  const { removeNotification, clearNotifications, selectProject, selectIssue } = useAppStore();

  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  // Stale-navigation guard: each click gets a token; async results are discarded
  // if a newer click (or user navigation) has since taken over.
  const navTokenRef = useRef<string | null>(null);

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

  const active = filterAttentionRequiredNotifications(
    notifications.filter((n) => n.dismissedAt === null),
  );

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

  // Switch project, fetch its issues, locate the one linked to the notification's
  // threadId, then open the IssueDetail sidebar via selectIssue. Without the
  // issue lookup, selectThread alone lands the user on the Kanban view without
  // the detail panel.
  //
  // Stale-result guard: rapid multi-clicks or mid-flight project switches can
  // cause an older IPC response to overwrite the current selection. Each click
  // mints a new token; any response whose token no longer matches navTokenRef
  // is silently dropped. On IPC failure the prior project is restored so the
  // user is not left stranded on a switched-but-empty project.
  const goToIssue = async (n: NotificationRecord) => {
    if (!n.projectId) return;
    const token = n.id;
    navTokenRef.current = token;
    setNavigatingId(n.id);
    const priorProjectId = useAppStore.getState().activeProjectId;
    try {
      selectProject(n.projectId);
      // selectProject resets viewMode to 'project' — restore inbox so the
      // IssueDetail sidebar opens alongside the inbox, not the Kanban board.
      useAppStore.getState().setViewMode('inbox');
      if (!n.threadId) return;
      const issues = await window.shipcode.invoke<GitHubIssueCacheRecord[]>('github:list-issues', {
        projectId: n.projectId,
      });
      if (navTokenRef.current !== token) return;
      useAppStore.getState().setGithubIssues(issues);
      let match = issues.find((i) => i.threadId === n.threadId) ?? null;
      // Fallback: notification may reference an old thread (e.g. the issue was
      // retried and now has a different threadId). Look up the thread to get
      // its githubIssueNumber, then find the issue by number instead.
      if (!match) {
        const thread = await window.shipcode.invoke<Thread | null>('thread:get', {
          threadId: n.threadId,
        });
        if (navTokenRef.current !== token) return;
        if (thread?.githubIssueNumber) {
          match = issues.find((i) => i.issueNumber === thread.githubIssueNumber) ?? null;
        }
      }
      if (match) {
        selectIssue(match);
        // If the detail panel was previously collapsed, un-collapse it so the
        // user actually sees the issue after clicking View.
        const store = useAppStore.getState();
        if (store.issueDetailCollapsed) store.toggleIssueDetail();
      }
    } catch {
      if (navTokenRef.current === token) {
        selectProject(priorProjectId);
        useAppStore.getState().setViewMode('inbox');
      }
    } finally {
      if (navTokenRef.current === token) setNavigatingId(null);
    }
  };

  const renderRow = (n: NotificationRecord) => (
    <TableRow key={n.id}>
      <TableCell className="w-[1%] whitespace-nowrap align-top">
        <Badge variant={KIND_BADGE_VARIANT[n.kind]}>{KIND_LABEL[n.kind]}</Badge>
      </TableCell>
      <TableCell className="w-[1%] whitespace-nowrap align-top text-[11px] text-muted">
        {timeAgo(n.createdAt)}
      </TableCell>
      <TableCell className="align-top">
        <div className="text-[13px] font-medium text-primary">{n.title}</div>
        {n.body && (
          <div className="mt-0.5 line-clamp-2 text-[12px] text-secondary">{n.body}</div>
        )}
      </TableCell>
      <TableCell className="w-[1%] whitespace-nowrap align-top text-right">
        <div className="flex items-center justify-end gap-1">
          {n.projectId !== null && (
            <Button
              variant="ghost"
              className="h-5 px-1.5 text-[10px] font-medium text-muted hover:text-primary hover:bg-elevated"
              onClick={() => goToIssue(n)}
              disabled={navigatingId === n.id}
              title="Open issue"
              aria-label={`Open issue: ${n.title}`}
            >
              View
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => dismiss.mutate(n.id)}
            disabled={dismiss.isPending && dismiss.variables === n.id}
            title="Dismiss"
            aria-label={`Dismiss notification: ${n.title}`}
          >
            <X size={14} />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );

  const renderTable = (rows: NotificationRecord[]) => (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Notification</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{rows.map(renderRow)}</TableBody>
        </Table>
      </CardContent>
    </Card>
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
              Read all
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-5xl space-y-6">
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

          {!isLoading && !isError && active.length > 0 && renderTable(sorted)}
        </div>
      </div>
    </div>
  );
}
