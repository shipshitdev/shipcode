import type { DiffRecord, PipelinePhase, PlanRecord, ReviewRecord, Thread } from '@shipcode/shared';
import {
  clampError,
  formatCost,
  formatTokenCount,
  githubCompareUrl,
  PIPELINE_PHASE,
} from '@shipcode/shared';
import { PhaseChip } from '@shipcode/ui';
import { Badge, Button, cn, Tabs, TabsContent, TabsList, TabsTrigger } from '@shipshitdev/ui';
import { LoadingButtonContent } from '@shipshitdev/ui/common';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Pencil,
  Play,
  RefreshCw,
  Square,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AutomationPromptMarkdown } from '../features/automations/automation-prompt-markdown';
import {
  describeAutomationRun,
  getAutomationRunTotalTokens,
} from '../features/automations/run-presentation';
import { useAppStore } from '../stores/app-store';
import { formatTimestamp } from './format-timestamp';
import { ApprovalSection } from './issue-detail/ApprovalSection';
import { DiffTab } from './issue-detail/DiffTab';
import { ACTIVE_PHASES } from './issue-detail/helpers';
import { PlanHistoryTab } from './issue-detail/PlanHistoryTab';
import type { PlanRunGroup } from './issue-detail/tab-types';

const SHORT_TIMESTAMP_FORMAT = {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
} satisfies Intl.DateTimeFormatOptions;

function useAutomationRunDetailView() {
  const threadId = useAppStore((s) => s.activeAutomationThreadId);
  const selectAutomationThread = useAppStore((s) => s.selectAutomationThread);
  const navigateToGitWorktree = useAppStore((s) => s.navigateToGitWorktree);
  const openCreateAutomationModal = useAppStore((s) => s.openCreateAutomationModal);
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'run' | 'plans' | 'diff' | 'history'>('run');
  const [expandedPlanId, setExpandedPlanId] = useState<string | null | undefined>(null);
  const [planHistoryCollapsed, setPlanHistoryCollapsed] = useState(false);
  const [copiedBranch, setCopiedBranch] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  const { data: thread } = useQuery<Thread | null>({
    queryKey: ['thread', threadId],
    queryFn: () => {
      if (!threadId) throw new Error('Missing thread id');
      return window.shipcode.invoke<Thread | null>('thread:get', { threadId });
    },
    enabled: !!threadId,
    refetchInterval: (query) => {
      const t = query.state.data;
      if (!t) return false;
      if (ACTIVE_PHASES.includes(t.status as PipelinePhase)) return 5_000;
      if (t.status === PIPELINE_PHASE.approval) return 5_000;
      return false;
    },
  });

  const isActive = !!thread && ACTIVE_PHASES.includes(thread.status as PipelinePhase);
  const isPaused = thread?.status === PIPELINE_PHASE.paused;

  const { data: plans = [], isLoading: isPlanHistoryLoading } = useQuery<PlanRecord[]>({
    queryKey: ['plan-history-automation', threadId],
    queryFn: () => {
      if (!threadId) throw new Error('Missing thread id');
      return window.shipcode.invoke<PlanRecord[]>('plan:list', { threadId });
    },
    enabled: !!threadId,
  });

  const planIds = useMemo(() => plans.map((p) => p.id), [plans]);
  const { data: reviewsByPlanId = {} } = useQuery<Record<string, ReviewRecord>>({
    queryKey: ['reviews-by-plans-automation', planIds],
    queryFn: () =>
      window.shipcode.invoke<Record<string, ReviewRecord>>('review:list-by-plans', {
        planIds,
      }),
    enabled: planIds.length > 0,
  });

  const { data: diffs = [] } = useQuery<DiffRecord[]>({
    queryKey: ['diffs-automation', threadId],
    queryFn: () => {
      if (!threadId) throw new Error('Missing thread id');
      return window.shipcode.invoke<DiffRecord[]>('diff:list', { threadId });
    },
    enabled: !!threadId,
  });

  const automationId = thread?.automationId ?? null;
  const { data: runHistory = [] } = useQuery<Thread[]>({
    queryKey: ['automation-run-history', automationId],
    queryFn: () =>
      window.shipcode.invoke<Thread[]>('automations:run-history', {
        automationId: automationId as string,
      }),
    enabled: !!automationId,
  });

  const planRunGroups: PlanRunGroup[] = useMemo(() => {
    if (!threadId || plans.length === 0) return [];
    return [{ threadId, plans, runNumber: 1, isCurrentRun: true }];
  }, [threadId, plans]);

  // Approval derived state
  const latestPlan = plans[0] ?? null;
  const threadPhase = thread?.status;
  const approvedAwaitingExecution =
    threadPhase === PIPELINE_PHASE.approval && latestPlan?.status === 'approved';
  const hasApprovalDecision =
    threadPhase === PIPELINE_PHASE.approval && !!latestPlan && latestPlan.status !== 'approved';
  const canApprove = hasApprovalDecision && !!(latestPlan?.structured || latestPlan?.rawOutput);

  const handleClose = useCallback(() => selectAutomationThread(null), [selectAutomationThread]);

  const handleCancel = useCallback(async () => {
    if (!threadId) return;
    setIsSubmitting(true);
    try {
      await window.shipcode.invoke('pipeline:cancel', { threadId });
      queryClient.invalidateQueries({ queryKey: ['thread', threadId] });
    } finally {
      setIsSubmitting(false);
    }
  }, [threadId, queryClient]);

  const handlePause = useCallback(async () => {
    if (!threadId) return;
    setIsSubmitting(true);
    try {
      await window.shipcode.invoke('pipeline:pause', { threadId });
      queryClient.invalidateQueries({ queryKey: ['thread', threadId] });
      if (thread?.projectId) {
        queryClient.invalidateQueries({ queryKey: ['thread-panel-data', thread.projectId] });
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [threadId, thread?.projectId, queryClient]);

  const handleResume = useCallback(async () => {
    if (!threadId) return;
    setIsSubmitting(true);
    try {
      await window.shipcode.invoke('pipeline:resume', { threadId });
      queryClient.invalidateQueries({ queryKey: ['thread', threadId] });
      if (thread?.projectId) {
        queryClient.invalidateQueries({ queryKey: ['thread-panel-data', thread.projectId] });
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [threadId, thread?.projectId, queryClient]);

  const handleRetry = useCallback(async () => {
    if (!threadId) return;
    await window.shipcode.invoke('pipeline:retry', { threadId });
    queryClient.invalidateQueries({ queryKey: ['thread', threadId] });
  }, [threadId, queryClient]);

  const handleApprove = useCallback(async () => {
    if (!threadId || !canApprove) return;
    setIsSubmitting(true);
    setApproveError(null);
    try {
      await window.shipcode.invoke('pipeline:approve', { threadId });
      queryClient.invalidateQueries({ queryKey: ['thread', threadId] });
      queryClient.invalidateQueries({ queryKey: ['plan-history-automation', threadId] });
    } catch (err) {
      setApproveError(clampError(err));
    } finally {
      setIsSubmitting(false);
    }
  }, [threadId, canApprove, queryClient]);

  const handleReject = useCallback(
    async (feedback: string) => {
      const trimmed = feedback.trim();
      if (!threadId || !trimmed) return;
      setIsSubmitting(true);
      try {
        await window.shipcode.invoke('pipeline:reject', { threadId, feedback: trimmed });
        queryClient.invalidateQueries({ queryKey: ['thread', threadId] });
        queryClient.invalidateQueries({ queryKey: ['plan-history-automation', threadId] });
      } finally {
        setIsSubmitting(false);
      }
    },
    [threadId, queryClient],
  );

  const handleMarkAsDone = useCallback(async () => {
    if (!threadId) return;
    setIsSubmitting(true);
    try {
      await window.shipcode.invoke('thread:mark-done', { threadId });
      queryClient.invalidateQueries({ queryKey: ['thread', threadId] });
      if (thread?.projectId) {
        queryClient.invalidateQueries({ queryKey: ['thread-panel-data', thread.projectId] });
      }
      if (thread?.automationId) {
        queryClient.invalidateQueries({
          queryKey: ['automation-run-history', thread.automationId],
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [threadId, thread?.projectId, thread?.automationId, queryClient]);

  const handleCopyBranch = useCallback((branch: string) => {
    navigator.clipboard.writeText(branch);
    setCopiedBranch(true);
    setTimeout(() => setCopiedBranch(false), 1500);
  }, []);

  const createPr = useMutation({
    mutationFn: (tid: string) =>
      window.shipcode.invoke<{ prNumber: number; prUrl: string }>('pipeline:create-pr', {
        threadId: tid,
      }),
    onSuccess: (_data, tid) => {
      queryClient.invalidateQueries({ queryKey: ['thread', tid] });
    },
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleClose]);

  if (!threadId) return null;

  const totalTokens = thread ? getAutomationRunTotalTokens(thread) : 0;
  const isFailed =
    thread?.status === PIPELINE_PHASE.failed || thread?.status === PIPELINE_PHASE.idle;
  const isCompleted = thread?.status === PIPELINE_PHASE.completed;
  const isClosed = !!thread?.doneAt;
  const canClose = (isFailed || isCompleted) && !isClosed;
  const hasError = !!thread?.lastError;

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleClose}
          aria-label="Back to board"
          className="size-6 rounded p-0.5 text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-primary">
          {thread?.title ?? 'Automation run'}
        </h3>
        {thread && <PhaseChip status={thread.status} />}
        {isActive && (
          <Button
            variant="outline"
            size="icon"
            className="size-6 text-warning hover:bg-warning/10"
            title="Pause task"
            aria-label="Pause task"
            onClick={handlePause}
            disabled={isSubmitting}
          >
            <Square className="size-3" />
          </Button>
        )}
        {isPaused && (
          <Button
            variant="outline"
            size="icon"
            className="size-6 text-agent hover:bg-agent/10"
            title="Resume task"
            aria-label="Resume task"
            onClick={handleResume}
            disabled={isSubmitting}
          >
            <Play className="size-3" />
          </Button>
        )}
        {isFailed && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px]"
            onClick={handleRetry}
          >
            <RefreshCw className="size-3" />
            Retry
          </Button>
        )}
        {canClose && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px] border-purple-500/40 text-purple-400 hover:border-purple-500 hover:bg-purple-500/10"
            onClick={handleMarkAsDone}
            disabled={isSubmitting}
          >
            <CheckCircle2 className="size-3" />
            {isSubmitting ? 'Closing...' : 'Close'}
          </Button>
        )}
      </div>

      {/* Error banner */}
      {hasError && isFailed && (
        <div className="shrink-0 border-b border-border bg-destructive/10 px-4 py-2.5">
          {thread.failurePhase && (
            <span className="text-[10px] font-medium uppercase tracking-wider text-destructive/70">
              Failed in {thread.failurePhase}
            </span>
          )}
          <p className="mt-0.5 text-xs text-destructive">{thread.lastError}</p>
        </div>
      )}

      {/* Approval section */}
      {hasApprovalDecision && (
        <div className="shrink-0 border-b border-border px-4 py-3">
          <ApprovalSection
            key={threadId ?? 'approval'}
            approveError={approveError}
            canApprove={canApprove}
            isSubmitting={isSubmitting}
            onApprove={handleApprove}
            onCancel={handleCancel}
            onReject={handleReject}
          />
        </div>
      )}
      {approvedAwaitingExecution && (
        <div className="shrink-0 border-b border-border px-4 py-3">
          <div className="rounded-md border border-border bg-secondary p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="success" className="text-[10px]">
                    Approved
                  </Badge>
                  <Badge variant="warning" className="text-[10px]">
                    Waiting
                  </Badge>
                </div>
                <p className="text-[12px] leading-relaxed text-secondary">
                  Approval is confirmed. Execution starts when current slot frees up.
                </p>
              </div>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleCancel}
                disabled={isSubmitting}
              >
                <LoadingButtonContent loading={isSubmitting}>Cancel</LoadingButtonContent>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Body: two-column */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left: tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as 'run' | 'plans' | 'diff' | 'history')}
          className="flex min-w-0 flex-1 flex-col overflow-hidden"
        >
          <TabsList className="shrink-0 border-b border-border px-4">
            <TabsTrigger value="run">Run</TabsTrigger>
            {plans.length > 0 && <TabsTrigger value="plans">Plans ({plans.length})</TabsTrigger>}
            {diffs.length > 0 && <TabsTrigger value="diff">Diff ({diffs.length})</TabsTrigger>}
            {automationId && (
              <TabsTrigger value="history">
                History{runHistory.length > 0 ? ` (${runHistory.length})` : ''}
              </TabsTrigger>
            )}
          </TabsList>

          <div className="flex-1 overflow-y-auto">
            <TabsContent value="run" className="p-6">
              {thread?.prompt ? (
                <div>
                  <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Prompt
                  </h4>
                  <div className="rounded-md border border-border bg-secondary px-3 py-2.5">
                    <AutomationPromptMarkdown prompt={thread.prompt} />
                  </div>
                </div>
              ) : (
                <p className="text-[12px] text-muted-foreground">No prompt recorded.</p>
              )}
            </TabsContent>

            <TabsContent value="plans" className="p-6">
              <PlanHistoryTab
                activeThreadId={threadId}
                effectiveExpanded={expandedPlanId}
                isPlanHistoryLoading={isPlanHistoryLoading}
                isShowingAllPlanRuns={false}
                loadingPlanDetailIds={[]}
                normalizedPlanHistory={plans}
                normalizedReviewsByPlanId={reviewsByPlanId}
                normalizedThreadPlanHistory={plans}
                planHistoryCollapsed={planHistoryCollapsed}
                planRunCount={1}
                planRunGroups={planRunGroups}
                threadPhase={(thread?.status as PipelinePhase) ?? PIPELINE_PHASE.idle}
                onFullScreenPlan={() => {}}
                onPlanExpandedChange={setExpandedPlanId}
                onPlanHistoryCollapsedChange={setPlanHistoryCollapsed}
                onShowAllPlanRunsChange={() => {}}
              />
            </TabsContent>

            <TabsContent value="diff">
              <DiffTab diffs={diffs} threadStatus={thread?.status} />
            </TabsContent>

            <TabsContent value="history" className="p-6">
              {runHistory.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">No previous runs.</p>
              ) : (
                <div className="flex flex-col divide-y divide-border rounded-md border border-border">
                  {runHistory.map((run) => (
                    <Button
                      key={run.id}
                      type="button"
                      variant="ghost"
                      onClick={() => selectAutomationThread(run.id)}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-hover',
                        run.id === threadId && 'bg-hover',
                      )}
                    >
                      <PhaseChip status={run.status} />
                      <span className="min-w-0 flex-1 truncate text-[12px] text-secondary">
                        {describeAutomationRun(run)}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {formatTimestamp(run.createdAt, SHORT_TIMESTAMP_FORMAT)}
                      </span>
                      {run.failureCount > 0 && (
                        <span className="shrink-0 text-[10px] text-danger">
                          {run.failureCount}✕
                        </span>
                      )}
                    </Button>
                  ))}
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>

        {/* Right sidebar: metadata */}
        <div className="w-72 shrink-0 overflow-y-auto border-l border-border">
          <div className="space-y-5 p-4">
            {/* Cost + Tokens */}
            {(thread?.totalCostUsd != null || totalTokens > 0) && (
              <div className="grid grid-cols-2 gap-3">
                {thread?.totalCostUsd != null && (
                  <div>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Cost
                    </span>
                    <p className="mt-0.5 text-sm text-primary">{formatCost(thread.totalCostUsd)}</p>
                  </div>
                )}
                {totalTokens > 0 && (
                  <div>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Tokens
                    </span>
                    <p className="mt-0.5 text-sm text-primary">{formatTokenCount(totalTokens)}</p>
                  </div>
                )}
              </div>
            )}

            {/* Executor + Verifier */}
            {(thread?.executorResolvedModel || thread?.verifierResolvedModel) && (
              <div className="grid grid-cols-1 gap-3">
                {thread.executorResolvedModel && (
                  <div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Executor
                      </span>
                      {automationId && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-4 text-muted-foreground/60 hover:text-primary"
                          title="Edit automation model"
                          onClick={() => openCreateAutomationModal(automationId)}
                        >
                          <Pencil className="size-3" />
                        </Button>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-primary">
                      {thread.executorResolvedModel}
                    </p>
                  </div>
                )}
                {thread.verifierResolvedModel && (
                  <div>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Verifier
                    </span>
                    <p className="mt-0.5 truncate text-sm text-primary">
                      {thread.verifierResolvedModel}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Branch */}
            {thread?.worktreeBranch && (
              <div>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Branch
                </span>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant="default" className="font-mono text-[11px]">
                    {thread.worktreeBranch}
                  </Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (thread.worktreeBranch) handleCopyBranch(thread.worktreeBranch);
                    }}
                    className="size-6 rounded p-0.5 text-muted-foreground transition-colors hover:text-primary"
                    title="Copy branch name"
                  >
                    <Copy className="size-3" />
                  </Button>
                  {thread.worktreePath && thread.projectId && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground"
                      onClick={() =>
                        navigateToGitWorktree(thread.projectId, thread.worktreePath as string)
                      }
                      title="View in Git tab"
                    >
                      <GitBranch size={12} />
                    </Button>
                  )}
                  {(() => {
                    const compareUrl = githubCompareUrl(
                      thread.githubRepo ? `https://github.com/${thread.githubRepo}` : null,
                      thread.baseBranch,
                      thread.worktreeBranch,
                    );
                    return compareUrl ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-muted-foreground"
                        onClick={() =>
                          window.shipcode.invoke('shell:open-external', { url: compareUrl })
                        }
                        title="Compare on GitHub"
                      >
                        <ExternalLink size={12} />
                      </Button>
                    ) : null;
                  })()}
                  {copiedBranch && <span className="text-[10px] text-accent">Copied</span>}
                </div>
                {thread.status === PIPELINE_PHASE.completed &&
                  !thread.githubPrNumber &&
                  thread.githubRepo && (
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 gap-1 px-2 text-[11px]"
                        onClick={() => threadId && createPr.mutate(threadId)}
                        disabled={createPr.isPending}
                        title="Create a draft pull request on GitHub"
                      >
                        <GitPullRequest className="size-3" />
                        {createPr.isPending ? 'Creating…' : 'Create PR'}
                      </Button>
                      {createPr.isError && (
                        <span className="text-[10px] text-destructive">
                          {createPr.error instanceof Error
                            ? createPr.error.message
                            : 'Failed to create PR'}
                        </span>
                      )}
                    </div>
                  )}
              </div>
            )}

            {/* Pull Request */}
            {thread?.githubPrNumber && thread.githubRepo && (
              <div>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Pull Request
                </span>
                <div className="mt-1 flex items-center gap-1.5">
                  <Badge variant="default" className="font-mono text-[11px]">
                    #{thread.githubPrNumber}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground"
                    onClick={() =>
                      window.shipcode.invoke('shell:open-external', {
                        url: `https://github.com/${thread.githubRepo}/pull/${thread.githubPrNumber}`,
                      })
                    }
                    title="Open pull request on GitHub"
                  >
                    <ExternalLink size={12} />
                  </Button>
                </div>
              </div>
            )}

            {/* Timestamps */}
            {thread && (
              <div className="space-y-0.5 text-[11px] text-muted-foreground">
                <p>Created {formatTimestamp(thread.createdAt, SHORT_TIMESTAMP_FORMAT)}</p>
                {thread.failureCount > 0 && (
                  <p>
                    {thread.failureCount} {thread.failureCount === 1 ? 'failure' : 'failures'}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AutomationRunDetail() {
  return useAutomationRunDetailView();
}
