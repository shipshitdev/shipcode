import type {
  ActivePipelineSummary,
  AppSettings,
  ExecutorModel,
  IntegrationStatus,
  PipelineCheckpoint,
  NotificationRecord,
  OpenRouterModelValidation,
  PipelinePhase,
  PlanRecord,
  Project,
  ReviewRecord,
  ShipCodePlan,
  Thread,
  VerificationRecord,
} from '@shipcode/shared';
import {
  deriveGithubIssueUrl,
  resolveExecutorModelForIssue,
  resolvePhaseModel,
  resolvePhaseModelId,
  resolvePhaseModelForIssue,
  shipCodePlanSchema,
} from '@shipcode/shared';
import {
  Archive,
  Badge,
  Button,
  cn,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Input,
  Modal,
  ModalFooter,
  ExternalLink,
  getStatusBadgeVariant,
  Maximize2,
  Minimize2,
  MODEL_DISPLAY,
  Pencil,
  PhaseChip,
  PlanViewer,
  RefreshCw,
  ReviewViewer,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  X,
} from '@shipcode/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppStore } from '../stores/app-store';


const ACTIVE_PHASES: PipelinePhase[] = [
  'planning',
  'reviewing',
  'revising',
  'executing',
  'testing',
  'verifying',
  'shipping',
];

const PIPELINE_PREVIEW_PHASES = [
  { id: 'plan', label: 'Plan' },
  { id: 'review', label: 'Review' },
  { id: 'execute', label: 'Execute' },
  { id: 'test', label: 'Test' },
  { id: 'verify', label: 'Verify' },
  { id: 'ship', label: 'Ship' },
] as const;

const INHERIT_EXECUTOR_VALUE = '__inherit__';
const PROVIDER_DISPLAY: Record<ExecutorModel, string> = {
  claude: 'Anthropic',
  codex: 'OpenAI',
  openrouter: 'OpenRouter',
};
const CLAUDE_MODELS = [
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
] as const;
const CODEX_MODELS = [
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
] as const;
const OPENROUTER_MODELS = [
  { value: 'openrouter/auto', label: 'Auto (paid)' },
  { value: 'openrouter/free', label: 'Auto (free)' },
  { value: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'qwen/qwen3.6-plus', label: 'Qwen 3.6 Plus' },
  { value: 'qwen/qwen3-coder:free', label: 'Qwen 3 Coder Free' },
] as const;
const PHASE_PROVIDER_OPTIONS: Record<
  'planner' | 'reviewer' | 'executor' | 'verifier',
  ExecutorModel[]
> = {
  planner: ['claude', 'codex', 'openrouter'],
  reviewer: ['claude', 'codex', 'openrouter'],
  executor: ['claude', 'codex', 'openrouter'],
  verifier: ['claude', 'codex', 'openrouter'],
};

function getModelOptions(provider: ExecutorModel) {
  if (provider === 'claude') return CLAUDE_MODELS;
  if (provider === 'codex') return CODEX_MODELS;
  return OPENROUTER_MODELS;
}

function formatProviderSelectionLabel(
  provider: ExecutorModel,
  modelId: string | null,
): string {
  const providerLabel = PROVIDER_DISPLAY[provider];
  const modelLabel = modelId
    ? getModelOptions(provider).find((option) => option.value === modelId)?.label ?? modelId
    : `${providerLabel} default`;
  return `${providerLabel} / ${modelLabel}`;
}

type PlanStatusBadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

function getPlanStatusPresentation(plan: PlanRecord, review?: ReviewRecord): {
  label: string;
  phaseStatus: PipelinePhase | 'idle';
  usePhaseChip: boolean;
} {
  switch (plan.status) {
    case 'approved':
      return {
        label: 'AI approved',
        phaseStatus: 'completed',
        usePhaseChip: true,
      };
    case 'rejected':
      if (review?.decision === 'request_changes') {
        return {
          label: 'AI requested changes',
          phaseStatus: 'revising',
          usePhaseChip: true,
        };
      }
      return {
        label: 'AI rejected',
        phaseStatus: 'failed',
        usePhaseChip: true,
      };
    case 'superseded':
      return {
        label: 'Superseded',
        phaseStatus: 'idle',
        usePhaseChip: false,
      };
    case 'pending_review':
      return {
        label: 'AI reviewing',
        phaseStatus: 'reviewing',
        usePhaseChip: true,
      };
    default:
      return {
        label: 'Plan drafted',
        phaseStatus: 'planning',
        usePhaseChip: true,
      };
  }
}

function getReviewDecisionPresentation(
  review: ReviewRecord,
  threadPhase: PipelinePhase | 'idle',
): {
  label: string;
  badgeVariant: PlanStatusBadgeVariant;
} {
  if (review.decision === 'approve') {
    return { label: 'Approved', badgeVariant: 'success' };
  }
  if (review.decision === 'request_changes') {
    return {
      label: 'Changes requested',
      badgeVariant: threadPhase === 'awaiting_approval' ? 'warning' : 'accent',
    };
  }
  return {
    label: 'Rejected',
    badgeVariant: threadPhase === 'awaiting_approval' ? 'warning' : 'danger',
  };
}

function InheritValueDisplay({ detail }: { detail: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1 truncate">
      <span className="text-muted">Inherit</span>
      <span className="text-muted">·</span>
      <span className="truncate text-primary">{detail}</span>
    </span>
  );
}

function encodePhaseOption(provider: ExecutorModel, modelId: string | null) {
  return `${provider}::${modelId ?? '__default__'}`;
}

function decodePhaseOption(value: string): { provider: ExecutorModel; modelId: string | null } {
  const [providerRaw, modelIdRaw] = value.split('::');
  const provider =
    providerRaw === 'claude' || providerRaw === 'codex' || providerRaw === 'openrouter'
      ? providerRaw
      : 'claude';
  return { provider, modelId: modelIdRaw === '__default__' ? null : modelIdRaw };
}

// `deriveGithubIssueUrl` + related helpers live in `@shipcode/shared/github-url`
// so the Kanban toolbar, IssueDetail, and any future consumer share one parser.

function resolveRawPlanText(raw: string): string {
  const lines = raw.split('\n');
  // Claude --output-format stream-json: the final result line carries the LLM text
  for (let i = lines.length - 1; i >= 0; i--) {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI codes
    const line = lines[i].replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'result') {
        if (typeof parsed.result === 'string') return parsed.result;
        // Extended thinking: result is an array of content blocks
        if (Array.isArray(parsed.result)) {
          const text = parsed.result
            .filter((b: { type: string }) => b.type === 'text')
            .map((b: { text: string }) => b.text)
            .join('\n');
          if (text) return text;
        }
      }
    } catch {}
  }
  // Codex --json: join agent_message texts
  const agentTexts: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      const parsed = JSON.parse(t);
      if (
        parsed.type === 'item.completed' &&
        parsed.item?.type === 'agent_message' &&
        typeof parsed.item.text === 'string'
      ) {
        agentTexts.push(parsed.item.text);
      }
    } catch {
      /* skip */
    }
  }
  if (agentTexts.length > 0) return agentTexts.join('\n\n');
  return raw;
}

/** Try to extract and validate a ShipCodePlan from raw pipeline output.
 * Used client-side to render old plans where `structured` was never stored. */
function resolveClientSidePlan(rawOutput: string): ShipCodePlan | null {
  const text = resolveRawPlanText(rawOutput);
  const match = text.match(/```shipcode-plan[^\n]*\n([\s\S]*?)\n```/m);
  if (!match) return null;
  try {
    return shipCodePlanSchema.parse(JSON.parse(match[1].trim()));
  } catch {
    return null;
  }
}

const PRD_PROSE_CLASSES =
  'space-y-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-secondary [&_code]:rounded [&_code]:bg-tertiary [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:whitespace-pre-wrap [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-tertiary [&_pre]:p-3 [&_pre]:text-xs [&_ul]:list-disc [&_ul]:pl-5';

function PlanWaiting({ threadId }: { threadId: string }) {
  const lastActivity = useAppStore((s) => s.lastActivityByThread[threadId]);
  const [, tick] = useState(0);

  const { data: running = [] } = useQuery<ActivePipelineSummary[]>({
    queryKey: ['dashboard', 'running'],
    queryFn: () => window.shipcode.invoke<ActivePipelineSummary[]>('pipeline:list-active'),
    refetchInterval: 2000,
  });

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const startedAt = running.find((p) => p.threadId === threadId)?.startedAt;
  const sinceStart = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : null;
  const sinceOutput = lastActivity ? Math.floor((Date.now() - lastActivity) / 1000) : sinceStart;
  const stale = (sinceOutput ?? 0) >= 90;

  function fmt(s: number) {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  return (
    <div className="mb-5 py-4 text-center text-[13px]">
      <p className="text-muted">
        Waiting for plan generation
        {sinceStart !== null && (
          <> &mdash; <span className="tabular-nums">{fmt(sinceStart)}</span></>
        )}
      </p>
      {lastActivity && !stale && sinceOutput !== null && (
        <p className="mt-1 text-[11px] text-muted opacity-60">
          Last output: {fmt(sinceOutput)} ago
        </p>
      )}
      {stale && sinceOutput !== null && (
        <p className="mt-2 text-[11px] text-warning">
          No output in {fmt(sinceOutput)} &mdash; the model may be slow or stalled. Open the
          terminal to diagnose, or cancel and retry.
        </p>
      )}
    </div>
  );
}

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
  const [phaseModelValidation, setPhaseModelValidation] = useState<
    Partial<
      Record<'planner' | 'reviewer' | 'executor' | 'verifier', OpenRouterModelValidation | null>
    >
  >({});

  function safeErrorMessage(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{')) return trimmed;
    for (const line of trimmed.split('\n').reverse()) {
      try {
        const obj = JSON.parse(line.trim()) as Record<string, unknown>;
        if (obj.type === 'result' && typeof obj.result === 'string') return (obj.result as string).slice(0, 280);
        if (typeof obj.error === 'string') return (obj.error as string).slice(0, 280);
        if (
          obj.type === 'result' &&
          Array.isArray(obj.errors) &&
          obj.errors.length > 0 &&
          typeof obj.errors[0] === 'string'
        )
          return (obj.errors[0] as string).slice(0, 280);
      } catch { /* skip */ }
    }
    return 'Pipeline failed — see devtools console for full trace.';
  }
  const [approveError, setApproveError] = useState<string | null>(null);

  // Shared cache with ProjectSidebar / Titlebar — no extra request.
  const { data: projects } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => window.shipcode.invoke('project:list'),
  });
  const activeProject =
    (Array.isArray(projects) ? projects : []).find((p) => p.id === activeProjectId) ?? null;

  // Fetch thread data if issue is linked
  const { data: thread } = useQuery<Thread | null>({
    queryKey: ['thread', activeThreadId],
    queryFn: () => window.shipcode.invoke('thread:get', { threadId: activeThreadId }),
    enabled: !!activeThreadId,
    refetchInterval: activeThreadId ? 2000 : false,
  });

  // Fetch plan history
  const { data: planHistory = [] } = useQuery<PlanRecord[]>({
    queryKey: ['plan-history', activeThreadId],
    queryFn: () => window.shipcode.invoke('plan:list', { threadId: activeThreadId }),
    enabled: !!activeThreadId,
    refetchInterval: activeThreadId ? 2000 : false,
  });
  const normalizedThreadPlanHistory = Array.isArray(planHistory) ? planHistory : [];

  const { data: issuePlanHistory = [] } = useQuery<PlanRecord[]>({
    queryKey: ['issue-plan-history', activeProjectId, activeIssue?.issueNumber],
    queryFn: () =>
      window.shipcode.invoke('plan:list-for-issue', {
        projectId: activeProjectId!,
        issueNumber: activeIssue!.issueNumber,
      }),
    enabled: !!activeProjectId && !!activeIssue,
    refetchInterval: activeThreadId ? 2000 : false,
  });
  const normalizedIssuePlanHistory = Array.isArray(issuePlanHistory) ? issuePlanHistory : [];
  const normalizedPlanHistory =
    normalizedIssuePlanHistory.length > 0 ? normalizedIssuePlanHistory : normalizedThreadPlanHistory;

  // Fetch reviews for all plans
  const planIds = normalizedPlanHistory.map((p) => p.id);
  const { data: reviewsByPlanId = {} } = useQuery<Record<string, ReviewRecord>>({
    queryKey: ['reviews-by-plans', planIds.join(',')],
    queryFn: () => window.shipcode.invoke('review:list-by-plans', { planIds }),
    enabled: planIds.length > 0,
    refetchInterval: activeThreadId ? 2000 : false,
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
    enabled: !!activeThreadId,
    refetchInterval: activeThreadId ? 2000 : false,
  });

  // Fetch latest verification for the thread
  const { data: latestVerification } = useQuery<VerificationRecord | null>({
    queryKey: ['verification', activeThreadId],
    queryFn: () => window.shipcode.invoke('verification:get', { threadId: activeThreadId }),
    enabled: !!activeThreadId && thread?.status === 'failed',
  });

  useEffect(() => {
    setPhaseModelValidation({});
  }, [activeIssue?.id]);

  // Pick the right raw output based on which phase failed
  const failingPhaseOutput = (() => {
    if (!thread || thread.status !== 'failed') return normalizedPlanHistory[0]?.rawOutput ?? null;
    // Verification failure — show verification output
    if (latestVerification?.rawOutput) return latestVerification.rawOutput;
    // Review failure — show review output for the latest plan
    const latestReview = normalizedPlanHistory[0]?.id
      ? normalizedReviewsByPlanId[normalizedPlanHistory[0].id]
      : null;
    if (latestReview?.rawOutput) return latestReview.rawOutput;
    // Fall back to plan output
    return normalizedPlanHistory[0]?.rawOutput ?? null;
  })();

  // Auto-expand latest plan
  const latestPlanId = normalizedPlanHistory[0]?.id ?? null;

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
  const latestPlan = useMemo(() => normalizedPlanHistory[0] ?? null, [normalizedPlanHistory]);
  const threadPhase = thread?.status ?? pipelinePhase;
  const canStartPipeline =
    !activeThreadId && !!activeProjectId && activeIssue?.pipelineStatus !== 'completed';
  const canRerun = !!activeIssue && activeIssue.pipelineStatus === 'failed' && !!activeProjectId;
  const hasApprovalDecision =
    !!activeThreadId && threadPhase === 'awaiting_approval' && !!latestPlan;
  const canApprove = hasApprovalDecision && !!(latestPlan?.structured || latestPlan?.rawOutput);
  const fullScreenPlan = normalizedPlanHistory.find((p) => p.id === fullScreenPlanId) ?? null;
  const fullScreenReview = fullScreenPlan
    ? normalizedReviewsByPlanId[fullScreenPlan.id]
    : undefined;

  if (!activeIssue) return null;

  const refreshIssueState = async () => {
    if (!activeProjectId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['threads', activeProjectId] }),
      queryClient.invalidateQueries({ queryKey: ['github-issues', activeProjectId] }),
      queryClient.invalidateQueries({ queryKey: ['thread', activeThreadId] }),
      queryClient.invalidateQueries({ queryKey: ['plan-history', activeThreadId] }),
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
    planner: settings && activeProject
      ? {
          provider: resolvePhaseModel(settings, activeProject, 'planner'),
          modelId: resolvePhaseModelId(settings, activeProject, 'planner'),
        }
      : { provider: 'claude' as ExecutorModel, modelId: null as string | null },
    reviewer: settings && activeProject
      ? {
          provider: resolvePhaseModel(settings, activeProject, 'reviewer'),
          modelId: resolvePhaseModelId(settings, activeProject, 'reviewer'),
        }
      : { provider: 'claude' as ExecutorModel, modelId: null as string | null },
    executor: settings && activeProject
      ? {
          provider: resolvePhaseModel(settings, activeProject, 'executor'),
          modelId: resolvePhaseModelId(settings, activeProject, 'executor'),
        }
      : { provider: 'claude' as ExecutorModel, modelId: null as string | null },
    verifier: settings && activeProject
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

  const headerStatus = activeThreadId && threadPhase !== 'idle' ? threadPhase : activeIssue.pipelineStatus;
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

  const issueBadges = (
    <div className="flex flex-wrap gap-1.5">
      {canStartPipeline ? (
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
      )}
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

  const agentsSection = (
    <div className="mb-5">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-secondary">Agents</h4>
      <div className="grid grid-cols-2 gap-2">
        {[
          {
            role: 'Planner',
            phase: 'planner' as const,
            displayModel: effectivePhaseResolvedModels.planner,
            editable: executorEditable,
          },
          {
            role: 'Reviewer',
            phase: 'reviewer' as const,
            displayModel: effectivePhaseResolvedModels.reviewer,
            editable: executorEditable,
          },
          {
            role: 'Executor',
            phase: 'executor' as const,
            displayModel: effectivePhaseResolvedModels.executor,
            editable: executorEditable,
          },
          {
            role: 'Verifier',
            phase: 'verifier' as const,
            displayModel: effectivePhaseResolvedModels.verifier,
            editable: executorEditable,
          },
        ].map(({ role, phase, displayModel, editable }) => (
          <div
            key={role}
            className="flex flex-col gap-2 rounded-md border border-border bg-secondary p-2"
          >
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
              {role}
            </span>
            {editable ? (
              <>
                <Select
                  value={phaseSelectValues[phase]}
                  onValueChange={(v: string) => handlePhaseAgentChange(phase, v)}
                >
                  <SelectTrigger className="h-6 w-full text-[11px]">
                    <SelectValue>
                      {phaseSelectValues[phase] === INHERIT_EXECUTOR_VALUE ? (
                        <InheritValueDisplay
                          detail={`project default (${formatProviderSelectionLabel(
                            projectDefaultPhaseSelections[phase].provider,
                            projectDefaultPhaseSelections[phase].modelId,
                          )})`}
                        />
                      ) : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={INHERIT_EXECUTOR_VALUE}>
                      {`Inherit project default (${formatProviderSelectionLabel(
                        projectDefaultPhaseSelections[phase].provider,
                        projectDefaultPhaseSelections[phase].modelId,
                      )})`}
                    </SelectItem>
                    <SelectSeparator />
                    {PHASE_PROVIDER_OPTIONS[phase].map((providerOption) => {
                      const selectedSelection = currentPhaseSelections[phase];
                      const selectedModelId =
                        selectedSelection.provider === providerOption ? selectedSelection.modelId : null;
                      return (
                        <SelectGroup key={providerOption}>
                          <SelectLabel>{PROVIDER_DISPLAY[providerOption]}</SelectLabel>
                          <SelectItem value={encodePhaseOption(providerOption, null)}>
                            {PROVIDER_DISPLAY[providerOption]} default
                          </SelectItem>
                          {selectedModelId &&
                            !getModelOptions(providerOption).some(
                              (option) => option.value === selectedModelId,
                            ) && (
                              <SelectItem value={encodePhaseOption(providerOption, selectedModelId)}>
                                {selectedModelId}
                              </SelectItem>
                            )}
                          {getModelOptions(providerOption).map((option) => (
                            <SelectItem key={option.value} value={encodePhaseOption(providerOption, option.value)}>
                              {option.label}
                            </SelectItem>
                          ))}
                          {providerOption !==
                            PHASE_PROVIDER_OPTIONS[phase][PHASE_PROVIDER_OPTIONS[phase].length - 1] && (
                            <SelectSeparator />
                          )}
                        </SelectGroup>
                      );
                    })}
                  </SelectContent>
                </Select>

                {currentPhaseSelections[phase].provider === 'openrouter' && phase !== 'executor' && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-muted">
                      Custom OpenRouter slug
                    </span>
                    <Input
                      key={`${phase}-${currentPhaseSelections[phase].modelId ?? ''}`}
                      className="h-7 text-[11px]"
                      placeholder="e.g. anthropic/claude-sonnet-4-6"
                      defaultValue={currentPhaseSelections[phase].modelId ?? ''}
                      onBlur={(e) => handlePhaseOpenRouterSlugBlur(phase, e.target.value)}
                    />
                  </div>
                )}

                {currentPhaseSelections[phase].provider === 'openrouter' &&
                integrationStatus?.openrouter.authStatus !== 'valid' ? (
                  <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300">
                    {integrationStatus?.openrouter.message ?? 'OpenRouter is not ready.'}
                  </div>
                ) : null}

                {phaseModelValidation[phase] && phaseModelValidation[phase]?.status !== 'valid' ? (
                  <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300">
                    {phaseModelValidation[phase]?.message}
                  </div>
                ) : null}
              </>
            ) : (
              <Badge variant="default" className="w-fit font-mono normal-case tracking-normal">
                {MODEL_DISPLAY[displayModel] ?? displayModel}
              </Badge>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const linkedPrUrl =
    activeIssue.linkedPrUrl ??
    (thread?.githubPrNumber && thread.githubRepo
      ? `https://github.com/${thread.githubRepo}/pull/${thread.githubPrNumber}`
      : null);
  const hasPrFeedbackBlockers =
    activeIssue.ciBlocked || activeIssue.unresolvedReviewCommentCount > 0;

  const pipelineSection = thread ? (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">Pipeline</h4>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {thread.worktreeBranch && (
          <div className="flex flex-col gap-1 rounded-md border border-border bg-secondary p-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
              Branch
            </span>
            <span className="truncate font-mono text-[11px] text-primary">
              {thread.worktreeBranch}
            </span>
          </div>
        )}
        {activeIssue.linkedPrNumber && linkedPrUrl && (
          <div className="flex flex-col gap-1 rounded-md border border-border bg-secondary p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                Pull Request
              </span>
              <Badge variant={activeIssue.linkedPrIsDraft ? 'warning' : 'success'} className="text-[10px]">
                {activeIssue.linkedPrIsDraft ? 'Draft' : 'Ready'}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-[11px] text-primary">
                #{activeIssue.linkedPrNumber}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted"
                onClick={() =>
                  window.shipcode.invoke('shell:open-external', {
                    url: linkedPrUrl,
                  })
                }
                title="Open pull request on GitHub"
              >
                <ExternalLink size={12} />
              </Button>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-1 rounded-md border border-border bg-secondary p-2">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">Cost</span>
          <span className="text-[11px] font-medium text-primary">
            {thread.totalCostUsd === 0
              ? '$0.00'
              : thread.totalCostUsd < 0.005
                ? '< $0.01'
                : `$${thread.totalCostUsd.toFixed(2)}`}
          </span>
          {thread.totalTokensPrompt > 0 && (
            <span className="text-[10px] text-muted">
              {thread.totalTokensPrompt + thread.totalTokensCompletion >= 1000
                ? `${Math.round((thread.totalTokensPrompt + thread.totalTokensCompletion) / 1000)}k`
                : String(thread.totalTokensPrompt + thread.totalTokensCompletion)}{' '}
              tokens
            </span>
          )}
        </div>
      </div>
    </div>
  ) : null;

  const prFeedbackSection = activeIssue.linkedPrNumber ? (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">
          PR Feedback
        </h4>
        {activeIssue.prLastSyncAt && (
          <span className="text-[10px] text-muted">
            {new Date(activeIssue.prLastSyncAt).toLocaleString()}
          </span>
        )}
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={activeIssue.ciBlocked ? 'danger' : 'success'} className="text-[10px]">
            {activeIssue.ciBlocked
              ? `${activeIssue.failingChecks.length} failing check${activeIssue.failingChecks.length === 1 ? '' : 's'}`
              : 'CI clear'}
          </Badge>
          <Badge
            variant={activeIssue.unresolvedReviewCommentCount > 0 ? 'warning' : 'default'}
            className="text-[10px]"
          >
            {activeIssue.unresolvedReviewCommentCount} unresolved review
            {activeIssue.unresolvedReviewCommentCount === 1 ? '' : 's'}
          </Badge>
        </div>
        {activeIssue.failingChecks.length > 0 && (
          <div className="space-y-2">
            {activeIssue.failingChecks.map((check) => (
              <div
                key={`${check.workflowName ?? 'workflow'}:${check.name}`}
                className="rounded-md border border-danger/20 bg-danger/5 p-2"
              >
                <div className="text-[12px] font-medium text-primary">
                  {[check.workflowName, check.name].filter(Boolean).join(' / ')}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                  <span>{check.conclusion ?? check.status}</span>
                  {check.detailsUrl && (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="h-5 px-1.5 text-[10px]"
                      onClick={() =>
                        window.shipcode.invoke('shell:open-external', { url: check.detailsUrl! })
                      }
                    >
                      Open
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {activeIssue.unresolvedReviewComments.length > 0 && (
          <div className="space-y-2">
            {activeIssue.unresolvedReviewComments.map((comment) => (
              <div
                key={comment.url}
                className="rounded-md border border-warning/20 bg-warning/5 p-2"
              >
                <div className="text-[11px] text-muted">
                  {[comment.author, comment.path, comment.line ? `:${comment.line}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <div className="mt-1 text-[12px] text-primary whitespace-pre-wrap break-words">
                  {comment.body}
                </div>
                <div className="mt-2">
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-5 px-1.5 text-[10px]"
                    onClick={() =>
                      window.shipcode.invoke('shell:open-external', { url: comment.url })
                    }
                  >
                    Open Comment
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {hasPrFeedbackBlockers && activeThreadId && (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={handleStabilizePr}
              disabled={isSubmitting || phaseIsActive}
            >
              {isSubmitting ? 'Starting…' : 'Run stabilization pass'}
            </Button>
          </div>
        )}
      </div>
    </div>
  ) : null;

  const checkpointSection =
    thread && checkpoints.length > 0 ? (
      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">
            Checkpoints
          </h4>
          <span className="text-[11px] text-muted">{checkpoints.length}</span>
        </div>
        <div className="space-y-2">
          {checkpoints.map((checkpoint) => (
            <div
              key={checkpoint.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-secondary p-2"
            >
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-primary">{checkpoint.label}</div>
                <div className="truncate text-[11px] text-muted">
                  {checkpoint.branch ? `${checkpoint.branch} · ` : ''}
                  {checkpoint.commitSha.slice(0, 12)} ·{' '}
                  {new Date(checkpoint.createdAt).toLocaleString()}
                </div>
              </div>
              <Button
                variant="outline"
                size="xs"
                onClick={() => handleRestoreCheckpoint(checkpoint)}
                disabled={isSubmitting || phaseIsActive}
              >
                Restore
              </Button>
            </div>
          ))}
        </div>
      </div>
    ) : null;

  const approvalSection = hasApprovalDecision ? (
    <div className="mb-5 rounded-md border border-border bg-secondary p-3">
      <div className={cn('flex items-center gap-2', pendingAction === 'request_changes' && 'mb-3')}>
        <Select
          value={pendingAction}
          onValueChange={(v) =>
            setPendingAction(v as 'approve' | 'request_changes' | 'cancel')
          }
          disabled={isSubmitting}
        >
          <SelectTrigger className="h-8 w-48 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="approve">Approve &amp; Execute</SelectItem>
            <SelectItem value="request_changes">Request Changes</SelectItem>
            <SelectItem value="cancel">Cancel pipeline</SelectItem>
          </SelectContent>
        </Select>
        {pendingAction === 'approve' && (
          <Button
            size="sm"
            onClick={handleApprove}
            disabled={isSubmitting || !canApprove}
            title={
              !canApprove ? 'No plan content found — use Request Changes or Cancel' : undefined
            }
          >
            {isSubmitting ? 'Approving...' : 'Confirm'}
          </Button>
        )}
        {pendingAction === 'cancel' && (
          <Button
            size="sm"
            variant="destructive"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Cancelling...' : 'Confirm cancel'}
          </Button>
        )}
      </div>
      {pendingAction === 'request_changes' && (
        <div className="flex flex-col gap-2">
          <Textarea
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="Send direction for another planning round..."
            rows={4}
          />
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleReject}
              disabled={!feedback.trim() || isSubmitting}
            >
              {isSubmitting ? 'Submitting...' : 'Re-plan with feedback'}
            </Button>
          </div>
        </div>
      )}
      {approveError && (
        <p className="mt-2 text-[11px] text-danger">
          {approveError}{' '}
          <span className="text-muted">(full trace in devtools console)</span>
        </p>
      )}
    </div>
  ) : null;

  const planHistorySection =
    normalizedPlanHistory.length > 0 ? (
      <div className="mb-5">
        <div className="mb-2 flex w-full items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">
            Plan History ({normalizedPlanHistory.length} version
            {normalizedPlanHistory.length !== 1 ? 's' : ''})
          </h4>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setPlanHistoryCollapsed((v) => !v)}
            title={planHistoryCollapsed ? 'Expand plan history' : 'Collapse plan history'}
            aria-label={planHistoryCollapsed ? 'Expand plan history' : 'Collapse plan history'}
          >
            {planHistoryCollapsed ? (
              <ChevronDown size={16} strokeWidth={2.25} className="text-muted" />
            ) : (
              <ChevronUp size={16} strokeWidth={2.25} className="text-muted" />
            )}
          </Button>
        </div>
        {!planHistoryCollapsed && <div className="flex flex-col gap-1">
          {normalizedPlanHistory.map((plan) => {
            const isExpanded = effectiveExpanded === plan.id;
            const review = normalizedReviewsByPlanId[plan.id];
            const statusPresentation = getPlanStatusPresentation(plan, review);
            const reviewPresentation = review
              ? getReviewDecisionPresentation(review, threadPhase)
              : null;
            const isSuperseded = plan.status === 'superseded';

            return (
              <div
                key={plan.id}
                className={cn(
                  'rounded-md border transition-opacity',
                  isExpanded ? 'border-border' : 'border-transparent',
                  isSuperseded && !isExpanded && 'opacity-60',
                )}
              >
                <div className="flex items-center">
                  <Button
                    variant="ghost"
                    className={cn(
                      'h-auto min-w-0 flex-1 justify-start gap-2 rounded-md px-3 py-2 text-left text-[13px] font-normal',
                      isSuperseded ? 'text-secondary' : 'text-primary',
                    )}
                    onClick={() => setExpandedPlanId(isExpanded ? null : plan.id)}
                  >
                    <span className="font-mono text-xs font-semibold text-muted">
                      v{plan.version}
                    </span>
                    {statusPresentation.usePhaseChip ? (
                      <PhaseChip
                        status={statusPresentation.phaseStatus}
                        label={statusPresentation.label}
                        className="text-[10px]"
                      />
                    ) : (
                      <span className="text-xs text-muted">{statusPresentation.label}</span>
                    )}
                    {review && plan.status !== 'superseded' && reviewPresentation && (
                      <Badge
                        variant={reviewPresentation.badgeVariant}
                        className="text-[10px]"
                      >
                        {reviewPresentation.label}
                      </Badge>
                    )}
                    <span className="ml-auto text-[11px] text-muted">
                      {new Date(plan.createdAt).toLocaleString()}
                    </span>
                    {isExpanded ? (
                      <ChevronDown size={12} className="text-muted" />
                    ) : (
                      <ChevronRight size={12} className="text-muted" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="mr-1 shrink-0 text-muted hover:text-primary"
                    aria-label="View plan full screen"
                    onClick={() => setFullScreenPlanId(plan.id)}
                  >
                    <Maximize2 size={12} />
                  </Button>
                </div>

                {isExpanded &&
                  (() => {
                    const inlineDisplayPlan =
                      plan.structured ?? resolveClientSidePlan(plan.rawOutput ?? '');
                    return (
                      <div className="border-t border-border p-3">
                        {inlineDisplayPlan && <PlanViewer plan={inlineDisplayPlan} />}
                        {review?.structured && <ReviewViewer review={review.structured} />}
                        {!inlineDisplayPlan && (() => {
                          const fallbackRaw = plan.rawOutput ?? '';
                          const resolved = resolveRawPlanText(fallbackRaw);
                          return resolved === fallbackRaw ? (
                            <p className="text-xs italic text-muted">
                              Plan output could not be parsed. Check devtools console for the
                              full trace.
                            </p>
                          ) : (
                            <div className="overflow-x-auto">
                              <pre className="whitespace-pre-wrap text-xs text-secondary">
                                {resolved}
                              </pre>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })()}
              </div>
            );
          })}
        </div>}
      </div>
    ) : null;

  const pipelineStartCardInner = canStartPipeline ? (
    <div className="rounded-lg border border-border bg-tertiary p-4 shadow-[0_1px_0_0_rgba(0,0,0,0.3)]">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
        Ready
      </div>
      <h4 className="mb-1.5 text-[14px] font-semibold leading-snug text-primary">
        Run the agent pipeline
      </h4>
      <p className="mb-5 text-[12px] leading-relaxed text-secondary">
        The issue will move through these phases in an isolated worktree. You'll approve the plan
        before any code is written.
      </p>

      <div className="mb-5">
        <div className="relative">
          <div
            aria-hidden="true"
            className="absolute left-[9px] right-[9px] top-[9px] h-px bg-border"
          />
          <ol className="relative grid grid-cols-5 gap-1">
            {PIPELINE_PREVIEW_PHASES.map((phase, i) => (
              <li key={phase.id} className="flex min-w-0 flex-col items-center gap-1.5">
                <span className="relative flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border bg-tertiary font-mono text-[9px] font-medium text-muted">
                  {i + 1}
                </span>
                <span className="w-full truncate text-center text-[9px] font-semibold uppercase tracking-normal text-muted">
                  {phase.label}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={handleStartPipeline} disabled={isSubmitting}>
          {isSubmitting ? 'Starting…' : 'Start pipeline'}
        </Button>
        <Button
          variant="link"
          size="xs"
          onClick={handleEditPrd}
          className="px-0 text-muted hover:text-primary"
        >
          Edit PRD first
        </Button>
      </div>
    </div>
  ) : null;

  const rerunSection = canRerun ? (
    <div className="mb-5">
      {(thread?.lastError || failingPhaseOutput) && (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-danger">Error</p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-danger/60 hover:bg-danger/10 hover:text-danger"
                onClick={() =>
                  navigator.clipboard.writeText(
                    [thread?.lastError, failingPhaseOutput].filter(Boolean).join('\n\n'),
                  )
                }
                title="Copy to clipboard"
              >
                <Copy size={13} />
              </Button>
              {failingPhaseOutput && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-danger/60 hover:bg-danger/10 hover:text-danger"
                  onClick={() => setShowRawOutput((v) => !v)}
                >
                  {showRawOutput ? (
                    <ChevronUp size={16} strokeWidth={2.25} />
                  ) : (
                    <ChevronDown size={16} strokeWidth={2.25} />
                  )}
                </Button>
              )}
            </div>
          </div>
          {thread?.lastError && (
            <p className="text-[12px] text-danger/80 break-words">{safeErrorMessage(thread.lastError)}</p>
          )}
          {showRawOutput && failingPhaseOutput && (
            <pre className="mt-2 max-h-[200px] overflow-y-auto text-[11px] text-danger/70 whitespace-pre-wrap break-words border-t border-danger/20 pt-2">
              {failingPhaseOutput}
            </pre>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleRerun}
          disabled={isSubmitting}
          className="flex-1 border-danger/40 text-danger hover:bg-danger/10 hover:border-danger"
        >
          {isSubmitting ? 'Starting...' : 'Retry'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleMarkAsDone}
          disabled={isSubmitting}
          className="flex-1 border-border text-muted hover:bg-secondary hover:text-primary"
        >
          Mark As Done
        </Button>
      </div>
    </div>
  ) : null;

  const fullScreenClientPlan =
    fullScreenPlan && !fullScreenPlan.structured
      ? resolveClientSidePlan(fullScreenPlan.rawOutput ?? '')
      : null;
  const fullScreenDisplayPlan = fullScreenPlan?.structured ?? fullScreenClientPlan;
  const fullScreenIsLatest = fullScreenPlanId === latestPlan?.id;

  const planFullScreenDialog = (
    <Modal
      open={fullScreenPlanId !== null}
      onClose={() => setFullScreenPlanId(null)}
      title={`Plan v${fullScreenPlan?.version}${fullScreenPlan?.status ? ` — ${fullScreenPlan.status}` : ''}`}
      className="max-w-4xl h-[90vh] flex flex-col overflow-hidden p-0"
      headerClassName="shrink-0 border-b border-border px-6 py-4"
      headerAction={
        <Button variant="ghost" className="h-7 w-7 p-0" onClick={() => setFullScreenPlanId(null)}>
          <X size={15} strokeWidth={2.25} />
        </Button>
      }
    >
      <div className="flex-1 overflow-y-auto">
        {fullScreenDisplayPlan && <PlanViewer plan={fullScreenDisplayPlan} />}
        {fullScreenReview?.structured && <ReviewViewer review={fullScreenReview.structured} />}
        {!fullScreenDisplayPlan && fullScreenPlan && (
          <div className="p-6 text-sm leading-relaxed whitespace-pre-wrap text-secondary">
            {resolveRawPlanText(fullScreenPlan.rawOutput ?? '')}
          </div>
        )}
      </div>
      {canApprove && fullScreenIsLatest && (
        <ModalFooter className="shrink-0 border-t border-border px-6 py-4">
          <Button
            onClick={() => {
              void handleApprove();
              setFullScreenPlanId(null);
            }}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Approving...' : 'Approve & Execute'}
          </Button>
        </ModalFooter>
      )}
    </Modal>
  );

  // ─── Expanded (full-page) layout ────────────────────────────────────────

  if (expanded) {
    return (
      <div className="flex h-full bg-primary">
        {/* Left column — scrollable content */}
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
            {issueBadges}
            <h1 className="my-1 pr-16 text-xl font-semibold">{activeIssue.title}</h1>
          </div>
          {approvalSection && (
            <div className="shrink-0 border-b border-border px-6 py-4">{approvalSection}</div>
          )}

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* PRD — no max-h cap in expanded mode */}
            <div className="mb-5">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">
                  PRD
                </h4>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={handleRefreshFromGithub}
                    disabled={isRefreshingFromGithub}
                    title="Re-fetch issue body from GitHub"
                    aria-label="Refresh PRD from GitHub"
                  >
                    <RefreshCw size={12} className={isRefreshingFromGithub ? 'animate-spin' : ''} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={handleEditPrd}
                    title="Edit the PRD body"
                    aria-label="Edit PRD"
                  >
                    <Pencil size={13} />
                  </Button>
                </div>
              </div>
              {activeIssue.body ? (
                <div className="rounded-md bg-secondary p-3 text-[13px] leading-relaxed text-primary">
                  <div className={PRD_PROSE_CLASSES}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeIssue.body}</ReactMarkdown>
                  </div>
                </div>
              ) : (
                <div className="rounded-md bg-secondary p-3 text-[13px] text-muted">
                  This issue has no PRD body yet. Click "Edit PRD" to author one.
                </div>
              )}
            </div>

            {planHistorySection}

            {/* Thread exists but no plans yet — only while not failed */}
            {activeThreadId && normalizedPlanHistory.length === 0 && threadPhase !== 'failed' && (
              <PlanWaiting threadId={activeThreadId} />
            )}
          </div>
        </div>

        {/* Right sidebar — properties */}
        <div className="w-72 shrink-0 border-l border-border overflow-y-auto p-4">
          {pipelineStartCardInner && (
            <div className="sticky -top-4 z-20 -mx-4 -mt-4 mb-4 bg-primary px-4 pt-4 pb-3">
              {pipelineStartCardInner}
            </div>
          )}
          {/* Re-run CTA — top action when failed */}
          {rerunSection}

          {agentsSection}
          {pipelineSection}
          {prFeedbackSection}
          {checkpointSection}
        </div>
        {planFullScreenDialog}
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
        {issueBadges}
        <h3 className="my-1 pr-16 text-[15px] font-semibold">{activeIssue.title}</h3>
      </div>

      {/* Phase stepper — shown once pipeline has started */}
      {/* Primary CTAs — above tabs, always visible */}
      {pipelineStartCardInner && (
        <div className="shrink-0 p-4 pb-0">{pipelineStartCardInner}</div>
      )}
      {rerunSection && (
        <div className="shrink-0 px-4 pt-4">{rerunSection}</div>
      )}
      {approvalSection && (
        <div className="shrink-0 px-4 pt-4">{approvalSection}</div>
      )}

      {/* Tabbed content — min-h-0 required for flex scroll containment */}
      <Tabs defaultValue="plan" className="flex-1 min-h-0 flex flex-col">
        <TabsList className="shrink-0 px-4">
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
        </TabsList>

        <TabsContent value="plan" className="p-4">
          {/* PRD (GitHub issue body IS the PRD) */}
          <div className="mb-5">
            <div className="mb-2 flex w-full items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">PRD</h4>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={handleRefreshFromGithub}
                  disabled={isRefreshingFromGithub}
                  title="Re-fetch issue body from GitHub (use after editing on github.com)"
                  aria-label="Refresh PRD from GitHub"
                >
                  <RefreshCw size={12} className={isRefreshingFromGithub ? 'animate-spin' : ''} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={handleEditPrd}
                  title="Edit the PRD body (pushes to the GitHub issue on save)"
                  aria-label="Edit PRD"
                >
                  <Pencil size={13} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setPrdCollapsed((v) => !v)}
                  title={prdCollapsed ? 'Expand PRD' : 'Collapse PRD'}
                  aria-label={prdCollapsed ? 'Expand PRD' : 'Collapse PRD'}
                >
                  {prdCollapsed ? (
                    <ChevronDown size={16} strokeWidth={2.25} className="text-muted" />
                  ) : (
                    <ChevronUp size={16} strokeWidth={2.25} className="text-muted" />
                  )}
                </Button>
              </div>
            </div>
            {!prdCollapsed &&
              (activeIssue.body ? (
                <div className="max-h-[300px] overflow-y-auto rounded-md bg-secondary p-3 text-[13px] leading-relaxed text-primary">
                  <div className={PRD_PROSE_CLASSES}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeIssue.body}</ReactMarkdown>
                  </div>
                </div>
              ) : (
                <div className="rounded-md bg-secondary p-3 text-[13px] text-muted">
                  This issue has no PRD body yet. Click "Edit PRD" to author one.
                </div>
              ))}
          </div>

          {planHistorySection}

          {/* Thread exists but no plans yet — only while not failed */}
          {activeThreadId && normalizedPlanHistory.length === 0 && threadPhase !== 'failed' && (
            <div className="mb-5">
              <p className="py-4 text-center text-[13px] text-muted">
                Pipeline is running — waiting for plan generation...
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="agents" className="p-4">
          {agentsSection}
          {pipelineSection}
          {prFeedbackSection}
          {checkpointSection}
        </TabsContent>
      </Tabs>

      {/* Portal-based dialog — outside tabs to avoid unmount on tab switch */}
      {planFullScreenDialog}

      <Modal
        open={showArchiveConfirm}
        onClose={() => setShowArchiveConfirm(false)}
        title={`Archive issue #${activeIssue.issueNumber}?`}
        className="max-w-sm"
      >
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          Warning: this closes the GitHub issue and archives its GitHub Project card. Archived items disappear from the Done column.
        </div>
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={() => setShowArchiveConfirm(false)}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={handleArchiveConfirmed}>
            Archive
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
