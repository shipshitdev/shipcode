import type {
  ActivityEntry,
  AppSettings,
  ExecutorModel,
  IntegrationStatus,
  NotificationRecord,
  OpenRouterModelValidation,
  PipelineCheckpoint,
  PipelinePhase,
  PlanRecord,
  Project,
  ReviewRecord,
  Thread,
  VerificationRecord,
} from '@shipcode/shared';
import {
  deriveGithubIssueUrl,
  resolveExecutorModelForIssue,
  resolvePhaseModel,
  resolvePhaseModelForIssue,
  resolvePhaseModelId,
} from '@shipcode/shared';
import {
  Archive,
  Badge,
  Button,
  ChevronLeft,
  cn,
  ExternalLink,
  Maximize2,
  Minimize2,
  PhaseChip,
  X,
} from '@shipcode/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../stores/app-store';
import { ACTIVE_PHASES, decodePhaseOption, encodePhaseOption } from './issue-detail/helpers';
import { IssueDetailActions } from './issue-detail/IssueDetailActions';
import { IssueDetailDialogs } from './issue-detail/IssueDetailDialogs';
import { IssueDetailTabs } from './issue-detail/IssueDetailTabs';

const INHERIT_EXECUTOR_VALUE = '__inherit__';
type IssueDetailTab = 'prd' | 'history' | 'pipeline' | 'activity';

export function IssueDetail({ expanded = false }: { expanded?: boolean }) {
  const queryClient = useQueryClient();
  const {
    activeIssue,
    activeThreadId,
    activeProjectId,
    selectIssue,
    pipelinePhase,
    openEditPrdModal,
    toggleIssueDetailExpanded,
  } = useAppStore();
  // undefined = untouched (auto-expand latest); null = user explicitly collapsed
  const [expandedPlanId, setExpandedPlanId] = useState<string | null | undefined>(undefined);
  const prevLatestPlanIdRef = useRef<string | null>(null);
  const [fullScreenPlanId, setFullScreenPlanId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [pendingAction, setPendingAction] = useState<'approve' | 'request_changes' | 'cancel'>(
    'approve',
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshingFromGithub, setIsRefreshingFromGithub] = useState(false);
  const [prdCollapsed, setPrdCollapsed] = useState(false);
  const [planHistoryCollapsed, setPlanHistoryCollapsed] = useState(false);
  const [showRawOutput, setShowRawOutput] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<IssueDetailTab>('prd');
  const [phaseModelValidation, setPhaseModelValidation] = useState<
    Partial<
      Record<'planner' | 'reviewer' | 'executor' | 'verifier', OpenRouterModelValidation | null>
    >
  >({});
  const [approveError, setApproveError] = useState<string | null>(null);

  // Shared cache with ProjectSidebar / Titlebar — no extra request.
  const { data: projects } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => window.shipcode.invoke('project:list'),
  });
  const activeProject =
    (Array.isArray(projects) ? projects : []).find((p) => p.id === activeProjectId) ?? null;
  const shouldPollThread =
    !!activeThreadId &&
    (ACTIVE_PHASES.includes(pipelinePhase as PipelinePhase) ||
      pipelinePhase === 'awaiting_approval' ||
      ACTIVE_PHASES.includes(activeIssue?.pipelineStatus as PipelinePhase));

  // Fetch thread data if issue is linked
  const { data: thread } = useQuery<Thread | null>({
    queryKey: ['thread', activeThreadId],
    queryFn: () => window.shipcode.invoke('thread:get', { threadId: activeThreadId }),
    enabled: !!activeThreadId,
    refetchInterval: shouldPollThread ? 2000 : false,
  });
  const currentPipelinePhase = thread?.status ?? pipelinePhase;
  const shouldPollLiveThread =
    !!activeThreadId &&
    (ACTIVE_PHASES.includes(currentPipelinePhase as PipelinePhase) ||
      currentPipelinePhase === 'awaiting_approval');
  const shouldLoadHistoryTab = activeTab === 'history';
  const shouldLoadActivityTab = activeTab === 'activity';
  const shouldLoadPipelineTab = activeTab === 'pipeline';

  // Fetch plan history
  const { data: planHistory } = useQuery<PlanRecord[]>({
    queryKey: ['plan-history', activeThreadId],
    queryFn: () => window.shipcode.invoke('plan:list', { threadId: activeThreadId }),
    enabled: !!activeThreadId,
    refetchInterval: shouldPollLiveThread ? 2000 : false,
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
    enabled: !!activeProjectId && !!activeIssue && shouldLoadHistoryTab,
    refetchInterval: shouldPollLiveThread && shouldLoadHistoryTab ? 2000 : false,
  });
  const isIssuePlanHistoryLoading =
    !!activeProjectId && !!activeIssue && issuePlanHistory === undefined;
  const normalizedIssuePlanHistory = Array.isArray(issuePlanHistory) ? issuePlanHistory : [];
  const normalizedPlanHistory =
    normalizedIssuePlanHistory.length > 0
      ? normalizedIssuePlanHistory
      : normalizedThreadPlanHistory;
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
    refetchInterval: shouldPollLiveThread && shouldLoadActivityTab ? 5000 : false,
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

  // Fetch reviews for all plans
  const planIds = normalizedPlanHistory.map((p) => p.id);
  const { data: reviewsByPlanId = {} } = useQuery<Record<string, ReviewRecord>>({
    queryKey: ['reviews-by-plans', planIds.join(',')],
    queryFn: () => window.shipcode.invoke('review:list-by-plans', { planIds }),
    enabled: planIds.length > 0,
    refetchInterval: shouldPollLiveThread ? 2000 : false,
  });
  const normalizedReviewsByPlanId =
    reviewsByPlanId && typeof reviewsByPlanId === 'object' ? reviewsByPlanId : {};

  const { data: settings } = useQuery<AppSettings | null>({
    queryKey: ['settings'],
    queryFn: () => window.shipcode.invoke('settings:get'),
  });

  const { data: integrationStatus } = useQuery<IntegrationStatus>({
    queryKey: ['integrations'],
    queryFn: () => window.shipcode.invoke('integrations:check'),
    staleTime: 30_000,
  });

  const { data: checkpoints = [] } = useQuery<PipelineCheckpoint[]>({
    queryKey: ['checkpoints', activeThreadId],
    queryFn: () => window.shipcode.invoke('checkpoint:list', { threadId: activeThreadId }),
    enabled: !!activeThreadId && shouldLoadPipelineTab,
    refetchInterval: shouldPollLiveThread && shouldLoadPipelineTab ? 2000 : false,
  });

  // Fetch latest verification for the thread
  const { data: latestVerification } = useQuery<VerificationRecord | null>({
    queryKey: ['verification', activeThreadId],
    queryFn: () => window.shipcode.invoke('verification:get', { threadId: activeThreadId }),
    enabled: !!activeThreadId && thread?.status === 'failed',
  });

  useEffect(() => {
    if (activeIssue?.id) {
      setPhaseModelValidation({});
      return;
    }
    setPhaseModelValidation({});
  }, [activeIssue?.id]);

  // Pick the right raw output based on which phase failed
  const failingPhaseOutput = (() => {
    if (!thread || thread.status !== 'failed')
      return normalizedThreadPlanHistory[0]?.rawOutput ?? null;
    // Verification failure — show verification output
    if (latestVerification?.rawOutput) return latestVerification.rawOutput;
    // Review failure — show review output for the latest plan
    const latestReview = normalizedThreadPlanHistory[0]?.id
      ? normalizedReviewsByPlanId[normalizedThreadPlanHistory[0].id]
      : null;
    if (latestReview?.rawOutput) return latestReview.rawOutput;
    // Fall back to plan output
    return normalizedThreadPlanHistory[0]?.rawOutput ?? null;
  })();

  // Auto-expand latest plan
  const latestPlanId = normalizedPlanHistory[0]?.id ?? null;
  const planRunCount = planRunGroups.length;
  const runNumberByThreadId = useMemo(
    () =>
      Object.fromEntries(
        planRunGroups.map((group) => [group.threadId, group.runNumber] as const),
      ) as Record<string, number>,
    [planRunGroups],
  );

  // When a new plan version arrives, auto-follow the new latest — but only
  // when the user was in auto mode or was already tracking the previous
  // latest. Preserves deliberate pins to older versions (e.g. a user
  // inspecting v2 while v4 is produced should not be yanked to v4).
  useEffect(() => {
    const prev = prevLatestPlanIdRef.current;
    if (!latestPlanId || latestPlanId === prev) return;
    setExpandedPlanId((current) => {
      if (current === undefined || current === prev) return undefined;
      return current;
    });
    prevLatestPlanIdRef.current = latestPlanId;
  }, [latestPlanId]);

  // Reset raw output toggle when switching threads so stale expanded state doesn't bleed across.
  useEffect(() => {
    if (activeThreadId) {
      setShowRawOutput(false);
      return;
    }
    setShowRawOutput(false);
  }, [activeThreadId]);

  // Dismiss any pending notifications for this thread when the user opens it.
  // Catches the "fired before navigation" case; useIpc.ts handles the
  // "fired while already viewing" case.
  useEffect(() => {
    if (!activeThreadId) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await window.shipcode.invoke<NotificationRecord[]>('notification:list');
        if (cancelled) return;
        // Only auto-dismiss informational kinds. 'awaiting_approval' requires
        // explicit user action (approve/reject) so we leave it in the inbox.
        const matching = list.filter(
          (n) => n.threadId === activeThreadId && n.kind !== 'awaiting_approval',
        );
        for (const n of matching) {
          await window.shipcode.invoke('notification:dismiss', { id: n.id });
        }
      } catch {
        // Best-effort.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeThreadId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (expanded) {
          // Collapse to panel first; preserve issue selection
          toggleIssueDetailExpanded();
        } else {
          selectIssue(null);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectIssue, expanded, toggleIssueDetailExpanded]);

  const effectiveExpanded = expandedPlanId === undefined ? latestPlanId : expandedPlanId;
  const latestPlan = useMemo(
    () => normalizedThreadPlanHistory[0] ?? null,
    [normalizedThreadPlanHistory],
  );
  const threadPhase = currentPipelinePhase;
  const canStartPipeline =
    !activeThreadId && !!activeProjectId && activeIssue?.pipelineStatus !== 'completed';
  const canRerun = !!activeIssue && activeIssue.pipelineStatus === 'failed' && !!activeProjectId;
  const hasApprovalDecision =
    !!activeThreadId && threadPhase === 'awaiting_approval' && !!latestPlan;
  const canApprove = hasApprovalDecision && !!(latestPlan?.structured || latestPlan?.rawOutput);

  if (!activeIssue) return null;

  const refreshIssueState = async () => {
    if (!activeProjectId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['threads', activeProjectId] }),
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

  const handleReject = async () => {
    if (!activeThreadId || !feedback.trim()) return;
    setIsSubmitting(true);
    try {
      await window.shipcode.invoke('pipeline:reject', {
        threadId: activeThreadId,
        feedback: feedback.trim(),
      });
      setFeedback('');
      setPendingAction('approve');
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

  const handleEditPrd = () => {
    if (!activeIssue) return;
    openEditPrdModal(activeIssue.issueNumber, activeIssue.body ?? '', activeIssue.labels);
  };

  const githubIssueUrl = activeIssue
    ? deriveGithubIssueUrl(activeProject?.gitRemote ?? null, activeIssue.issueNumber)
    : null;

  const handleOpenOnGithub = async () => {
    if (!githubIssueUrl) return;
    await window.shipcode.invoke('shell:open-external', { url: githubIssueUrl });
  };

  const handleRefreshFromGithub = async () => {
    if (!activeProjectId) return;
    setIsRefreshingFromGithub(true);
    try {
      await window.shipcode.invoke('github:refresh-issues', { projectId: activeProjectId });
      await queryClient.invalidateQueries({ queryKey: ['github-issues', activeProjectId] });
    } finally {
      setIsRefreshingFromGithub(false);
    }
  };

  // Executor is locked in once the pipeline is mid-loop. It's editable
  // before the run starts (todo/queued) and after terminal states where
  // the user will kick off a new run (failed/completed).
  const EXECUTOR_EDITABLE_STATUSES = new Set(['todo', 'queued', 'failed', 'completed']);
  const executorEditable = EXECUTOR_EDITABLE_STATUSES.has(activeIssue?.pipelineStatus ?? 'todo');
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
    planner: thread?.plannerResolvedModel ?? effectivePhaseProviders.planner,
    reviewer: thread?.reviewerResolvedModel ?? effectivePhaseProviders.reviewer,
    executor: thread?.executorResolvedModel ?? effectivePhaseProviders.executor,
    verifier: thread?.verifierResolvedModel ?? effectivePhaseProviders.verifier,
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
      `Restore checkpoint "${checkpoint.label}"?\n\nThis will hard-reset the worktree to ${checkpoint.commitSha.slice(0, 12)} and remove untracked files in that worktree.`,
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
    <div className="absolute right-3 top-3 flex items-center gap-0.5">
      {activeIssue.pipelineStatus === 'completed' && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted"
          onClick={() => setShowArchiveConfirm(true)}
          title="Archive issue"
        >
          <Archive size={13} />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-muted"
        onClick={toggleIssueDetailExpanded}
        title={expanded ? 'Collapse to panel' : 'Expand to full page'}
      >
        {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-muted"
        onClick={() => selectIssue(null)}
        title="Close"
      >
        <X size={15} strokeWidth={2.25} />
      </Button>
    </div>
  );

  const headerStatus =
    activeThreadId && threadPhase !== 'idle' ? threadPhase : activeIssue.pipelineStatus;
  const headerStatusAnimated =
    ACTIVE_PHASES.includes(threadPhase as PipelinePhase) || threadPhase === 'awaiting_approval';

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
        {isSubmitting ? 'START…' : 'PLAN'}
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
        {isSubmitting ? 'STOP…' : 'CANCEL'}
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
        {isSubmitting ? 'START…' : 'RETRY'}
      </Button>
    </span>
  ) : (
    issueStatusChip
  );

  const issueBadges = (
    <div className="flex flex-wrap gap-1.5">
      {activeIssue.assignee && (
        <Badge variant="default" className="text-[11px]">
          {activeIssue.assignee}
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
  const linkedPrUrl =
    activeIssue.linkedPrUrl ??
    (thread?.githubPrNumber && thread.githubRepo
      ? `https://github.com/${thread.githubRepo}/pull/${thread.githubPrNumber}`
      : null);
  const hasPrFeedbackBlockers =
    activeIssue.ciBlocked || activeIssue.unresolvedReviewCommentCount > 0;
  const fullScreenPlan = normalizedPlanHistory.find((plan) => plan.id === fullScreenPlanId) ?? null;
  const fullScreenReview = fullScreenPlan
    ? normalizedReviewsByPlanId[fullScreenPlan.id]
    : undefined;

  const { approvalSection, pipelineStartCard, rerunSection } = IssueDetailActions({
    approveError,
    canApprove,
    canRerun,
    canStartPipeline,
    failingPhaseOutput,
    feedback,
    hasApprovalDecision,
    isSubmitting,
    pendingAction,
    showRawOutput,
    thread,
    onApprove: () => void handleApprove(),
    onCancel: () => void handleCancel(),
    onEditPrd: handleEditPrd,
    onFeedbackChange: setFeedback,
    onMarkAsDone: () => void handleMarkAsDone(),
    onPendingActionChange: setPendingAction,
    onReject: () => void handleReject(),
    onRerun: () => void handleRerun(),
    onShowRawOutputChange: setShowRawOutput,
    onStartPipeline: () => void handleStartPipeline(),
  });

  const detailTabs = (
    <IssueDetailTabs
      activeIssue={activeIssue}
      activeTab={activeTab}
      activeThreadId={activeThreadId}
      checkpoints={checkpoints}
      currentPhaseSelections={currentPhaseSelections}
      effectiveExpanded={effectiveExpanded}
      effectivePhaseResolvedModels={effectivePhaseResolvedModels}
      executorEditable={executorEditable}
      expanded={expanded}
      hasPrFeedbackBlockers={hasPrFeedbackBlockers}
      integrationStatus={integrationStatus}
      isRefreshingFromGithub={isRefreshingFromGithub}
      isSubmitting={isSubmitting}
      linkedPrUrl={linkedPrUrl}
      normalizedIssueActivity={normalizedIssueActivity}
      normalizedPlanHistory={normalizedPlanHistory}
      normalizedReviewsByPlanId={normalizedReviewsByPlanId}
      normalizedThreadPlanHistory={normalizedThreadPlanHistory}
      isPlanHistoryLoading={isPlanHistoryLoading}
      phaseModelValidation={phaseModelValidation}
      phaseSelectValues={phaseSelectValues}
      planHistoryCollapsed={planHistoryCollapsed}
      planRunCount={planRunCount}
      planRunGroups={planRunGroups}
      prdCollapsed={prdCollapsed}
      projectDefaultPhaseSelections={projectDefaultPhaseSelections}
      runNumberByThreadId={runNumberByThreadId}
      thread={thread}
      threadPhase={threadPhase}
      onEditPrd={handleEditPrd}
      onActiveTabChange={setActiveTab}
      onFullScreenPlan={setFullScreenPlanId}
      onPhaseAgentChange={(phase, value) => {
        void handlePhaseAgentChange(phase, value);
      }}
      onPhaseOpenRouterSlugBlur={(phase, value) => {
        void handlePhaseOpenRouterSlugBlur(phase, value);
      }}
      onPlanExpandedChange={setExpandedPlanId}
      onPlanHistoryCollapsedChange={setPlanHistoryCollapsed}
      onPrdCollapsedChange={setPrdCollapsed}
      onRefreshFromGithub={() => {
        void handleRefreshFromGithub();
      }}
      onRestoreCheckpoint={(checkpoint) => {
        void handleRestoreCheckpoint(checkpoint);
      }}
      onStabilizePr={() => {
        void handleStabilizePr();
      }}
    />
  );

  const detailDialogs = (
    <IssueDetailDialogs
      activeIssueNumber={activeIssue.issueNumber}
      canApprove={canApprove}
      fullScreenPlan={fullScreenPlan}
      fullScreenPlanId={fullScreenPlanId}
      fullScreenReview={fullScreenReview}
      isSubmitting={isSubmitting}
      latestPlanId={latestPlan?.id ?? null}
      onApprove={() => {
        void handleApprove();
      }}
      onArchiveConfirmed={handleArchiveConfirmed}
      onCloseArchiveConfirm={() => setShowArchiveConfirm(false)}
      onCloseFullScreenPlan={() => setFullScreenPlanId(null)}
      showArchiveConfirm={showArchiveConfirm}
    />
  );

  // ─── Expanded (full-page) layout ────────────────────────────────────────

  if (expanded) {
    return (
      <div className="flex h-full bg-primary">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Header */}
          <div className="relative shrink-0 border-b border-border p-4">
            {headerButtons}
            <Button
              variant="ghost"
              size="xs"
              onClick={toggleIssueDetailExpanded}
              className="mb-2 h-auto gap-1 px-0 text-xs font-normal text-muted hover:bg-transparent"
            >
              <ChevronLeft size={12} />
              Back to board
            </Button>
            <div className="flex items-center gap-2 pr-16">
              <span className="font-mono text-xs text-muted">#{activeIssue.issueNumber}</span>
              {githubIssueUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleOpenOnGithub}
                  className="h-6 gap-1 text-[11px]"
                  title="Open this issue on github.com"
                >
                  View on GitHub <ExternalLink size={12} />
                </Button>
              )}
            </div>
            <div className="my-1 flex flex-wrap items-center gap-2 pr-16">
              {issueStatusBadge}
              <h1 className="text-xl font-semibold">{activeIssue.title}</h1>
            </div>
            {issueBadges}
          </div>
          {pipelineStartCard && (
            <div className="shrink-0 border-b border-border px-6 py-4">{pipelineStartCard}</div>
          )}
          {rerunSection && (
            <div className="shrink-0 border-b border-border px-6 py-4">{rerunSection}</div>
          )}
          {approvalSection && (
            <div className="shrink-0 border-b border-border px-6 py-4">{approvalSection}</div>
          )}

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto p-6">{detailTabs}</div>
        </div>
        {detailDialogs}
      </div>
    );
  }

  // ─── Panel (default) layout ──────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col overflow-hidden bg-primary">
      {/* Header */}
      <div className="relative shrink-0 border-b border-border p-4">
        {headerButtons}
        <div className="flex items-center gap-2 pr-16">
          <span className="font-mono text-xs text-muted">#{activeIssue.issueNumber}</span>
          {githubIssueUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpenOnGithub}
              className="h-6 gap-1 text-[11px]"
              title="Open this issue on github.com"
            >
              View on GitHub <ExternalLink size={12} />
            </Button>
          )}
        </div>
        <div className="my-1 flex flex-wrap items-center gap-2 pr-16">
          {issueStatusBadge}
          <h3 className="text-[15px] font-semibold">{activeIssue.title}</h3>
        </div>
        {issueBadges}
      </div>

      {/* Phase stepper — shown once pipeline has started */}
      {/* Primary CTAs — above tabs, always visible */}
      {pipelineStartCard && <div className="shrink-0 p-4 pb-0">{pipelineStartCard}</div>}
      {rerunSection && <div className="shrink-0 px-4 pt-4">{rerunSection}</div>}
      {approvalSection && <div className="shrink-0 px-4 pt-4">{approvalSection}</div>}

      {/* Tabbed content — min-h-0 required for flex scroll containment */}
      <div className="flex-1 min-h-0 overflow-y-auto">{detailTabs}</div>

      {/* Portal-based dialog — outside tabs to avoid unmount on tab switch */}
      {detailDialogs}
    </div>
  );
}
