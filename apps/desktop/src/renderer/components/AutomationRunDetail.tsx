import type { DiffRecord, PipelinePhase, PlanRecord, ReviewRecord, Thread } from '@shipcode/shared';
import { formatCost, formatTokenCount, githubCompareUrl, PIPELINE_PHASE } from '@shipcode/shared';
import { PhaseChip } from '@shipcode/ui';
import { Badge, Button, cn, Tabs, TabsContent, TabsList, TabsTrigger } from '@shipshitdev/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  RefreshCw,
  Square,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  describeAutomationRun,
  getAutomationRunTotalTokens,
} from '../features/automations/run-presentation';
import { useAppStore } from '../stores/app-store';
import { DiffTab } from './issue-detail/DiffTab';
import { ACTIVE_PHASES } from './issue-detail/helpers';
import { PlanHistoryTab } from './issue-detail/PlanHistoryTab';
import type { PlanRunGroup } from './issue-detail/tab-types';

export function AutomationRunDetail() {
  const threadId = useAppStore((s) => s.activeAutomationThreadId);
  const selectAutomationThread = useAppStore((s) => s.selectAutomationThread);
  const navigateToGitWorktree = useAppStore((s) => s.navigateToGitWorktree);
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'run' | 'plans' | 'diff' | 'history'>('run');
  const [expandedPlanId, setExpandedPlanId] = useState<string | null | undefined>(null);
  const [planHistoryCollapsed, setPlanHistoryCollapsed] = useState(false);
  const [copiedBranch, setCopiedBranch] = useState(false);

  const { data: thread } = useQuery<Thread | null>({
    queryKey: ['thread', threadId],
    queryFn: () => {
      if (!threadId) throw new Error('Missing thread id');
      return window.shipcode.invoke<Thread | null>('thread:get', { threadId });
    },
    enabled: !!threadId,
    refetchInterval: (query) => {
      const t = query.state.data;
      return t && ACTIVE_PHASES.includes(t.status as PipelinePhase) ? 5_000 : false;
    },
  });

  const isActive = !!thread && ACTIVE_PHASES.includes(thread.status as PipelinePhase);

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

  const handleClose = useCallback(() => selectAutomationThread(null), [selectAutomationThread]);

  const handleCancel = useCallback(async () => {
    if (!threadId) return;
    await window.shipcode.invoke('pipeline:cancel', { threadId });
    queryClient.invalidateQueries({ queryKey: ['thread', threadId] });
  }, [threadId, queryClient]);

  const handleRetry = useCallback(async () => {
    if (!threadId) return;
    await window.shipcode.invoke('pipeline:retry', { threadId });
    queryClient.invalidateQueries({ queryKey: ['thread', threadId] });
  }, [threadId, queryClient]);

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
  const hasError = !!thread?.lastError;

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={handleClose}
          aria-label="Back to board"
          className="rounded p-0.5 text-muted transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-primary">
          {thread?.title ?? 'Automation run'}
        </h3>
        {thread && <PhaseChip status={thread.status} />}
        {isActive && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px] text-destructive hover:bg-destructive/10"
            onClick={handleCancel}
          >
            <Square className="h-3 w-3" />
            Cancel
          </Button>
        )}
        {isFailed && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px]"
            onClick={handleRetry}
          >
            <RefreshCw className="h-3 w-3" />
            Retry
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
                  <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted">
                    Prompt
                  </h4>
                  <div className="rounded-md border border-border bg-tertiary/40 px-3 py-2">
                    <pre className="whitespace-pre-wrap text-xs leading-relaxed text-secondary">
                      {thread.prompt}
                    </pre>
                  </div>
                </div>
              ) : (
                <p className="text-[12px] text-muted">No prompt recorded.</p>
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
                <p className="text-[12px] text-muted">No previous runs.</p>
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
                      <span className="shrink-0 text-[11px] text-muted">
                        {new Date(run.createdAt).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
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
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
                      Cost
                    </span>
                    <p className="mt-0.5 text-sm text-primary">{formatCost(thread.totalCostUsd)}</p>
                  </div>
                )}
                {totalTokens > 0 && (
                  <div>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
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
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
                      Executor
                    </span>
                    <p className="mt-0.5 truncate text-sm text-primary">
                      {thread.executorResolvedModel}
                    </p>
                  </div>
                )}
                {thread.verifierResolvedModel && (
                  <div>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
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
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
                  Branch
                </span>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant="default" className="font-mono text-[11px]">
                    {thread.worktreeBranch}
                  </Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => {
                      if (thread.worktreeBranch) handleCopyBranch(thread.worktreeBranch);
                    }}
                    className="rounded p-0.5 text-muted transition-colors hover:text-primary"
                    title="Copy branch name"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                  {thread.worktreePath && thread.projectId && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted"
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
                        size="icon-xs"
                        className="text-muted"
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
                        <GitPullRequest className="h-3 w-3" />
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
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
                  Pull Request
                </span>
                <div className="mt-1 flex items-center gap-1.5">
                  <Badge variant="default" className="font-mono text-[11px]">
                    #{thread.githubPrNumber}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted"
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
              <div className="space-y-0.5 text-[11px] text-muted">
                <p>
                  Created{' '}
                  {new Date(thread.createdAt).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
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
