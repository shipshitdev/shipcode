import {
  filterAttentionRequiredNotifications,
  formatRelativeTime,
  type GitHubIssueCacheRecord,
  type NotificationKind,
  type NotificationRecord,
  type Thread,
} from '@shipcode/shared';
import { PageHeader, Tooltip, TooltipContent, TooltipTrigger } from '@shipcode/ui';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Pagination,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@shipshitdev/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, Maximize2, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NOTIFICATIONS_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';

const PAGE_SIZE = 25;

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

type RetryPipelineInput = {
  threadId: string;
  notificationId: string;
};

const KIND_BADGE_VARIANT: Record<NotificationKind, BadgeVariant> = {
  awaiting_approval: 'warning',
  failed: 'danger',
  completed: 'success',
  verification_exhausted: 'warning',
  ci_blocked: 'danger',
};

const KIND_LABEL: Record<NotificationKind, string> = {
  awaiting_approval: 'Needs approval',
  failed: 'Failed',
  completed: 'Completed',
  verification_exhausted: 'Retries exhausted',
  ci_blocked: 'CI blocked',
};

export function InboxView() {
  const queryClient = useQueryClient();
  const removeNotification = useAppStore((state) => state.removeNotification);
  const clearNotifications = useAppStore((state) => state.clearNotifications);
  const selectProject = useAppStore((state) => state.selectProject);
  const selectIssue = useAppStore((state) => state.selectIssue);

  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [showOnlyApprovalRequired, setShowOnlyApprovalRequired] = useState(false);
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
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
    staleTime: NOTIFICATIONS_STALE_TIME,
  });

  const removeNotificationFromInbox = useCallback(
    (id: string) => {
      removeNotification(id);
      queryClient.setQueryData<NotificationRecord[]>(['notifications'], (current) =>
        current ? current.filter((notification) => notification.id !== id) : current,
      );
    },
    [queryClient, removeNotification],
  );

  const active = filterAttentionRequiredNotifications(
    notifications.filter((n) => n.dismissedAt === null),
  );

  // Non-mutating sort — always derive from active, never mutate
  const sorted = [...active].sort((a, b) =>
    sortOrder === 'newest'
      ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const visibleNotifications = showOnlyApprovalRequired
    ? sorted.filter((notification) => notification.kind === 'awaiting_approval')
    : sorted;

  const totalPages = Math.max(1, Math.ceil(visibleNotifications.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = visibleNotifications.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

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

  const retryPipeline = useMutation({
    mutationFn: ({ threadId }: RetryPipelineInput) =>
      window.shipcode.invoke('pipeline:retry', { threadId }),
    onMutate: async ({ notificationId }) => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] });
      const previousNotifications = queryClient.getQueryData<NotificationRecord[]>([
        'notifications',
      ]);
      removeNotificationFromInbox(notificationId);
      return { previousNotifications };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousNotifications) {
        queryClient.setQueryData<NotificationRecord[]>(
          ['notifications'],
          context.previousNotifications,
        );
      }
    },
    onSuccess: (_result, { notificationId }) => {
      removeNotificationFromInbox(notificationId);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Reset to page 1 whenever filters or sort order change — deps are intentional triggers
  // biome-ignore lint/correctness/useExhaustiveDependencies: sortOrder and showOnlyApprovalRequired are trigger deps
  useEffect(() => {
    setPage(1);
  }, [sortOrder, showOnlyApprovalRequired]);

  useEffect(() => {
    const unsubFire = window.shipcode.on('notification:fire', () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
    const unsubDismiss = window.shipcode.on('notification:dismiss', ({ id }) => {
      removeNotificationFromInbox(id);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
    return () => {
      unsubFire();
      unsubDismiss();
    };
  }, [queryClient, removeNotificationFromInbox]);

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
        if (!match && thread?.automationId) {
          useAppStore.getState().selectAutomationThread(n.threadId);
          return;
        }
      }
      if (match) {
        selectIssue(match);
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
    <TableRow key={n.id} className="group">
      <TableCell className="w-[1%] whitespace-nowrap align-top">
        <div className="flex items-center gap-1.5">
          <Badge variant={KIND_BADGE_VARIANT[n.kind]}>{KIND_LABEL[n.kind]}</Badge>
        </div>
      </TableCell>
      <TableCell className="align-top">
        <div className="text-[13px] font-medium text-primary">{n.title}</div>
        {n.body && <div className="mt-0.5 line-clamp-2 text-[12px] text-secondary">{n.body}</div>}
      </TableCell>
      <TableCell className="w-[144px] whitespace-nowrap align-top text-right">
        <div className="relative flex min-h-7 items-start justify-end">
          <span className="pt-0.5 text-[11px] text-muted-foreground transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
            {formatRelativeTime(n.createdAt)}
          </span>
          <div className="absolute right-0 top-0 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {n.projectId !== null && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => goToIssue(n)}
                    disabled={navigatingId === n.id}
                    aria-label={`Open issue: ${n.title}`}
                  >
                    <Maximize2 size={13} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Open issue</TooltipContent>
              </Tooltip>
            )}
            {(n.kind === 'failed' || n.kind === 'verification_exhausted') && n.threadId && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() =>
                      retryPipeline.mutate({ threadId: n.threadId, notificationId: n.id })
                    }
                    disabled={
                      retryPipeline.isPending && retryPipeline.variables?.threadId === n.threadId
                    }
                    aria-label={`Retry pipeline: ${n.title}`}
                  >
                    <RefreshCw size={13} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Retry pipeline</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => dismiss.mutate(n.id)}
                  disabled={dismiss.isPending && dismiss.variables === n.id}
                  aria-label={`Dismiss notification: ${n.title}`}
                >
                  <X size={13} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Dismiss</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TableCell>
    </TableRow>
  );

  const renderTable = (rows: NotificationRecord[]) => (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableBody>{rows.map(renderRow)}</TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Inbox"
        subtitle="Notifications and items that need your attention."
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSortOrder((s) => (s === 'newest' ? 'oldest' : 'newest'))}
              className="h-7 gap-1.5 text-[11px] text-muted-foreground"
              title={sortOrder === 'newest' ? 'Showing newest first' : 'Showing oldest first'}
            >
              <ArrowUpDown size={12} />
              {sortOrder === 'newest' ? 'Newest' : 'Oldest'}
            </Button>
            <Button
              variant={showOnlyApprovalRequired ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setShowOnlyApprovalRequired((current) => !current)}
              className="h-7 text-[11px]"
              title={
                showOnlyApprovalRequired
                  ? 'Show all notifications'
                  : 'Show only notifications that need approval'
              }
            >
              Needs approval
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
          </>
        }
      />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-5xl space-y-6">
          {isLoading && (
            <div className="space-y-3 py-4">
              <Card>
                <CardContent className="p-0">
                  {Array.from({ length: 4 }, (_, i) => (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
                      key={i}
                      className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0"
                    >
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-3 w-12" />
                      <Skeleton className="h-3.5 flex-1" />
                      <Skeleton className="h-6 w-16 rounded-md" />
                    </div>
                  ))}
                </CardContent>
              </Card>
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
            <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-xs text-muted-foreground">
              All caught up. No pending notifications.
            </div>
          )}

          {!isLoading && !isError && active.length > 0 && visibleNotifications.length === 0 && (
            <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-xs text-muted-foreground">
              No notifications match the current filter.
            </div>
          )}

          {!isLoading && !isError && visibleNotifications.length > 0 && (
            <>
              {renderTable(pageItems)}
              <Pagination
                page={safePage}
                totalPages={totalPages}
                onPageChange={setPage}
                className="mt-4"
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
