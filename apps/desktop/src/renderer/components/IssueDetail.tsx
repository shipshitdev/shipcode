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
  deriveGithubIssueUrl,
  formatIssueBranch,
  ISSUE_PIPELINE_STATUS,
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
  sanitizeResolvedModel,
} from '@shipcode/shared';
import { isAutomationIssue, PhaseChip, resolveIssuePriorityBadge } from '@shipcode/ui';
import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shipshitdev/ui';
import { LoadingButtonContent } from '@shipshitdev/ui/common';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, Check, CircleCheck, CircleDot, Copy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';
import { CostsTab } from './issue-detail/CostsTab';
import {
  ACTIVE_PHASES,
  decodePhaseOption,
  encodePhaseOption,
  resolveFailingPhaseOutput,
} from './issue-detail/helpers';
import { IssueDetailActions } from './issue-detail/IssueDetailActions';
import { IssueDetailDialogs } from './issue-detail/IssueDetailDialogs';
import { IssueDetailTabs } from './issue-detail/IssueDetailTabs';
import { PipelineTab } from './issue-detail/PipelineTab';
import type { IssueDetailTab } from './issue-detail/tab-types';

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
  ISSUE_PIPELINE_STATUS.done,
]);

export function IssueDetail() {
  const queryClient = useQueryClient();
  const activeIssue = useAppStore((state) => state.activeIssue);
  const activeThreadId = useAppStore((state) => state.activeThreadId);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const selectIssue = useAppStore((state) => state.selectIssue);
  const pipelinePhase = useAppStore((state) => state.pipelinePhase);
  const commentComposerRequest = useAppStore((state) => state.commentComposerRequest);
  const openEditPrdModal = useAppStore((state) => state.openEditPrdModal);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const prevIssueSelectionKeyRef = useRef<string | null>(null);
  const [fullScreenPlanId, setFullScreenPlanId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshingFromGithub, setIsRefreshingFromGithub] = useState(false);
  const [isTogglingState, setIsTogglingState] = useState(false);
  const [planHistoryCollapsed, setPlanHistoryCollapsed] = useState(false);
  const [showAllPlanRuns, setShowAllPlanRuns] = useState(false);
  const [showRawOutput, setShowRawOutput] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showMarkAsDoneConfirm, setShowMarkAsDoneConfirm] = useState(false);
  const [branchCopyState, setBranchCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const branchCopyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (branchCopyResetRef.current) clearTimeout(branchCopyResetRef.current);
    };
  }, []);
  const [activeTab, setActiveTab] = useState<IssueDetailTab>('prd');
  const [phaseModelValidation, setPhaseModelValidation] = useState<
    Partial<
      Record<'planner' | 'reviewer' | 'executor' | 'verifier', OpenRouterModelValidation | null>
    >
  >({});
  const [approveError, setApproveError] = useState<string | null>(null);

  // Shared cache with ProjectSidebar / Titlebar — no extra request.
  const { data: activeProject } = useQuery<Project | null>({
    queryKey: ['project', activeProjectId],
    queryFn: () => {
      if (!activeProjectId) {
        throw new Error('Missing active project id');
      }
      return window.shipcode.invoke('project:get', { projectId: activeProjectId });
    },
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
      currentPipelinePhase === PIPELINE_PHASE.awaitingApproval);
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
    queryFn: () => {
      if (!activeProjectId || !activeIssue) {
        throw new Error('Missing issue context for plan history');
      }
      return window.shipcode.invoke('plan:list-for-issue', {
        projectId: activeProjectId,
        issueNumber: activeIssue.issueNumber,
      });
    },
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
    queryFn: () => {
      if (!activeProjectId || !activeIssue) {
        throw new Error('Missing issue context for activity');
      }
      return window.shipcode.invoke('activity:list-for-issue', {
        projectId: activeProjectId,
        issueNumber: activeIssue.issueNumber,
        limit: 200,
      });
    },
    enabled: !!activeProjectId && !!activeIssue && shouldLoadActivityTab,
    refetchInterval: shouldPollLiveThread && shouldLoadActivityTab ? 60_000 : false,
  });
  const normalizedIssueActivity = Array.isArray(issueActivity) ? issueActivity : [];
  const planRunGroups = useMemo(() => {
    const groupedRuns: Array<{ threadId: string; plans: PlanRecord[] }> = [];
    for (const plan of normalizedPlanHistory) {
      const existingGroup = groupedRuns.find((group) => group.threadId === plan.threadId);
      if (existingGroup) {
        existingGroup.plans.push(plan);
        continue;
      }
      groupedRuns.push({ threadId: plan.threadId, plans: [plan] });
    }
    const totalRuns = groupedRuns.length;
    return groupedRuns.map((group, index) => ({
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
      if (!activeThreadId) throw new Error('Missing active thread id');
      const graph = await window.shipcode.invoke('task-graph:get-latest', {
        threadId: activeThreadId,
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

  useEffect(() => {
    if (activeIssue?.id) {
      setPhaseModelValidation({});
      return;
    }
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
      queryFn: () => {
        if (!expandedHistoryPlan?.id) {
          throw new Error('Missing plan id for expanded history detail');
        }
        return window.shipcode.invoke('plan:get-by-id', { planId: expandedHistoryPlan.id });
      },
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
      queryFn: () => {
        if (!fullScreenPlanBase?.id) {
          throw new Error('Missing plan id for full-screen history detail');
        }
        return window.shipcode.invoke('plan:get-by-id', { planId: fullScreenPlanBase.id });
      },
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

  // Reset raw output toggle when switching threads so stale expanded state doesn't bleed across.
  useEffect(() => {
    if (activeThreadId) {
      setShowRawOutput(false);
      return;
    }
    setShowRawOutput(false);
  }, [activeThreadId]);

  useEffect(() => {
    if (prevIssueSelectionKeyRef.current === issueSelectionKey) return;
    prevIssueSelectionKeyRef.current = issueSelectionKey;
    setActiveTab('prd');
    setExpandedPlanId(null);
    setShowAllPlanRuns(false);
  }, [issueSelectionKey]);

  useEffect(() => {
    if (!activeIssue || commentComposerRequest?.issueId !== activeIssue.id) return;
    setActiveTab('comments');
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
    activeIssue?.pipelineStatus !== ISSUE_PIPELINE_STATUS.done;
  const canRerun =
    !!activeIssue &&
    activeIssue.pipelineStatus === ISSUE_PIPELINE_STATUS.failed &&
    !!activeProjectId;
  const approvedAwaitingExecution =
    !!activeThreadId &&
    threadPhase === PIPELINE_PHASE.awaitingApproval &&
    latestPlan?.status === 'approved';
  const hasApprovalDecision =
    !!activeThreadId &&
    threadPhase === PIPELINE_PHASE.awaitingApproval &&
    !!latestPlan &&
    latestPlan.status !== 'approved';
  const canApprove = hasApprovalDecision && !!(latestPlan?.structured || latestPlan?.rawOutput);
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
      await window.shipcode.invoke('github:close-issue', {
        projectId: activeProjectId,
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
    setShowAllPlanRuns(show);
    if (!show) {
      setExpandedPlanId(null);
    }
  };

  const handleApprove = async () => {
    if (!activeThreadId || !canApprove) return;
    setIsSubmitting(true);
    setApproveError(null);
    try {
      await window.shipcode.invoke('pipeline:approve', { threadId: activeThreadId });
      await refreshIssueState();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setApproveError(msg.split('\n')[0].slice(0, 280));
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

  const handlePhaseAgentChange = async (
    phase: 'planner' | 'reviewer' | 'executor' | 'verifier',
    value: string,
  ) => {
    if (!activeProjectId || !activeIssue) return;
    if (value === INHERIT_EXECUTOR_VALUE) {
      await window.shipcode.invoke('github:clear-phase-model-override', {
        projectId: activeProjectId,
        issueNumber: activeIssue.issueNumber,
        phase,
      });
      await window.shipcode.invoke('github:clear-phase-model-id-override', {
        projectId: activeProjectId,
        issueNumber: activeIssue.issueNumber,
        phase,
      });
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
    if (!activeIssue) return;
    openEditPrdModal(activeIssue.issueNumber, activeIssue.body ?? '', activeIssue.labels);
  };

  const githubIssueUrl =
    activeIssue && !activeIssue.isQuickMode && !isAutomationIssue(activeIssue)
      ? deriveGithubIssueUrl(activeProject?.gitRemote ?? null, activeIssue.issueNumber)
      : null;

  const handleOpenOnGithub = async () => {
    if (!githubIssueUrl) return;
    await window.shipcode.invoke('shell:open-external', { url: githubIssueUrl });
  };
  const issueBranchName =
    activeIssue && !isAutomationIssue(activeIssue)
      ? formatIssueBranch(
          activeIssue.issueNumber,
          activeIssue.title ?? '',
          settings?.worktreeBranchFormat ?? null,
        )
      : null;
  const handleCopyBranchName = async () => {
    if (!issueBranchName) return;
    if (branchCopyResetRef.current) clearTimeout(branchCopyResetRef.current);
    try {
      await navigator.clipboard.writeText(issueBranchName);
      setBranchCopyState('copied');
    } catch {
      setBranchCopyState('error');
    }
    branchCopyResetRef.current = setTimeout(() => setBranchCopyState('idle'), 1500);
  };
  const handleOpenPullRequest = async () => {
    if (!linkedPrUrl) return;
    await window.shipcode.invoke('shell:open-external', { url: linkedPrUrl });
  };

  const handleToggleIssueState = async (newState: 'open' | 'closed') => {
    if (!activeProjectId || !activeIssue || activeIssue.state === newState) return;
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
  const executorEditable = EXECUTOR_EDITABLE_STATUSES.has(
    activeIssue?.pipelineStatus ?? ISSUE_PIPELINE_STATUS.todo,
  );
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
  const effectivePhaseResolvedModels = {
    planner: sanitizeResolvedModel(thread?.plannerResolvedModel) ?? effectivePhaseProviders.planner,
    reviewer:
      sanitizeResolvedModel(thread?.reviewerResolvedModel) ?? effectivePhaseProviders.reviewer,
    executor:
      sanitizeResolvedModel(thread?.executorResolvedModel) ?? effectivePhaseProviders.executor,
    verifier:
      sanitizeResolvedModel(thread?.verifierResolvedModel) ?? effectivePhaseProviders.verifier,
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
  const effectiveRevisionCount =
    settings && activeIssue
      ? resolveRevisionCountForIssue(settings, activeProject, activeIssue)
      : inheritedRevisionCount;
  const inheritedRequireApproval = settings
    ? resolveRequireApproval(settings, activeProject)
    : false;
  const effectiveRequireApproval =
    settings && activeIssue
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
    if (!activeProjectId || !activeIssue) return;
    window.shipcode
      .invoke('github:archive-issue', {
        projectId: activeProjectId,
        issueNumber: activeIssue.issueNumber,
      })
      .then(() => {
        setShowArchiveConfirm(false);
        selectIssue(null);
        queryClient.invalidateQueries({ queryKey: ['github-issues', activeProjectId] });
      })
      .catch((err: Error) => {
        setShowArchiveConfirm(false);
        window.alert(`Failed to archive issue: ${err?.message ?? err}`);
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
          size="icon-sm"
          className="text-muted"
          onClick={() => selectIssue(null)}
          title="Back to board"
          aria-label="Back to board"
        >
          <ArrowLeft size={18} strokeWidth={2.5} />
        </Button>
      </div>
      {/* Archive button — top right */}
      {(activeIssue.pipelineStatus === ISSUE_PIPELINE_STATUS.completed ||
        activeIssue.pipelineStatus === ISSUE_PIPELINE_STATUS.done) && (
        <div className="absolute right-3 top-3">
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted"
            onClick={() => setShowArchiveConfirm(true)}
            title="Archive issue"
          >
            <Archive size={14} />
          </Button>
        </div>
      )}
    </>
  );

  const headerStatus =
    activeThreadId && threadPhase !== PIPELINE_PHASE.idle
      ? threadPhase
      : activeIssue.pipelineStatus;
  const headerStatusAnimated =
    ACTIVE_PHASES.includes(threadPhase as PipelinePhase) ||
    threadPhase === PIPELINE_PHASE.awaitingApproval;

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
        className="absolute inset-0 h-auto rounded px-1.5 py-0.5 text-[10px] font-medium text-danger/70 opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
        title="Cancel pipeline"
        onClick={handleCancel}
        disabled={isSubmitting}
      >
        <LoadingButtonContent loading={isSubmitting} className="gap-1" spinnerSize={10}>
          CANCEL
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
  const dot = <span className="mx-1.5 text-border">·</span>;
  const issueIdentityLinks = (
    <div className="mt-1 flex flex-wrap items-center pl-10 text-[11px]">
      {/* Issue number */}
      {activeIssue.isQuickMode ? (
        <span className="font-mono text-muted">Quick</span>
      ) : isAutomationIssue(activeIssue) ? (
        <span className="font-mono text-muted">[Auto]</span>
      ) : githubIssueUrl ? (
        <button
          type="button"
          onClick={handleOpenOnGithub}
          className="font-mono text-muted transition-colors hover:text-primary"
          title="Open this issue on GitHub"
        >
          #{activeIssue.issueNumber}
        </button>
      ) : (
        <span className="font-mono text-muted">#{activeIssue.issueNumber}</span>
      )}

      {/* State — open/closed dropdown */}
      {!isAutomationIssue(activeIssue) && (
        <>
          {dot}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  'flex items-center gap-1 font-medium transition-colors disabled:opacity-50',
                  activeIssue.state === 'open' ? 'text-success' : 'text-muted hover:text-primary',
                )}
                disabled={isTogglingState}
              >
                {activeIssue.state === 'open' ? (
                  <CircleDot className="h-3 w-3" />
                ) : (
                  <CircleCheck className="h-3 w-3" />
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
                <CircleDot className="mr-2 h-3.5 w-3.5 text-success" />
                Reopen issue
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={activeIssue.state === 'closed'}
                onClick={() => void handleToggleIssueState('closed')}
              >
                <CircleCheck className="mr-2 h-3.5 w-3.5 text-muted" />
                Close issue
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      {/* Branch name — copy on click */}
      {issueBranchName && (
        <>
          {dot}
          <button
            type="button"
            onClick={() => void handleCopyBranchName()}
            className={cn(
              'flex items-center gap-1 font-mono transition-colors',
              branchCopyState === 'copied'
                ? 'text-success'
                : branchCopyState === 'error'
                  ? 'text-danger'
                  : 'text-muted hover:text-primary',
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
              <Check className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            <span className="max-w-[20ch] truncate">{issueBranchName}</span>
          </button>
        </>
      )}

      {/* PR link */}
      {activeIssue.linkedPrNumber && (
        <>
          {dot}
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
      {activeIssue.labels
        .filter((l) => l.startsWith('agent:'))
        .map((l) => (
          <Badge key={l} className="text-[10px] bg-accent/15 text-accent">
            {l}
          </Badge>
        ))}
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
  } = IssueDetailActions({
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
      effectivePhaseResolvedModels={effectivePhaseResolvedModels}
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
      onActiveTabChange={setActiveTab}
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
      onPlanExpandedChange={(planId) => setExpandedPlanId(planId ?? null)}
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

  const detailDialogs = (
    <IssueDetailDialogs
      activeIssueNumber={activeIssue.issueNumber}
      canApprove={canApprove}
      fullScreenPlan={fullScreenPlan}
      fullScreenPlanId={fullScreenPlanId}
      fullScreenReview={fullScreenReview}
      isFullScreenPlanLoading={
        shouldFetchFullScreenPlanDetail && isFullScreenPlanDetailLoading && !!fullScreenPlanId
      }
      isSubmitting={isSubmitting}
      latestPlanId={latestPlan?.id ?? null}
      onApprove={() => {
        void handleApprove();
      }}
      onArchiveConfirmed={handleArchiveConfirmed}
      onCloseArchiveConfirm={() => setShowArchiveConfirm(false)}
      onCloseFullScreenPlan={() => setFullScreenPlanId(null)}
      onMarkAsDoneConfirmed={() => {
        setShowMarkAsDoneConfirm(false);
        void handleMarkAsDone();
      }}
      onCloseMarkAsDoneConfirm={() => setShowMarkAsDoneConfirm(false)}
      showArchiveConfirm={showArchiveConfirm}
      showMarkAsDoneConfirm={showMarkAsDoneConfirm}
    />
  );

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
        {/* Sidebar — full height, own scroll */}
        <div className="w-[26rem] shrink-0 overflow-y-auto border-l border-border">
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
              effectivePhaseResolvedModels={effectivePhaseResolvedModels}
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
