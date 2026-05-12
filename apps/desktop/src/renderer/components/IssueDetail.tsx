import type {
  ActivityEntry,
  AppSettings,
  ClarificationAnswer,
  DiffRecord,
  ExecutorModel,
  FeatureQaResult,
  IntegrationStatus,
  IssuePipelineStatus,
  OpenRouterModelValidation,
  PipelineCheckpoint,
  PipelinePhase,
  PlanRecord,
  Project,
  ReviewRecord,
  TaskGraphWithNodes,
  Thread,
  VerificationRecord,
} from '@shipcode/shared';
import {
  clampError,
  deriveGithubIssueUrl,
  displayAgentLabel,
  formatIssueBranch,
  ISSUE_PIPELINE_STATUS,
  isAgentRoutingLabel,
  PIPELINE_PHASE,
  resolveEffectivePhaseReasoningEffort,
  resolveExecutorModelForIssue,
  resolvePhaseModel,
  resolvePhaseModelForIssue,
  resolvePhaseModelId,
  resolvePhaseReasoningEffortForIssue,
  resolveRequireApproval,
  resolveRequireApprovalForIssue,
  resolveRevisionCount,
  resolveRevisionCountForIssue,
} from '@shipcode/shared';
import { isAutomationIssue, PhaseChip, resolveIssuePriorityBadge } from '@shipcode/ui';
import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shipshitdev/ui';
import { LoadingButtonContent } from '@shipshitdev/ui/common';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowLeft,
  Check,
  CircleCheck,
  CircleDot,
  Copy,
  Play,
  Square,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';
import { toast } from '../stores/toast-store';
import { CostsTab } from './issue-detail/CostsTab';
import {
  ACTIVE_PHASES,
  decodePhaseOption,
  encodePhaseOption,
  resolveFailingPhaseOutput,
} from './issue-detail/helpers';
import { buildIssueDetailActions } from './issue-detail/IssueDetailActions';
import { buildIssueDetailDialogs } from './issue-detail/IssueDetailDialogs';
import { IssueDetailTabs } from './issue-detail/IssueDetailTabs';
import { PipelineTab } from './issue-detail/PipelineTab';
import type { IssueDetailTab } from './issue-detail/tab-types';

const DETAIL_SIDEBAR_MIN = 320;
const DETAIL_SIDEBAR_MAX = 640;
const DETAIL_SIDEBAR_DEFAULT = 416; // matches previous w-[26rem]

const INHERIT_EXECUTOR_VALUE = '__inherit__';
const PLAN_MUTATING_PHASES: PipelinePhase[] = [
  PIPELINE_PHASE.planning,
  PIPELINE_PHASE.reviewing,
  PIPELINE_PHASE.revising,
];
const EXECUTOR_EDITABLE_STATUSES = new Set<IssuePipelineStatus>([
  ISSUE_PIPELINE_STATUS.todo,
  ISSUE_PIPELINE_STATUS.queued,
  ISSUE_PIPELINE_STATUS.failed,
  ISSUE_PIPELINE_STATUS.completed,
  ISSUE_PIPELINE_STATUS.closed,
]);
const ISSUE_META_DOT = <span className="mx-1.5 text-border">·</span>;

type IssueDetailUiState = {
  activeTab: IssueDetailTab;
  expandedPlanId: string | null;
  showAllPlanRuns: boolean;
};

type IssueDetailUiAction =
  | { type: 'issue-changed' }
  | { type: 'active-tab'; tab: IssueDetailTab }
  | { type: 'expanded-plan'; planId: string | null }
  | { type: 'show-all-plan-runs'; show: boolean };

function issueDetailUiReducer(
  state: IssueDetailUiState,
  action: IssueDetailUiAction,
): IssueDetailUiState {
  switch (action.type) {
    case 'issue-changed':
      return { activeTab: 'prd', expandedPlanId: null, showAllPlanRuns: false };
    case 'active-tab':
      return { ...state, activeTab: action.tab };
    case 'expanded-plan':
      return { ...state, expandedPlanId: action.planId };
    case 'show-all-plan-runs':
      return {
        ...state,
        showAllPlanRuns: action.show,
        expandedPlanId: action.show ? state.expandedPlanId : null,
      };
  }
}

function useIssueDetailView() {
  const queryClient = useQueryClient();
  const activeIssue = useAppStore((state) => state.activeIssue);
  const activeThreadId = useAppStore((state) => state.activeThreadId);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const selectIssue = useAppStore((state) => state.selectIssue);
  const pipelinePhase = useAppStore((state) => state.pipelinePhase);
  const commentComposerRequest = useAppStore((state) => state.commentComposerRequest);
  const openEditPrdModal = useAppStore((state) => state.openEditPrdModal);
  const [issueDetailUi, dispatchIssueDetailUi] = useReducer(issueDetailUiReducer, {
    activeTab: 'prd',
    expandedPlanId: null,
    showAllPlanRuns: false,
  });
  const { activeTab, expandedPlanId, showAllPlanRuns } = issueDetailUi;
  const prevIssueSelectionKeyRef = useRef<string | null>(null);
  const [fullScreenPlanId, setFullScreenPlanId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshingFromGithub, setIsRefreshingFromGithub] = useState(false);
  const [isTogglingState, setIsTogglingState] = useState(false);
  const [planHistoryCollapsed, setPlanHistoryCollapsed] = useState(false);
  const [showRawOutput, setShowRawOutput] = useState(false);
  const showRawOutputThreadRef = useRef<string | null>(null);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showMarkAsDoneConfirm, setShowMarkAsDoneConfirm] = useState(false);
  const [branchCopyState, setBranchCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const branchCopyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (branchCopyResetRef.current) clearTimeout(branchCopyResetRef.current);
    };
  }, []);

  // Detail sidebar resize (matches TerminalDrawer / ProjectSidebar pattern)
  const [detailSidebarWidth, setDetailSidebarWidth] = useState(DETAIL_SIDEBAR_DEFAULT);
  const detailDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const handleDetailResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      detailDragRef.current = { startX: e.clientX, startW: detailSidebarWidth };
      const onMove = (ev: MouseEvent) => {
        // Dragging left = wider sidebar (inverted delta)
        const delta = detailDragRef.current!.startX - ev.clientX;
        const next = Math.min(
          DETAIL_SIDEBAR_MAX,
          Math.max(DETAIL_SIDEBAR_MIN, detailDragRef.current!.startW + delta),
        );
        setDetailSidebarWidth(next);
      };
      const onUp = () => {
        detailDragRef.current = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('cursor-col-resize', 'select-none');
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.classList.add('cursor-col-resize', 'select-none');
    },
    [detailSidebarWidth],
  );

  const [phaseModelValidation, setPhaseModelValidation] = useState<
    Partial<
      Record<'planner' | 'reviewer' | 'executor' | 'verifier', OpenRouterModelValidation | null>
    >
  >({});
  const [approveError, setApproveError] = useState<string | null>(null);

  // Shared cache with ProjectSidebar / Titlebar — no extra request.
  const { data: activeProject } = useQuery<Project | null>({
    queryKey: ['project', activeProjectId],
    queryFn: () => window.shipcode.invoke('project:get', { projectId: activeProjectId! }),
    enabled: !!activeProjectId,
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });
  // Fetch thread data if issue is linked
  const { data: thread } = useQuery<Thread | null>({
    queryKey: ['thread', activeThreadId],
    queryFn: () => window.shipcode.invoke('thread:get', { threadId: activeThreadId }),
    enabled: !!activeThreadId,
    // Push-invalidated by pipeline:phase in useIpc.
  });
  const currentPipelinePhase = thread?.status ?? pipelinePhase;
  const shouldPollLiveThread =
    !!activeThreadId &&
    (ACTIVE_PHASES.includes(currentPipelinePhase as PipelinePhase) ||
      currentPipelinePhase === PIPELINE_PHASE.approval);
  const shouldPollPlanData =
    !!activeThreadId && PLAN_MUTATING_PHASES.includes(currentPipelinePhase as PipelinePhase);
  const shouldLoadHistoryTab = activeTab === 'history';
  const shouldLoadIssueWidePlanHistory =
    shouldLoadHistoryTab &&
    !!activeProjectId &&
    !!activeIssue &&
    (!activeThreadId || showAllPlanRuns);
  const shouldLoadActivityTab = activeTab === 'activity';
  // Fetch plan history
  const { data: planHistory } = useQuery<PlanRecord[]>({
    queryKey: ['plan-history', activeThreadId],
    queryFn: () => window.shipcode.invoke('plan:list', { threadId: activeThreadId }),
    enabled: !!activeThreadId,
    // Push-invalidated by pipeline:phase + plan:parsed in useIpc.
  });
  const isThreadPlanHistoryLoading = !!activeThreadId && planHistory === undefined;
  const normalizedThreadPlanHistory = Array.isArray(planHistory) ? planHistory : [];

  const { data: issuePlanHistory } = useQuery<PlanRecord[]>({
    queryKey: ['issue-plan-history', activeProjectId, activeIssue?.issueNumber],
    queryFn: () =>
      window.shipcode.invoke('plan:list-for-issue', {
        projectId: activeProjectId!,
        issueNumber: activeIssue!.issueNumber,
      }),
    enabled: shouldLoadIssueWidePlanHistory,
    // Push-invalidated by plan:parsed in useIpc.
  });
  const isIssuePlanHistoryLoading =
    shouldLoadIssueWidePlanHistory && issuePlanHistory === undefined;
  const normalizedIssuePlanHistory = Array.isArray(issuePlanHistory) ? issuePlanHistory : [];
  const isShowingAllPlanRuns = !activeThreadId || showAllPlanRuns;
  const normalizedPlanHistory =
    isShowingAllPlanRuns && normalizedIssuePlanHistory.length > 0
      ? normalizedIssuePlanHistory
      : normalizedThreadPlanHistory;
  const issueSelectionKey = `${activeIssue?.id ?? ''}:${activeThreadId ?? ''}`;
  const isPlanHistoryLoading = isThreadPlanHistoryLoading || isIssuePlanHistoryLoading;
  const { data: issueActivity = [] } = useQuery<ActivityEntry[]>({
    queryKey: ['issue-activity', activeProjectId, activeIssue?.issueNumber],
    queryFn: () =>
      window.shipcode.invoke('activity:list-for-issue', {
        projectId: activeProjectId!,
        issueNumber: activeIssue!.issueNumber,
        limit: 200,
      }),
    enabled: !!activeProjectId && !!activeIssue && shouldLoadActivityTab,
    refetchInterval: shouldPollLiveThread && shouldLoadActivityTab ? 60_000 : false,
  });
  const normalizedIssueActivity = issueActivity;
  const planRunGroups = useMemo(() => {
    const groupedRunsByThread = new Map<string, Array<{ order: number; plan: PlanRecord }>>();
    let order = 0;
    for (const plan of normalizedPlanHistory) {
      const existingGroup = groupedRunsByThread.get(plan.threadId) ?? [];
      existingGroup.push({ order: order++, plan });
      groupedRunsByThread.set(plan.threadId, existingGroup);
    }
    const groupedRuns = [...groupedRunsByThread.entries()].map(([threadId, entries]) => ({
      threadId,
      order: entries[0]!.order,
      plans: entries.map((entry) => entry.plan),
    }));
    const totalRuns = groupedRuns.length;
    return groupedRuns
      .toSorted((a, b) => a.order - b.order)
      .map((group, index) => ({
        ...group,
        runNumber: totalRuns - index,
        isCurrentRun: group.threadId === activeThreadId,
      }));
  }, [activeThreadId, normalizedPlanHistory]);

  const latestThreadPlanId = normalizedThreadPlanHistory[0]?.id ?? null;
  const reviewPlanIds = useMemo(() => {
    const ids = new Set<string>();
    if (thread?.status === PIPELINE_PHASE.failed && latestThreadPlanId) ids.add(latestThreadPlanId);
    if (activeTab === 'history' && expandedPlanId) ids.add(expandedPlanId);
    if (fullScreenPlanId) ids.add(fullScreenPlanId);
    return Array.from(ids);
  }, [activeTab, expandedPlanId, fullScreenPlanId, latestThreadPlanId, thread?.status]);
  const { data: reviewsByPlanId = {} } = useQuery<Record<string, ReviewRecord>>({
    queryKey: ['reviews-by-plans', reviewPlanIds.join(',')],
    queryFn: () => window.shipcode.invoke('review:list-by-plans', { planIds: reviewPlanIds }),
    enabled: reviewPlanIds.length > 0,
    refetchInterval: shouldPollPlanData && shouldLoadHistoryTab ? 60_000 : false,
  });
  const normalizedReviewsByPlanId =
    reviewsByPlanId && typeof reviewsByPlanId === 'object' ? reviewsByPlanId : {};

  const { data: settings } = useQuery<AppSettings | null>({
    queryKey: ['settings'],
    queryFn: () => window.shipcode.invoke('settings:get'),
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });

  const { data: integrationStatus } = useQuery<IntegrationStatus>({
    queryKey: ['integrations'],
    queryFn: () => window.shipcode.invoke('integrations:check'),
    enabled: true,
    staleTime: 30_000,
  });

  const { data: checkpoints = [] } = useQuery<PipelineCheckpoint[]>({
    queryKey: ['checkpoints', activeThreadId],
    queryFn: () => window.shipcode.invoke('checkpoint:list', { threadId: activeThreadId }),
    enabled: !!activeThreadId,
    // Push-invalidated by pipeline:phase in useIpc.
  });

  const { data: diffs = [] } = useQuery<DiffRecord[]>({
    queryKey: ['diffs', activeThreadId],
    queryFn: () => window.shipcode.invoke('diff:list', { threadId: activeThreadId }),
    enabled: !!activeThreadId,
    // Push-invalidated by pipeline:phase in useIpc.
  });

  const { data: qaResults = [] } = useQuery<FeatureQaResult[]>({
    queryKey: ['feature-qa', activeThreadId],
    queryFn: () =>
      window.shipcode.invoke('feature-qa:list-by-thread', { threadId: activeThreadId as string }),
    enabled: !!activeThreadId,
  });

  const { data: taskGraph = null } = useQuery<TaskGraphWithNodes | null>({
    queryKey: ['task-graph', activeThreadId],
    queryFn: async () => {
      const graph = await window.shipcode.invoke('task-graph:get-latest', {
        threadId: activeThreadId!,
      });
      return graph && Array.isArray(graph.nodes) ? graph : null;
    },
    enabled: !!activeThreadId,
    // Push-invalidated by pipeline:phase in useIpc.
  });

  // Fetch latest verification for the thread
  const { data: latestVerification } = useQuery<VerificationRecord | null>({
    queryKey: ['verification', activeThreadId],
    queryFn: () => window.shipcode.invoke('verification:get', { threadId: activeThreadId }),
    enabled:
      !!activeThreadId &&
      (thread?.status === PIPELINE_PHASE.failed || thread?.status === PIPELINE_PHASE.completed),
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset when issue changes
  useEffect(() => {
    setPhaseModelValidation({});
  }, [activeIssue?.id]);

  const latestReview = normalizedThreadPlanHistory[0]?.id
    ? normalizedReviewsByPlanId[normalizedThreadPlanHistory[0].id]
    : null;
  const failingPhaseOutput = resolveFailingPhaseOutput({
    thread,
    latestPlanRawOutput: normalizedThreadPlanHistory[0]?.rawOutput ?? null,
    latestReviewRawOutput: latestReview?.rawOutput ?? null,
    latestVerificationRawOutput: latestVerification?.rawOutput ?? null,
  });

  const planRunCount = planRunGroups.length;
  const runNumberByThreadId = useMemo(
    () =>
      Object.fromEntries(
        planRunGroups.map((group) => [group.threadId, group.runNumber] as const),
      ) as Record<string, number>,
    [planRunGroups],
  );
  const effectiveExpanded = expandedPlanId;
  const expandedHistoryPlan = useMemo(
    () => normalizedPlanHistory.find((plan) => plan.id === effectiveExpanded) ?? null,
    [effectiveExpanded, normalizedPlanHistory],
  );
  const shouldFetchExpandedPlanDetail =
    activeTab === 'history' &&
    !!expandedHistoryPlan &&
    !expandedHistoryPlan.structured &&
    !expandedHistoryPlan.rawOutput;
  const { data: expandedPlanDetail, isLoading: isExpandedPlanDetailLoading } =
    useQuery<PlanRecord | null>({
      queryKey: ['plan-by-id', expandedHistoryPlan?.id],
      queryFn: () => window.shipcode.invoke('plan:get-by-id', { planId: expandedHistoryPlan!.id }),
      enabled: shouldFetchExpandedPlanDetail,
      staleTime: STABLE_APP_STATE_STALE_TIME,
    });
  const fullScreenPlanBase = useMemo(
    () => normalizedPlanHistory.find((plan) => plan.id === fullScreenPlanId) ?? null,
    [fullScreenPlanId, normalizedPlanHistory],
  );
  const shouldFetchFullScreenPlanDetail =
    !!fullScreenPlanBase && !fullScreenPlanBase.structured && !fullScreenPlanBase.rawOutput;
  const { data: fullScreenPlanDetail, isLoading: isFullScreenPlanDetailLoading } =
    useQuery<PlanRecord | null>({
      queryKey: ['plan-by-id', fullScreenPlanBase?.id],
      queryFn: () => window.shipcode.invoke('plan:get-by-id', { planId: fullScreenPlanBase!.id }),
      enabled: shouldFetchFullScreenPlanDetail,
      staleTime: STABLE_APP_STATE_STALE_TIME,
    });
  const planDetailsById = useMemo(() => {
    const entries: Array<[string, PlanRecord]> = [];
    if (expandedPlanDetail?.id) entries.push([expandedPlanDetail.id, expandedPlanDetail]);
    if (fullScreenPlanDetail?.id) entries.push([fullScreenPlanDetail.id, fullScreenPlanDetail]);
    return Object.fromEntries(entries) as Record<string, PlanRecord>;
  }, [expandedPlanDetail, fullScreenPlanDetail]);
  const resolvedPlanHistory = useMemo(
    () => normalizedPlanHistory.map((plan) => planDetailsById[plan.id] ?? plan),
    [normalizedPlanHistory, planDetailsById],
  );
  const resolvedPlanRunGroups = useMemo(
    () =>
      planRunGroups.map((group) => ({
        ...group,
        plans: group.plans.map((plan) => planDetailsById[plan.id] ?? plan),
      })),
    [planDetailsById, planRunGroups],
  );
  const loadingPlanDetailIds = useMemo(() => {
    const ids = new Set<string>();
    if (shouldFetchExpandedPlanDetail && expandedHistoryPlan?.id && isExpandedPlanDetailLoading) {
      ids.add(expandedHistoryPlan.id);
    }
    if (
      shouldFetchFullScreenPlanDetail &&
      fullScreenPlanBase?.id &&
      isFullScreenPlanDetailLoading
    ) {
      ids.add(fullScreenPlanBase.id);
    }
    return Array.from(ids);
  }, [
    expandedHistoryPlan?.id,
    fullScreenPlanBase?.id,
    isExpandedPlanDetailLoading,
    isFullScreenPlanDetailLoading,
    shouldFetchExpandedPlanDetail,
    shouldFetchFullScreenPlanDetail,
  ]);

  if (showRawOutputThreadRef.current !== activeThreadId) {
    showRawOutputThreadRef.current = activeThreadId;
    if (showRawOutput) setShowRawOutput(false);
  }

  useEffect(() => {
    if (prevIssueSelectionKeyRef.current === issueSelectionKey) return;
    prevIssueSelectionKeyRef.current = issueSelectionKey;
    dispatchIssueDetailUi({ type: 'issue-changed' });
  }, [issueSelectionKey]);

  useEffect(() => {
    if (!activeIssue || commentComposerRequest?.issueId !== activeIssue.id) return;
    dispatchIssueDetailUi({ type: 'active-tab', tab: 'comments' });
  }, [activeIssue, commentComposerRequest]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        selectIssue(null);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectIssue]);

  const latestPlan = useMemo(
    () => normalizedThreadPlanHistory[0] ?? null,
    [normalizedThreadPlanHistory],
  );
  const failedLatestStructuredVerification =
    latestVerification?.planId === latestPlan?.id &&
    latestVerification?.result === 'failed' &&
    !!latestVerification?.structured;
  const retryAction = useMemo(() => {
    if (!thread) return null;
    const structuredPlan = latestPlan?.structured ?? null;
    if (!structuredPlan) return 'plan' as const;
    if (!thread.worktreePath) return 'review' as const;
    if (latestVerification && latestVerification.planId === latestPlan?.id) {
      if (latestVerification.result === 'failed' && latestVerification.structured) {
        return 'execute' as const;
      }
      if (latestVerification.result === 'failed') return 'verify' as const;
      if (latestVerification.result === 'passed') return 'commit_and_push' as const;
    }
    return 'execute' as const;
  }, [latestPlan?.id, latestPlan?.structured, latestVerification, thread]);
  const retryButtonLabel =
    retryAction === 'review'
      ? 'Resume review'
      : retryAction === 'execute'
        ? 'Resume execution'
        : retryAction === 'verify'
          ? 'Resume verification'
          : retryAction === 'commit_and_push'
            ? 'Resume shipping'
            : 'Re-plan';
  const retrySummary =
    retryAction === 'review'
      ? 'Retry will resume from review using the latest structured plan.'
      : retryAction === 'execute'
        ? failedLatestStructuredVerification
          ? 'Retry will resume from execution using the current worktree and latest verification feedback.'
          : 'Retry will resume from execution using the latest structured plan.'
        : retryAction === 'verify'
          ? 'Retry will resume from verification using the current worktree.'
          : retryAction === 'commit_and_push'
            ? 'Retry will resume from commit and push using the verified worktree.'
            : retryAction === 'plan'
              ? 'Retry will start a fresh planning pass. This resumes the workflow, not the same live planner session.'
              : null;
  const threadPhase = currentPipelinePhase;
  const canStartPipeline =
    !activeThreadId &&
    !!activeProjectId &&
    activeIssue?.pipelineStatus !== ISSUE_PIPELINE_STATUS.completed &&
    activeIssue?.pipelineStatus !== ISSUE_PIPELINE_STATUS.closed;
  const canRerun =
    !!activeIssue &&
    activeIssue.pipelineStatus === ISSUE_PIPELINE_STATUS.failed &&
    !!activeProjectId;
  const approvedAwaitingExecution =
    !!activeThreadId &&
    threadPhase === PIPELINE_PHASE.approval &&
    latestPlan?.status === 'approved';
  const hasApprovalDecision =
    !!activeThreadId &&
    threadPhase === PIPELINE_PHASE.approval &&
    !!latestPlan &&
    latestPlan.status !== 'approved';
  const canApprove = hasApprovalDecision && !!(latestPlan?.structured || latestPlan?.rawOutput);

  // Create PR
  const createPr = useMutation({
    mutationFn: (tid: string) =>
      window.shipcode.invoke<{ prNumber: number; prUrl: string }>('pipeline:create-pr', {
        threadId: tid,
      }),
    onSuccess: (_data, tid) => {
      queryClient.invalidateQueries({ queryKey: ['thread', tid] });
      if (activeProjectId) {
        queryClient.invalidateQueries({ queryKey: ['github-issues', activeProjectId] });
      }
    },
  });
  const canCreatePr =
    activeIssue?.pipelineStatus === ISSUE_PIPELINE_STATUS.completed &&
    !activeIssue.linkedPrNumber &&
    !!thread?.githubRepo;

  if (!activeIssue) return null;

  const refreshIssueState = async () => {
    if (!activeProjectId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['threads', activeProjectId] }),
      queryClient.invalidateQueries({ queryKey: ['thread-panel-data', activeProjectId] }),
      queryClient.invalidateQueries({ queryKey: ['github-issues', activeProjectId] }),
      queryClient.invalidateQueries({ queryKey: ['thread', activeThreadId] }),
      queryClient.invalidateQueries({ queryKey: ['plan-history', activeThreadId] }),
      queryClient.invalidateQueries({
        queryKey: ['issue-plan-history', activeProjectId, activeIssue?.issueNumber],
      }),
      queryClient.invalidateQueries({
        queryKey: ['issue-activity', activeProjectId, activeIssue?.issueNumber],
      }),
      queryClient.invalidateQueries({ queryKey: ['checkpoints', activeThreadId] }),
    ]);
  };

  const handleStartPipeline = async () => {
    if (!activeProjectId) return;
    setIsSubmitting(true);
    try {
      await window.shipcode.invoke('github:start-issue', {
        projectId: activeProjectId,
        issueNumber: activeIssue.issueNumber,
      });
      await refreshIssueState();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMarkAsDone = async () => {
    if (!activeProjectId || !activeIssue) return;
    setIsSubmitting(true);
    try {
      await window.shipcode.invoke('issue:mark-done', {
        projectId: activeProjectId,
        issueId: activeIssue.id,
        issueNumber: activeIssue.issueNumber,
      });
      await refreshIssueState();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRerun = async () => {
    if (!activeProjectId || !activeIssue) return;
    setIsSubmitting(true);
    try {
      if (activeThreadId) {
        await window.shipcode.invoke('pipeline:retry', { threadId: activeThreadId });
      } else {
        await window.shipcode.invoke('github:start-issue', {
          projectId: activeProjectId,
          issueNumber: activeIssue.issueNumber,
        });
      }
      await refreshIssueState();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleShowAllPlanRunsChange = (show: boolean) => {
    dispatchIssueDetailUi({ type: 'show-all-plan-runs', show });
  };

  const handleApprove = async () => {
    if (!activeThreadId || !canApprove) return;
    setIsSubmitting(true);
    setApproveError(null);
    try {
      await window.shipcode.invoke('pipeline:approve', { threadId: activeThreadId });
      await refreshIssueState();
    } catch (err) {
      setApproveError(clampError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async (feedback: string) => {
    const trimmedFeedback = feedback.trim();
    if (!activeThreadId || !trimmedFeedback) return;
    setIsSubmitting(true);
    try {
      await window.shipcode.invoke('pipeline:reject', {
        threadId: activeThreadId,
        feedback: trimmedFeedback,
      });
      await refreshIssueState();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!activeThreadId) return;
    setIsSubmitting(true);
    try {
      await window.shipcode.invoke('pipeline:cancel', { threadId: activeThreadId });
      await refreshIssueState();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePause = async () => {
    if (!activeThreadId) return;
    setIsSubmitting(true);
    try {
      await window.shipcode.invoke('pipeline:pause', { threadId: activeThreadId });
      await refreshIssueState();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResume = async () => {
    if (!activeThreadId) return;
    setIsSubmitting(true);
    try {
      await window.shipcode.invoke('pipeline:resume', { threadId: activeThreadId });
      await refreshIssueState();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitClarification = async (answers: ClarificationAnswer[]) => {
    if (!activeThreadId || !thread?.clarificationRequest) return;
    setIsSubmitting(true);
    try {
      await window.shipcode.invoke('pipeline:answer-clarification', {
        threadId: activeThreadId,
        answers,
      });
      await refreshIssueState();
    } finally {
      setIsSubmitting(false);
    }
  };

  const phaseIsActive = ACTIVE_PHASES.includes(threadPhase as PipelinePhase);
  const phaseIsPaused = threadPhase === PIPELINE_PHASE.paused;

  const handlePhaseAgentChange = async (
    phase: 'planner' | 'reviewer' | 'executor' | 'verifier',
    value: string,
  ) => {
    if (!activeProjectId || !activeIssue) return;
    if (value === INHERIT_EXECUTOR_VALUE) {
      await Promise.all([
        window.shipcode.invoke('github:clear-phase-model-override', {
          projectId: activeProjectId,
          issueNumber: activeIssue.issueNumber,
          phase,
        }),
        window.shipcode.invoke('github:clear-phase-model-id-override', {
          projectId: activeProjectId,
          issueNumber: activeIssue.issueNumber,
          phase,
        }),
      ]);
      await queryClient.invalidateQueries({ queryKey: ['github-issues', activeProjectId] });
      return;
    }

    const { provider, modelId } = decodePhaseOption(value);
    await window.shipcode.invoke('github:set-phase-model-override', {
      projectId: activeProjectId,
      issueNumber: activeIssue.issueNumber,
      phase,
      model: provider,
    });
    if (modelId === null) {
      await window.shipcode.invoke('github:clear-phase-model-id-override', {
        projectId: activeProjectId,
        issueNumber: activeIssue.issueNumber,
        phase,
      });
    } else {
      await window.shipcode.invoke('github:set-phase-model-id-override', {
        projectId: activeProjectId,
        issueNumber: activeIssue.issueNumber,
        phase,
        modelId,
      });
    }
    await queryClient.invalidateQueries({ queryKey: ['github-issues', activeProjectId] });
  };

  const handlePhaseOpenRouterSlugBlur = async (
    phase: 'planner' | 'reviewer' | 'executor' | 'verifier',
    rawValue: string,
  ) => {
    if (!activeProjectId || !activeIssue) return;
    const modelId = rawValue.trim() || null;
    if (!modelId) {
      await window.shipcode.invoke('github:clear-phase-model-id-override', {
        projectId: activeProjectId,
        issueNumber: activeIssue.issueNumber,
        phase,
      });
      setPhaseModelValidation((current) => ({ ...current, [phase]: null }));
      await queryClient.invalidateQueries({ queryKey: ['github-issues', activeProjectId] });
      return;
    }

    const validation = await window.shipcode.invoke<OpenRouterModelValidation>(
      'integrations:validate-openrouter-model',
      { modelId },
    );
    await window.shipcode.invoke('github:set-phase-model-id-override', {
      projectId: activeProjectId,
      issueNumber: activeIssue.issueNumber,
      phase,
      modelId,
    });
    setPhaseModelValidation((current) => ({ ...current, [phase]: validation }));
    await queryClient.invalidateQueries({ queryKey: ['github-issues', activeProjectId] });
  };

  const handlePhaseEffortChange = async (
    phase: 'planner' | 'reviewer' | 'executor' | 'verifier',
    effort: string,
  ) => {
    if (!activeProjectId || !activeIssue) return;
    if (effort === '__inherit__') {
      await window.shipcode.invoke('github:clear-phase-reasoning-effort-override', {
        projectId: activeProjectId,
        issueNumber: activeIssue.issueNumber,
        phase,
      });
    } else {
      await window.shipcode.invoke('github:set-phase-reasoning-effort-override', {
        projectId: activeProjectId,
        issueNumber: activeIssue.issueNumber,
        phase,
        effort: effort as import('@shipcode/shared').ReasoningEffort,
      });
    }
    await queryClient.invalidateQueries({ queryKey: ['github-issues', activeProjectId] });
  };

  const handleRevisionCountChange = async (value: string) => {
    if (!activeProjectId || !activeIssue) return;
    await window.shipcode.invoke('github:set-revision-count-override', {
      projectId: activeProjectId,
      issueNumber: activeIssue.issueNumber,
      revisionCount: value === '__inherit__' ? null : Number.parseInt(value, 10),
    });
    await queryClient.invalidateQueries({ queryKey: ['github-issues', activeProjectId] });
  };

  const handleRequireApprovalChange = async (value: string) => {
    if (!activeProjectId || !activeIssue) return;
    await window.shipcode.invoke('github:set-require-approval-override', {
      projectId: activeProjectId,
      issueNumber: activeIssue.issueNumber,
      requireApproval: value === '__inherit__' ? null : value === 'true',
    });
    await queryClient.invalidateQueries({ queryKey: ['github-issues', activeProjectId] });
  };

  const handleEditPrd = () => {
    openEditPrdModal(activeIssue.issueNumber, activeIssue.body ?? '', activeIssue.labels);
  };

  const githubIssueUrl =
    !activeIssue.isQuickMode && !isAutomationIssue(activeIssue)
      ? deriveGithubIssueUrl(activeProject?.gitRemote ?? null, activeIssue.issueNumber)
      : null;

  const handleOpenOnGithub = async () => {
    await window.shipcode.invoke('shell:open-external', { url: githubIssueUrl! });
  };
  const issueBranchName = !isAutomationIssue(activeIssue)
    ? formatIssueBranch(
        activeIssue.issueNumber,
        activeIssue.title,
        settings?.worktreeBranchFormat ?? null,
      )
    : null;
  const handleCopyBranchName = async () => {
    if (branchCopyResetRef.current) clearTimeout(branchCopyResetRef.current);
    try {
      await navigator.clipboard.writeText(issueBranchName!);
      setBranchCopyState('copied');
    } catch {
      setBranchCopyState('error');
    }
    branchCopyResetRef.current = setTimeout(() => setBranchCopyState('idle'), 1500);
  };
  const handleOpenPullRequest = async () => {
    await window.shipcode.invoke('shell:open-external', { url: linkedPrUrl! });
  };

  const handleToggleIssueState = async (newState: 'open' | 'closed') => {
    if (!activeProjectId || activeIssue.state === newState) return;
    setIsTogglingState(true);
    try {
      if (newState === 'closed') {
        await window.shipcode.invoke('github:close-issue', {
          projectId: activeProjectId,
          issueNumber: activeIssue.issueNumber,
        });
      } else {
        await window.shipcode.invoke('github:reopen-issue', {
          projectId: activeProjectId,
          issueNumber: activeIssue.issueNumber,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['github-issues', activeProjectId] });
    } finally {
      setIsTogglingState(false);
    }
  };

  const handleRefreshFromGithub = async () => {
    if (!activeProjectId) return;
    setIsRefreshingFromGithub(true);
    try {
      await window.shipcode.invoke('github:refresh-issues', {
        projectId: activeProjectId,
        force: true,
      });
      await queryClient.invalidateQueries({ queryKey: ['github-issues', activeProjectId] });
    } finally {
      setIsRefreshingFromGithub(false);
    }
  };

  // Executor is locked in once the pipeline is mid-loop. It's editable
  // before the run starts (todo/queued) and after terminal states where
  // the user will kick off a new run (failed/completed/done).
  const executorEditable = EXECUTOR_EDITABLE_STATUSES.has(activeIssue.pipelineStatus);
  const effectivePhaseProviders = {
    planner: settings
      ? resolvePhaseModelForIssue(settings, activeProject, activeIssue, 'planner')
      : 'claude',
    reviewer: settings
      ? resolvePhaseModelForIssue(settings, activeProject, activeIssue, 'reviewer')
      : 'codex',
    executor: settings
      ? resolveExecutorModelForIssue(settings, activeProject, activeIssue)
      : 'claude',
    verifier: settings
      ? resolvePhaseModelForIssue(settings, activeProject, activeIssue, 'verifier')
      : 'claude',
  } as const;
  const projectDefaultPhaseSelections = {
    planner:
      settings && activeProject
        ? {
            provider: resolvePhaseModel(settings, activeProject, 'planner'),
            modelId: resolvePhaseModelId(settings, activeProject, 'planner'),
          }
        : { provider: 'claude' as ExecutorModel, modelId: null as string | null },
    reviewer:
      settings && activeProject
        ? {
            provider: resolvePhaseModel(settings, activeProject, 'reviewer'),
            modelId: resolvePhaseModelId(settings, activeProject, 'reviewer'),
          }
        : { provider: 'claude' as ExecutorModel, modelId: null as string | null },
    executor:
      settings && activeProject
        ? {
            provider: resolvePhaseModel(settings, activeProject, 'executor'),
            modelId: resolvePhaseModelId(settings, activeProject, 'executor'),
          }
        : { provider: 'claude' as ExecutorModel, modelId: null as string | null },
    verifier:
      settings && activeProject
        ? {
            provider: resolvePhaseModel(settings, activeProject, 'verifier'),
            modelId: resolvePhaseModelId(settings, activeProject, 'verifier'),
          }
        : { provider: 'claude' as ExecutorModel, modelId: null as string | null },
  } as const;
  const phaseSelectValues = {
    planner:
      activeIssue.plannerModelOverride || activeIssue.plannerModelIdOverride
        ? encodePhaseOption(
            activeIssue.plannerModelOverride ?? effectivePhaseProviders.planner,
            activeIssue.plannerModelIdOverride,
          )
        : INHERIT_EXECUTOR_VALUE,
    reviewer:
      activeIssue.reviewerModelOverride || activeIssue.reviewerModelIdOverride
        ? encodePhaseOption(
            activeIssue.reviewerModelOverride ?? effectivePhaseProviders.reviewer,
            activeIssue.reviewerModelIdOverride,
          )
        : INHERIT_EXECUTOR_VALUE,
    executor:
      activeIssue.executorModelOverride || activeIssue.executorModelIdOverride
        ? encodePhaseOption(
            activeIssue.executorModelOverride ?? effectivePhaseProviders.executor,
            activeIssue.executorModelIdOverride,
          )
        : INHERIT_EXECUTOR_VALUE,
    verifier:
      activeIssue.verifierModelOverride || activeIssue.verifierModelIdOverride
        ? encodePhaseOption(
            activeIssue.verifierModelOverride ?? effectivePhaseProviders.verifier,
            activeIssue.verifierModelIdOverride,
          )
        : INHERIT_EXECUTOR_VALUE,
  } as const;
  const INHERIT_EFFORT_VALUE = '__inherit__';
  const phaseEffortSelectValues = {
    planner: activeIssue.plannerReasoningEffortOverride ?? INHERIT_EFFORT_VALUE,
    reviewer: activeIssue.reviewerReasoningEffortOverride ?? INHERIT_EFFORT_VALUE,
    executor: activeIssue.executorReasoningEffortOverride ?? INHERIT_EFFORT_VALUE,
    verifier: activeIssue.verifierReasoningEffortOverride ?? INHERIT_EFFORT_VALUE,
  } as const;
  const inheritedPhaseReasoningEfforts = {
    planner: settings
      ? resolveEffectivePhaseReasoningEffort(settings, activeProject, 'planner')
      : 'none',
    reviewer: settings
      ? resolveEffectivePhaseReasoningEffort(settings, activeProject, 'reviewer')
      : 'none',
    executor: settings
      ? resolveEffectivePhaseReasoningEffort(settings, activeProject, 'executor')
      : 'none',
    verifier: settings
      ? resolveEffectivePhaseReasoningEffort(settings, activeProject, 'verifier')
      : 'none',
  } as const;
  const currentPhaseReasoningEfforts = {
    planner: settings
      ? resolvePhaseReasoningEffortForIssue(settings, activeProject, activeIssue, 'planner')
      : 'none',
    reviewer: settings
      ? resolvePhaseReasoningEffortForIssue(settings, activeProject, activeIssue, 'reviewer')
      : 'none',
    executor: settings
      ? resolvePhaseReasoningEffortForIssue(settings, activeProject, activeIssue, 'executor')
      : 'none',
    verifier: settings
      ? resolvePhaseReasoningEffortForIssue(settings, activeProject, activeIssue, 'verifier')
      : 'none',
  } as const;

  const currentPhaseSelections = {
    planner:
      phaseSelectValues.planner === INHERIT_EXECUTOR_VALUE
        ? { provider: effectivePhaseProviders.planner, modelId: null as string | null }
        : decodePhaseOption(phaseSelectValues.planner),
    reviewer:
      phaseSelectValues.reviewer === INHERIT_EXECUTOR_VALUE
        ? { provider: effectivePhaseProviders.reviewer, modelId: null as string | null }
        : decodePhaseOption(phaseSelectValues.reviewer),
    executor:
      phaseSelectValues.executor === INHERIT_EXECUTOR_VALUE
        ? { provider: effectivePhaseProviders.executor, modelId: null as string | null }
        : decodePhaseOption(phaseSelectValues.executor),
    verifier:
      phaseSelectValues.verifier === INHERIT_EXECUTOR_VALUE
        ? { provider: effectivePhaseProviders.verifier, modelId: null as string | null }
        : decodePhaseOption(phaseSelectValues.verifier),
  } as const;
  const inheritedRevisionCount = settings ? resolveRevisionCount(settings, activeProject) : 0;
  const effectiveRevisionCount = settings
    ? resolveRevisionCountForIssue(settings, activeProject, activeIssue)
    : inheritedRevisionCount;
  const inheritedRequireApproval = settings
    ? resolveRequireApproval(settings, activeProject)
    : false;
  const effectiveRequireApproval = settings
    ? resolveRequireApprovalForIssue(settings, activeProject, activeIssue)
    : inheritedRequireApproval;
  const revisionCountSelectValue =
    activeIssue.revisionCountOverride == null
      ? '__inherit__'
      : String(activeIssue.revisionCountOverride);
  const requireApprovalSelectValue =
    activeIssue.requireApprovalOverride == null
      ? '__inherit__'
      : activeIssue.requireApprovalOverride
        ? 'true'
        : 'false';

  // ─── Shared render sections ──────────────────────────────────────────────

  const handleArchiveConfirmed = () => {
    if (!activeProjectId) return;
    window.shipcode
      .invoke('github:archive-issue', {
        projectId: activeProjectId,
        issueId: activeIssue.id,
        issueNumber: activeIssue.issueNumber,
      })
      .then(() => {
        setShowArchiveConfirm(false);
        selectIssue(null);
        queryClient.invalidateQueries({ queryKey: ['github-issues', activeProjectId] });
      })
      .catch((err: Error) => {
        setShowArchiveConfirm(false);
        toast.error('Failed to archive issue', err?.message ?? String(err));
      });
  };

  const handleRestoreCheckpoint = async (checkpoint: PipelineCheckpoint) => {
    if (!activeThreadId) return;
    const confirmed = window.confirm(
      `Restore checkpoint "${checkpoint.label}"?\n\nThis will hard-reset the worktree to ${checkpoint.commitSha.slice(0, 12)} and remove untracked files in that worktree.\n\nThis restores code state only. It does not resume the same planner session.`,
    );
    if (!confirmed) return;
    setIsSubmitting(true);
    try {
      await window.shipcode.invoke('checkpoint:restore', {
        threadId: activeThreadId,
        checkpointId: checkpoint.id,
      });
      await refreshIssueState();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStabilizePr = async () => {
    if (!activeThreadId) return;
    setIsSubmitting(true);
    try {
      await window.shipcode.invoke('pipeline:stabilize-pr', { threadId: activeThreadId });
      await refreshIssueState();
    } finally {
      setIsSubmitting(false);
    }
  };

  const headerButtons = (
    <>
      {/* Back button — left */}
      <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          onClick={() => selectIssue(null)}
          title="Back to board"
          aria-label="Back to board"
        >
          <ArrowLeft size={18} strokeWidth={2.5} />
        </Button>
      </div>
    </>
  );

  const headerStatus =
    activeThreadId && threadPhase !== PIPELINE_PHASE.idle
      ? threadPhase
      : activeIssue.pipelineStatus;
  const headerStatusAnimated =
    ACTIVE_PHASES.includes(threadPhase as PipelinePhase) || threadPhase === PIPELINE_PHASE.approval;

  const issueStatusChip = (
    <PhaseChip
      status={headerStatus}
      className={cn(
        'text-[11px] font-semibold',
        headerStatusAnimated &&
          'relative pl-4 before:absolute before:left-1.5 before:top-1/2 before:h-1.5 before:w-1.5 before:-translate-y-1/2 before:rounded-full before:bg-current before:animate-pulse',
      )}
    />
  );

  const issueStatusBadge = canStartPipeline ? (
    <span className="group relative inline-flex items-center">
      <span className="pointer-events-none transition-opacity group-hover:opacity-0">
        {issueStatusChip}
      </span>
      <Button
        variant="ghost"
        size="xs"
        className="absolute inset-0 h-auto rounded px-1.5 py-0.5 text-[10px] font-medium text-agent/70 opacity-0 transition-opacity hover:bg-agent/10 hover:text-agent group-hover:opacity-100"
        title="Start planning"
        onClick={handleStartPipeline}
        disabled={isSubmitting}
      >
        <LoadingButtonContent loading={isSubmitting} className="gap-1" spinnerSize={10}>
          PLAN
        </LoadingButtonContent>
      </Button>
    </span>
  ) : phaseIsActive ? (
    <span className="group relative inline-flex items-center">
      <span className="pointer-events-none transition-opacity group-hover:opacity-0">
        {issueStatusChip}
      </span>
      <Button
        variant="ghost"
        size="xs"
        className="absolute inset-0 h-auto rounded px-1.5 py-0.5 text-[10px] font-medium text-warning/80 opacity-0 transition-opacity hover:bg-warning/10 hover:text-warning group-hover:opacity-100"
        title="Pause task"
        aria-label="Pause task"
        onClick={handlePause}
        disabled={isSubmitting}
      >
        <LoadingButtonContent loading={isSubmitting} className="gap-1" spinnerSize={10}>
          <Square size={10} />
        </LoadingButtonContent>
      </Button>
    </span>
  ) : phaseIsPaused ? (
    <span className="group relative inline-flex items-center">
      <span className="pointer-events-none transition-opacity group-hover:opacity-0">
        {issueStatusChip}
      </span>
      <Button
        variant="ghost"
        size="xs"
        className="absolute inset-0 h-auto rounded px-1.5 py-0.5 text-[10px] font-medium text-agent/70 opacity-0 transition-opacity hover:bg-agent/10 hover:text-agent group-hover:opacity-100"
        title="Resume task"
        aria-label="Resume task"
        onClick={handleResume}
        disabled={isSubmitting}
      >
        <LoadingButtonContent loading={isSubmitting} className="gap-1" spinnerSize={10}>
          <Play size={10} />
        </LoadingButtonContent>
      </Button>
    </span>
  ) : canRerun ? (
    <span className="group relative inline-flex items-center">
      <span className="pointer-events-none transition-opacity group-hover:opacity-0">
        {issueStatusChip}
      </span>
      <Button
        variant="ghost"
        size="xs"
        className="absolute inset-0 h-auto rounded px-1.5 py-0.5 text-[10px] font-medium text-danger/70 opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
        title="Retry pipeline"
        onClick={handleRerun}
        disabled={isSubmitting}
      >
        <LoadingButtonContent loading={isSubmitting} className="gap-1" spinnerSize={10}>
          RETRY
        </LoadingButtonContent>
      </Button>
    </span>
  ) : (
    issueStatusChip
  );

  const linkedPrUrl =
    activeIssue.linkedPrUrl ??
    (thread?.githubPrNumber && thread.githubRepo
      ? `https://github.com/${thread.githubRepo}/pull/${thread.githubPrNumber}`
      : null);
  const issueIdentityLinks = (
    <div className="mt-1 flex flex-wrap items-center pl-10 text-[11px]">
      {/* Issue number */}
      {activeIssue.isQuickMode ? (
        <span className="font-mono text-muted-foreground">Quick</span>
      ) : isAutomationIssue(activeIssue) ? (
        <span className="font-mono text-muted-foreground">[Auto]</span>
      ) : githubIssueUrl ? (
        <button
          type="button"
          onClick={handleOpenOnGithub}
          className="font-mono text-muted-foreground transition-colors hover:text-primary"
          title="Open this issue on GitHub"
        >
          #{activeIssue.issueNumber}
        </button>
      ) : (
        <span className="font-mono text-muted-foreground">#{activeIssue.issueNumber}</span>
      )}

      {/* State — open/closed dropdown */}
      {!isAutomationIssue(activeIssue) && (
        <>
          {ISSUE_META_DOT}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  'flex items-center gap-1 font-medium transition-colors disabled:opacity-50',
                  activeIssue.state === 'open' ? 'text-success' : 'text-done hover:text-done/80',
                )}
                disabled={isTogglingState}
              >
                {activeIssue.state === 'open' ? (
                  <CircleDot className="size-3" />
                ) : (
                  <CircleCheck className="size-3" />
                )}
                <LoadingButtonContent
                  loading={isTogglingState}
                  className="gap-1"
                  labelClassName="gap-1"
                  spinnerSize={10}
                >
                  {activeIssue.state === 'open' ? 'Open' : 'Closed'}
                </LoadingButtonContent>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                disabled={activeIssue.state === 'open'}
                onClick={() => void handleToggleIssueState('open')}
              >
                <CircleDot className="mr-2 size-3.5 text-success" />
                Reopen issue
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={activeIssue.state === 'closed'}
                onClick={() => void handleToggleIssueState('closed')}
              >
                <CircleCheck className="mr-2 size-3.5 text-done" />
                Close issue
              </DropdownMenuItem>
              {(activeIssue.pipelineStatus === ISSUE_PIPELINE_STATUS.completed ||
                activeIssue.pipelineStatus === ISSUE_PIPELINE_STATUS.closed) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setShowArchiveConfirm(true)}>
                    <Archive className="mr-2 size-3.5 text-muted-foreground" />
                    Archive issue
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      {/* Branch name — copy on click */}
      {issueBranchName && (
        <>
          {ISSUE_META_DOT}
          <button
            type="button"
            onClick={() => void handleCopyBranchName()}
            className={cn(
              'flex items-center gap-1 font-mono transition-colors',
              branchCopyState === 'copied'
                ? 'text-success'
                : branchCopyState === 'error'
                  ? 'text-danger'
                  : 'text-muted-foreground hover:text-primary',
            )}
            title={
              branchCopyState === 'copied'
                ? 'Copied!'
                : branchCopyState === 'error'
                  ? 'Clipboard write failed'
                  : `Copy branch name (${issueBranchName})`
            }
            aria-label="Copy branch name"
            data-testid="copy-branch-name"
          >
            {branchCopyState === 'copied' ? (
              <Check className="size-3" />
            ) : (
              <Copy className="size-3" />
            )}
            <span>{issueBranchName}</span>
          </button>
        </>
      )}

      {/* PR link */}
      {activeIssue.linkedPrNumber && (
        <>
          {ISSUE_META_DOT}
          {linkedPrUrl ? (
            <button
              type="button"
              onClick={() => void handleOpenPullRequest()}
              className="font-medium text-done transition-colors hover:text-done/80"
              title="Open pull request on GitHub"
            >
              PR #{activeIssue.linkedPrNumber}
            </button>
          ) : (
            <Badge variant="done" className="text-[10px]">
              PR #{activeIssue.linkedPrNumber}
            </Badge>
          )}
        </>
      )}
    </div>
  );
  const issuePriorityBadge = resolveIssuePriorityBadge(activeIssue);
  const issueBadges = (
    <div className="flex flex-wrap gap-1.5">
      {issuePriorityBadge ? (
        <Badge
          variant={issuePriorityBadge.variant}
          className="text-[11px] font-semibold uppercase tracking-wide"
          title={issuePriorityBadge.title}
        >
          {issuePriorityBadge.label}
        </Badge>
      ) : null}
      {activeIssue.assignee && (
        <Badge variant="default" className="text-[11px]">
          {activeIssue.assignee}
        </Badge>
      )}
      {activeIssue.linkedPrNumber && (
        <Badge variant={activeIssue.linkedPrIsDraft ? 'warning' : 'done'} className="text-[10px]">
          {activeIssue.linkedPrIsDraft ? 'Draft PR' : 'Ready PR'}
        </Badge>
      )}
      {activeIssue.labels.flatMap((label) =>
        isAgentRoutingLabel(label)
          ? [
              <Badge key={label} className="text-[10px] bg-accent/15 text-accent" title={label}>
                {displayAgentLabel(label)}
              </Badge>,
            ]
          : [],
      )}
      {activeIssue.ciBlocked && (
        <Badge variant="danger" className="text-[10px] uppercase">
          CI blocked
        </Badge>
      )}
      {activeIssue.unresolvedReviewCommentCount > 0 && (
        <Badge variant="warning" className="text-[10px]">
          {activeIssue.unresolvedReviewCommentCount} review
          {activeIssue.unresolvedReviewCommentCount === 1 ? '' : 's'}
        </Badge>
      )}
    </div>
  );
  const hasPrFeedbackBlockers =
    activeIssue.ciBlocked || activeIssue.unresolvedReviewCommentCount > 0;
  const fullScreenPlan = resolvedPlanHistory.find((plan) => plan.id === fullScreenPlanId) ?? null;
  const fullScreenReview = fullScreenPlan
    ? normalizedReviewsByPlanId[fullScreenPlan.id]
    : undefined;

  const {
    approvalSection,
    clarificationSection,
    completionSection,
    pipelineStartCard,
    rerunSection,
  } = buildIssueDetailActions({
    approveError,
    approvedAwaitingExecution,
    canApprove,
    canRerun,
    canStartPipeline,
    effectiveRevisionCount,
    clarificationRequest: thread?.clarificationRequest ?? null,
    failingPhaseOutput,
    hasDiffs: (diffs?.length ?? 0) > 0,
    hasApprovalDecision,
    isCompleted: activeIssue?.pipelineStatus === ISSUE_PIPELINE_STATUS.completed,
    isSubmitting,
    requireApproval: effectiveRequireApproval,
    retryButtonLabel,
    retrySummary,
    showRawOutput,
    thread,
    verificationSummary: latestVerification?.structured?.summary ?? null,
    onApprove: () => void handleApprove(),
    onCancel: () => void handleCancel(),
    onEditPrd: handleEditPrd,
    onMarkAsDone: () => setShowMarkAsDoneConfirm(true),
    onReject: (nextFeedback) => void handleReject(nextFeedback),
    onRerun: () => void handleRerun(),
    onShowRawOutputChange: setShowRawOutput,
    onStartPipeline: () => void handleStartPipeline(),
    onSubmitClarification: handleSubmitClarification,
    canCreatePr,
    isCreatingPr: createPr.isPending,
    createPrError: createPr.isError
      ? createPr.error instanceof Error
        ? createPr.error.message
        : 'Failed to create PR'
      : null,
    onCreatePr: activeThreadId ? () => createPr.mutate(activeThreadId) : undefined,
  });

  const detailTabs = (
    <IssueDetailTabs
      activeIssue={activeIssue}
      activeTab={activeTab}
      activeThreadId={activeThreadId}
      checkpoints={checkpoints}
      currentPhaseSelections={currentPhaseSelections}
      diffs={diffs}
      effectiveExpanded={effectiveExpanded}
      executorEditable={executorEditable}
      hasPrFeedbackBlockers={hasPrFeedbackBlockers}
      integrationStatus={integrationStatus}
      isRefreshingFromGithub={isRefreshingFromGithub}
      isSubmitting={isSubmitting}
      isShowingAllPlanRuns={isShowingAllPlanRuns}
      linkedPrUrl={linkedPrUrl}
      effectiveRequireApproval={effectiveRequireApproval}
      effectiveRevisionCount={effectiveRevisionCount}
      inheritedRequireApproval={inheritedRequireApproval}
      inheritedRevisionCount={inheritedRevisionCount}
      normalizedIssueActivity={normalizedIssueActivity}
      loadingPlanDetailIds={loadingPlanDetailIds}
      normalizedPlanHistory={resolvedPlanHistory}
      normalizedReviewsByPlanId={normalizedReviewsByPlanId}
      normalizedThreadPlanHistory={normalizedThreadPlanHistory}
      isPlanHistoryLoading={isPlanHistoryLoading}
      phaseModelValidation={phaseModelValidation}
      phaseSelectValues={phaseSelectValues}
      requireApprovalSelectValue={requireApprovalSelectValue}
      revisionCountSelectValue={revisionCountSelectValue}
      planHistoryCollapsed={planHistoryCollapsed}
      planRunCount={planRunCount}
      planRunGroups={resolvedPlanRunGroups}
      projectDefaultPhaseSelections={projectDefaultPhaseSelections}
      runNumberByThreadId={runNumberByThreadId}
      qaResults={qaResults}
      taskGraph={taskGraph}
      thread={thread}
      threadPhase={threadPhase}
      githubIssueUrl={githubIssueUrl}
      onEditPrd={handleEditPrd}
      onActiveTabChange={(tab) => dispatchIssueDetailUi({ type: 'active-tab', tab })}
      onFullScreenPlan={setFullScreenPlanId}
      currentPhaseReasoningEfforts={currentPhaseReasoningEfforts}
      inheritedPhaseReasoningEfforts={inheritedPhaseReasoningEfforts}
      phaseEffortSelectValues={phaseEffortSelectValues}
      onPhaseAgentChange={(phase, value) => {
        void handlePhaseAgentChange(phase, value);
      }}
      onPhaseEffortChange={(phase, effort) => {
        void handlePhaseEffortChange(phase, effort);
      }}
      onRequireApprovalChange={(value) => {
        void handleRequireApprovalChange(value);
      }}
      onRevisionCountChange={(value) => {
        void handleRevisionCountChange(value);
      }}
      onPhaseOpenRouterSlugBlur={(phase, value) => {
        void handlePhaseOpenRouterSlugBlur(phase, value);
      }}
      onPlanExpandedChange={(planId) =>
        dispatchIssueDetailUi({ type: 'expanded-plan', planId: planId ?? null })
      }
      onPlanHistoryCollapsedChange={setPlanHistoryCollapsed}
      onShowAllPlanRunsChange={handleShowAllPlanRunsChange}
      onRefreshFromGithub={() => {
        void handleRefreshFromGithub();
      }}
      onRestoreCheckpoint={(checkpoint) => {
        void handleRestoreCheckpoint(checkpoint);
      }}
      onStabilizePr={() => {
        void handleStabilizePr();
      }}
      projectId={activeProjectId ?? ''}
      commentComposerRequestId={
        commentComposerRequest?.issueId === activeIssue.id ? commentComposerRequest.requestId : null
      }
    />
  );

  const detailDialogs = buildIssueDetailDialogs({
    activeIssueNumber: activeIssue.issueNumber,
    fullScreenPlan,
    fullScreenPlanId,
    fullScreenReview,
    latestPlanId: latestPlan?.id ?? null,
    state: {
      canApprove,
      isFullScreenPlanLoading:
        shouldFetchFullScreenPlanDetail && isFullScreenPlanDetailLoading && !!fullScreenPlanId,
      isSubmitting,
      showArchiveConfirm,
      showMarkAsDoneConfirm,
    },
    onApprove: () => {
      void handleApprove();
    },
    onArchiveConfirmed: handleArchiveConfirmed,
    onCloseArchiveConfirm: () => setShowArchiveConfirm(false),
    onCloseFullScreenPlan: () => setFullScreenPlanId(null),
    onMarkAsDoneConfirmed: () => {
      setShowMarkAsDoneConfirm(false);
      void handleMarkAsDone();
    },
    onCloseMarkAsDoneConfirm: () => setShowMarkAsDoneConfirm(false),
  });

  const detailActionStack =
    pipelineStartCard ||
    rerunSection ||
    clarificationSection ||
    approvalSection ||
    completionSection ? (
      <div className="space-y-4 mb-6">
        {pipelineStartCard}
        {rerunSection}
        {completionSection}
        {clarificationSection}
        {approvalSection}
      </div>
    ) : null;

  // ─── Full-page layout (Linear-style) ─────────────────────────────────────

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-primary">
      {/* Header — full width */}
      <div className="relative shrink-0 border-b border-border px-6 py-4">
        {headerButtons}
        {/* Title + status badge */}
        <div className="flex flex-wrap items-baseline gap-2 pl-10">
          <h1 className="text-xl font-semibold leading-snug">{activeIssue.title}</h1>
          {issueStatusBadge}
        </div>
        {/* Metadata: #num · state · branch · PR */}
        {issueIdentityLinks}
      </div>
      {/* Two-column body — fills remaining height */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Main — scrollable */}
        <div
          className="flex min-w-0 flex-1 flex-col overflow-y-auto p-6"
          data-issue-detail-scroll-region
        >
          {detailActionStack}
          {detailTabs}
        </div>
        {/* Sidebar — full height, own scroll, resizable */}
        <div
          className="relative shrink-0 overflow-y-auto border-l border-border"
          style={{
            width: detailSidebarWidth,
            minWidth: DETAIL_SIDEBAR_MIN,
            maxWidth: DETAIL_SIDEBAR_MAX,
          }}
        >
          <Button
            type="button"
            variant="ghost"
            aria-label="Resize detail sidebar"
            className="absolute top-0 left-0 bottom-0 h-auto w-1 cursor-col-resize rounded-none p-0 hover:bg-accent/20 active:bg-accent/30 transition-colors"
            onMouseDown={handleDetailResizeMouseDown}
          />
          <div className="space-y-6 px-4 pt-2 pb-4">
            {/* Details */}
            {issueBadges && <div>{issueBadges}</div>}
            {/* Pipeline */}
            <PipelineTab
              activeIssue={activeIssue}
              activeThreadId={activeThreadId}
              checkpoints={checkpoints}
              currentPhaseReasoningEfforts={currentPhaseReasoningEfforts}
              currentPhaseSelections={currentPhaseSelections}
              effectiveRequireApproval={effectiveRequireApproval}
              effectiveRevisionCount={effectiveRevisionCount}
              executorEditable={executorEditable}
              hasPrFeedbackBlockers={hasPrFeedbackBlockers}
              inheritedPhaseReasoningEfforts={inheritedPhaseReasoningEfforts}
              inheritedRequireApproval={inheritedRequireApproval}
              inheritedRevisionCount={inheritedRevisionCount}
              integrationStatus={integrationStatus}
              isSubmitting={isSubmitting}
              linkedPrUrl={linkedPrUrl}
              phaseEffortSelectValues={phaseEffortSelectValues}
              phaseModelValidation={phaseModelValidation}
              phaseSelectValues={phaseSelectValues}
              qaResults={qaResults}
              requireApprovalSelectValue={requireApprovalSelectValue}
              projectDefaultPhaseSelections={projectDefaultPhaseSelections}
              revisionCountSelectValue={revisionCountSelectValue}
              taskGraph={taskGraph}
              thread={thread}
              githubIssueUrl={githubIssueUrl}
              onPhaseAgentChange={(phase, value) => {
                void handlePhaseAgentChange(phase, value);
              }}
              onPhaseEffortChange={(phase, effort) => {
                void handlePhaseEffortChange(phase, effort);
              }}
              onRequireApprovalChange={(value) => {
                void handleRequireApprovalChange(value);
              }}
              onRevisionCountChange={(value) => {
                void handleRevisionCountChange(value);
              }}
              onPhaseOpenRouterSlugBlur={(phase, value) => {
                void handlePhaseOpenRouterSlugBlur(phase, value);
              }}
              onRestoreCheckpoint={(checkpoint) => {
                void handleRestoreCheckpoint(checkpoint);
              }}
              onStabilizePr={() => {
                void handleStabilizePr();
              }}
            />
            {/* Costs */}
            <CostsTab
              projectId={activeProjectId ?? ''}
              issueNumber={activeIssue.issueNumber}
              thread={thread}
            />
          </div>
        </div>
      </div>
      {detailDialogs}
    </div>
  );
}

export function IssueDetail() {
  return useIssueDetailView();
}
