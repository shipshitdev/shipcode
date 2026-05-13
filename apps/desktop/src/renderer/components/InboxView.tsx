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
  cn,
  Pagination,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@shipshitdev/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, Ban, Loader2, Maximize2 } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { NOTIFICATIONS_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';

const PAGE_SIZE = 25;
const INBOX_LOADING_ROW_KEYS = [
  'inbox-loading-1',
  'inbox-loading-2',
  'inbox-loading-3',
  'inbox-loading-4',
];

const RETRY_BADGE_CLASS =
  'inline-flex items-center justify-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide border-danger/30 bg-danger/15 text-danger hover:border-danger/40 hover:bg-danger/20 hover:text-danger';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

type RetryPipelineInput = {
  threadId: string;
  notificationId: string;
};

const KIND_BADGE_VARIANT: Record<NotificationKind, BadgeVariant> = {
  approval: 'warning',
  failed: 'danger',
  completed: 'success',
  verification_exhausted: 'warning',
  ci_blocked: 'danger',
};

const KIND_LABEL: Record<NotificationKind, string> = {
  approval: 'Needs approval',
  failed: 'Failed',
  completed: 'Completed',
  verification_exhausted: 'Retries exhausted',
  ci_blocked: 'CI blocked',
};

function NotificationTable({
  rows,
  renderRow,
}: {
  rows: NotificationRecord[];
  renderRow: (notification: NotificationRecord) => React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableBody className="[&_tr:last-child]:border-0">{rows.map(renderRow)}</TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function useInboxView() {
  const queryClient = useQueryClient();
  const removeNotification = useAppStore((state) => state.removeNotification);
  const clearNotifications = useAppStore((state) => state.clearNotifications);
  const selectProject = useAppStore((state) => state.selectProject);
  const selectIssue = useAppStore((state) => state.selectIssue);

  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [showOnlyApprovalRequired, setShowOnlyApprovalRequired] = useState(false);
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  const pageScopeKey = `${sortOrder}:${showOnlyApprovalRequired ? 'approval' : 'all'}`;
  const [pageState, setPageState] = useState({ key: pageScopeKey, page: 1 });
  const page = pageState.key === pageScopeKey ? pageState.page : 1;
  const setCurrentPage = (nextPage: number) => {
    setPageState({ key: pageScopeKey, page: nextPage });
  };
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
  const removeNotificationFromInboxEvent = useEffectEvent(removeNotificationFromInbox);

  const active = filterAttentionRequiredNotifications(
    notifications.filter((n) => n.dismissedAt === null),
  );

  const sorted = active.toSorted((a, b) =>
    sortOrder === 'newest'
      ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const visibleNotifications = showOnlyApprovalRequired
    ? sorted.filter((notification) => notification.kind === 'approval')
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

  useEffect(() => {
    const unsubFire = window.shipcode.on('notification:fire', () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
    const unsubDismiss = window.shipcode.on('notification:dismiss', ({ id }) => {
      removeNotificationFromInboxEvent(id);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
    return () => {
      unsubFire();
      unsubDismiss();
    };
  }, [queryClient]);

  const goToIssue = async (n: NotificationRecord) => {
    if (!n.projectId) return;
    const token = n.id;
    navTokenRef.current = token;
    setNavigatingId(n.id);
    const priorProjectId = useAppStore.getState().activeProjectId;
    try {
      selectProject(n.projectId);
      useAppStore.getState().setViewMode('inbox');
      if (!n.threadId) return;
      const issues = await window.shipcode.invoke<GitHubIssueCacheRecord[]>('github:list-issues', {
        projectId: n.projectId,
      });
      if (navTokenRef.current !== token) return;
      useAppStore.getState().setGithubIssues(issues);
      let match = issues.find((i) => i.threadId === n.threadId) ?? null;
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
        <button
          type="button"
          className="text-left text-[13px] font-medium text-primary hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-default"
          onClick={() => goToIssue(n)}
          disabled={navigatingId === n.id}
          aria-label={`Open issue detail: ${n.title}`}
        >
          {n.title}
        </button>
        {n.body && <div className="mt-0.5 line-clamp-2 text-[12px] text-secondary">{n.body}</div>}
      </TableCell>
      <TableCell className="w-[144px] whitespace-nowrap align-top text-right">
        <div className="relative flex min-h-7 items-start justify-end">
          <span className="pt-0.5 text-[11px] text-muted-foreground transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
            {formatRelativeTime(n.createdAt)}
          </span>
          <div className="absolute right-0 top-0 flex items-center justify-end gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {n.projectId !== null && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    onClick={() => goToIssue(n)}
                    disabled={navigatingId === n.id}
                    aria-label={`Open detail: ${n.title}`}
                  >
                    <Maximize2 size={14} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Open detail</TooltipContent>
              </Tooltip>
            )}
            {(n.kind === 'failed' || n.kind === 'verification_exhausted') && n.threadId && (
              <Button
                variant="ghost"
                size="xs"
                className={cn(RETRY_BADGE_CLASS)}
                onClick={() => retryPipeline.mutate({ threadId: n.threadId, notificationId: n.id })}
                disabled={
                  retryPipeline.isPending && retryPipeline.variables?.threadId === n.threadId
                }
                aria-label={`Retry pipeline: ${n.title}`}
                title="Retry pipeline"
              >
                {retryPipeline.isPending && retryPipeline.variables?.threadId === n.threadId ? (
                  <>
                    <Loader2 size={10} className="animate-spin" />
                    RETRY
                  </>
                ) : (
                  'RETRY'
                )}
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => dismiss.mutate(n.id)}
                  disabled={dismiss.isPending && dismiss.variables === n.id}
                  aria-label={`Dismiss notification: ${n.title}`}
                >
                  <Ban size={13} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Dismiss</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TableCell>
    </TableRow>
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
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl space-y-6">
          {isLoading && (
            <div className="space-y-3 py-4">
              <Card>
                <CardContent className="p-0">
                  {INBOX_LOADING_ROW_KEYS.map((key) => (
                    <div
                      key={key}
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
              <NotificationTable rows={pageItems} renderRow={renderRow} />
              <Pagination
                page={safePage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                className="mt-4"
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function InboxView() {
  return useInboxView();
}
