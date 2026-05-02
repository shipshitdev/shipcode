import type { DiffRecord, PipelinePhase, PlanRecord, ReviewRecord, Thread } from '@shipcode/shared';
import { formatCost, formatTokenCount, githubCompareUrl, PIPELINE_PHASE } from '@shipcode/shared';
import { PhaseChip } from '@shipcode/ui';
import { Badge, Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@shipshitdev/ui';
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

  const [activeTab, setActiveTab] = useState<'run' | 'plans' | 'diff'>('run');
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

  const totalTokens = (thread?.totalTokensPrompt ?? 0) + (thread?.totalTokensCompletion ?? 0);
  const isFailed =
    thread?.status === PIPELINE_PHASE.failed || thread?.status === PIPELINE_PHASE.idle;
  const hasError = !!thread?.lastError;

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={handleClose}
          aria-label="Back to board"
          className="rounded p-0.5 text-muted transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
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
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2.5">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {thread.failurePhase && (
                <span className="text-[10px] font-medium uppercase tracking-wider text-destructive/70">
                  Failed in {thread.failurePhase}
                </span>
              )}
              <p className="mt-0.5 text-xs text-destructive">{thread.lastError}</p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'run' | 'plans' | 'diff')}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <TabsList className="flex-shrink-0 border-b border-border px-4">
          <TabsTrigger value="run">Run</TabsTrigger>
          {plans.length > 0 && <TabsTrigger value="plans">Plans ({plans.length})</TabsTrigger>}
          {diffs.length > 0 && <TabsTrigger value="diff">Diff ({diffs.length})</TabsTrigger>}
        </TabsList>

        <div className="flex-1 overflow-y-auto">
          <TabsContent value="run" className="px-4 py-3">
            {/* Prompt */}
            {thread?.prompt && (
              <div className="mb-4">
                <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted">
                  Prompt
                </h4>
                <div className="rounded-md border border-border bg-tertiary/40 px-3 py-2">
                  <pre className="whitespace-pre-wrap text-xs leading-relaxed text-secondary">
                    {thread.prompt}
                  </pre>
                </div>
              </div>
            )}

            {/* Metadata grid */}
            <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2">
              {thread?.totalCostUsd != null && (
                <div>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
                    Cost
                  </span>
                  <p className="text-sm text-primary">{formatCost(thread.totalCostUsd)}</p>
                </div>
              )}
              {totalTokens > 0 && (
                <div>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
                    Tokens
                  </span>
                  <p className="text-sm text-primary">{formatTokenCount(totalTokens)}</p>
                </div>
              )}
              {thread?.executorResolvedModel && (
                <div>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
                    Executor
                  </span>
                  <p className="truncate text-sm text-primary">{thread.executorResolvedModel}</p>
                </div>
              )}
              {thread?.verifierResolvedModel && (
                <div>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
                    Verifier
                  </span>
                  <p className="truncate text-sm text-primary">{thread.verifierResolvedModel}</p>
                </div>
              )}
            </div>

            {/* Branch */}
            {thread?.worktreeBranch && (
              <div className="mb-4">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
                  Branch
                </span>
                <div className="mt-1 flex items-center gap-1.5">
                  <Badge variant="default" className="font-mono text-[11px]">
                    {thread.worktreeBranch}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => {
                      if (thread.worktreeBranch) handleCopyBranch(thread.worktreeBranch);
                    }}
                    className="rounded p-0.5 text-muted transition-colors hover:text-primary"
                    title="Copy branch name"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                  {thread.worktreePath && thread.projectId && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted"
                      onClick={() => navigateToGitWorktree(thread.projectId, thread.worktreePath!)}
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
                    <div className="mt-1.5 flex items-center gap-2">
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
              <div className="mb-4">
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
              <div className="text-[10px] text-muted">
                <span>
                  Created{' '}
                  {new Date(thread.createdAt).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
                {thread.failureCount > 0 && (
                  <span className="ml-3">
                    {thread.failureCount} {thread.failureCount === 1 ? 'failure' : 'failures'}
                  </span>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="plans" className="px-4 py-3">
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

          <TabsContent value="diff" className="py-3">
            <DiffTab diffs={diffs} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
