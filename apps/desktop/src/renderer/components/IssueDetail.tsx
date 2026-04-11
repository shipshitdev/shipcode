import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppStore } from '../stores/app-store';
import {
  PlanViewer,
  ReviewViewer,
  Badge,
  Button,
  Textarea,
  X,
  ExternalLink,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  MODEL_DISPLAY,
  getStatusBadgeVariant,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Copy,
  Maximize2,
  Minimize2,
  Pencil,
  RefreshCw,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@shipcode/ui';
import type {
  Thread,
  PlanRecord,
  ReviewRecord,
  Project,
  NotificationRecord,
  PipelinePhase,
} from '@shipcode/shared';
import { deriveGithubIssueUrl } from '@shipcode/shared';

// See DashboardView for why all 6 agent phases share one color.
const AGENT_PHASE_CLASSES = 'bg-agent/10 text-agent border-agent/25';

const PHASE_COLOR: Partial<Record<PipelinePhase, string>> = {
  planning: AGENT_PHASE_CLASSES,
  reviewing: AGENT_PHASE_CLASSES,
  revising: AGENT_PHASE_CLASSES,
  executing: AGENT_PHASE_CLASSES,
  verifying: AGENT_PHASE_CLASSES,
  shipping: AGENT_PHASE_CLASSES,
  awaiting_approval: 'bg-warning/15 text-warning border-warning/30',
  completed: 'bg-success/15 text-success border-success/30',
  failed: 'bg-danger/15 text-danger border-danger/30',
  idle: 'bg-tertiary text-muted border-border',
};

const ACTIVE_PHASES: PipelinePhase[] = [
  'planning',
  'reviewing',
  'revising',
  'executing',
  'verifying',
  'shipping',
];

const PIPELINE_PREVIEW_PHASES = [
  { id: 'plan', label: 'Plan' },
  { id: 'review', label: 'Review' },
  { id: 'execute', label: 'Execute' },
  { id: 'verify', label: 'Verify' },
  { id: 'ship', label: 'Ship' },
] as const;

// `deriveGithubIssueUrl` + related helpers live in `@shipcode/shared/github-url`
// so the Kanban toolbar, IssueDetail, and any future consumer share one parser.

const PRD_PROSE_CLASSES =
  'space-y-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-secondary [&_code]:rounded [&_code]:bg-tertiary [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:whitespace-pre-wrap [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-tertiary [&_pre]:p-3 [&_pre]:text-xs [&_ul]:list-disc [&_ul]:pl-5';

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
  const [fullScreenPlanId, setFullScreenPlanId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshingFromGithub, setIsRefreshingFromGithub] = useState(false);
  const [prdCollapsed, setPrdCollapsed] = useState(false);
  const [showRawOutput, setShowRawOutput] = useState(false);

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

  // Fetch reviews for all plans
  const planIds = planHistory.map((p) => p.id);
  const { data: reviewsByPlanId = {} } = useQuery<Record<string, ReviewRecord>>({
    queryKey: ['reviews-by-plans', planIds.join(',')],
    queryFn: () => window.shipcode.invoke('review:list-by-plans', { planIds }),
    enabled: planIds.length > 0,
    refetchInterval: activeThreadId ? 2000 : false,
  });

  // Auto-expand latest plan
  const latestPlanId = planHistory[0]?.id ?? null;
  const effectiveExpanded = expandedPlanId === undefined ? latestPlanId : expandedPlanId;
  const latestPlan = useMemo(() => planHistory[0] ?? null, [planHistory]);
  const threadPhase = thread?.status ?? pipelinePhase;
  const canStartPipeline = !activeThreadId && !!activeProjectId;
  const canRerun = !!activeIssue && activeIssue.pipelineStatus === 'failed' && !!activeProjectId;
  const canApprove =
    !!activeThreadId && !!latestPlan?.structured && threadPhase === 'awaiting_approval';
  const fullScreenPlan = planHistory.find((p) => p.id === fullScreenPlanId) ?? null;
  const fullScreenReview = fullScreenPlan ? reviewsByPlanId[fullScreenPlan.id] : undefined;

  if (!activeIssue) return null;

  const refreshIssueState = async () => {
    if (!activeProjectId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['threads', activeProjectId] }),
      queryClient.invalidateQueries({ queryKey: ['github-issues', activeProjectId] }),
      queryClient.invalidateQueries({ queryKey: ['thread', activeThreadId] }),
      queryClient.invalidateQueries({ queryKey: ['plan-history', activeThreadId] }),
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

  const handleRerun = async () => {
    if (!activeProjectId || !activeIssue) return;
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

  const handleApprove = async () => {
    if (!activeThreadId || !canApprove) return;
    setIsSubmitting(true);
    try {
      await window.shipcode.invoke('pipeline:approve', { threadId: activeThreadId });
      await refreshIssueState();
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
      setShowRejectForm(false);
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

  const phaseIsActive = ACTIVE_PHASES.includes(threadPhase as PipelinePhase);

  const handleExecutorChange = async (model: 'claude' | 'codex' | 'openrouter') => {
    if (!activeProjectId) return;
    await window.shipcode.invoke('github:set-executor', {
      projectId: activeProjectId,
      issueNumber: activeIssue!.issueNumber,
      model,
    });
    await queryClient.invalidateQueries({ queryKey: ['github-issues', activeProjectId] });
  };

  const handleEditPrd = () => {
    if (!activeIssue) return;
    openEditPrdModal(activeIssue.issueNumber, activeIssue.body ?? '');
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

  const statusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'var(--success)';
      case 'superseded':
        return 'var(--text-muted)';
      case 'rejected':
        return 'var(--danger)';
      case 'pending_review':
        return 'var(--warning)';
      default:
        return 'var(--accent)';
    }
  };

  // ─── Shared render sections ──────────────────────────────────────────────

  const headerButtons = (
    <div className="absolute right-3 top-3 flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-muted"
        onClick={toggleIssueDetailExpanded}
        title={expanded ? 'Collapse to panel' : 'Expand to full page'}
      >
        {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-muted"
        onClick={() => selectIssue(null)}
        title="Close"
      >
        <X size={14} />
      </Button>
    </div>
  );

  const issueBadges = (
    <div className="flex flex-wrap gap-1.5">
      <Badge
        variant={getStatusBadgeVariant(activeIssue.pipelineStatus)}
        className="text-[11px] uppercase font-semibold"
      >
        {activeIssue.pipelineStatus}
      </Badge>
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
    </div>
  );

  const agentsSection = (
    <div className="mb-5">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-secondary">Agents</h4>
      <div className="grid grid-cols-2 gap-2">
        {[
          { role: 'Planner', model: 'claude' as const, editable: false },
          { role: 'Reviewer', model: 'codex' as const, editable: false },
          { role: 'Executor', model: activeIssue.executorModel, editable: executorEditable },
          { role: 'Verifier', model: 'claude' as const, editable: false },
        ].map(({ role, model, editable }) => (
          <div
            key={role}
            className="flex flex-col gap-1 rounded-md border border-border bg-secondary p-2"
          >
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
              {role}
            </span>
            {editable ? (
              <Select
                value={activeIssue.executorModel}
                onValueChange={(v: string) =>
                  handleExecutorChange(v as 'claude' | 'codex' | 'openrouter')
                }
              >
                <SelectTrigger className="h-6 w-full text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude">{MODEL_DISPLAY.claude}</SelectItem>
                  <SelectItem value="codex">{MODEL_DISPLAY.codex}</SelectItem>
                  <SelectItem value="openrouter">{MODEL_DISPLAY.openrouter}</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Badge variant="default" className="w-fit font-mono normal-case tracking-normal">
                {MODEL_DISPLAY[model] ?? model}
              </Badge>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const pipelineSection = thread ? (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">Pipeline</h4>
        {phaseIsActive && (
          <Button variant="destructive" size="xs" onClick={handleCancel} disabled={isSubmitting}>
            Stop
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1 rounded-md border border-border bg-secondary p-2">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">Status</span>
          <span
            className={`inline-flex w-fit items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${PHASE_COLOR[threadPhase] ?? PHASE_COLOR.idle}`}
          >
            {threadPhase.replace(/_/g, ' ')}
          </span>
        </div>
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
        {thread.githubPrNumber && (
          <div className="flex flex-col gap-1 rounded-md border border-border bg-secondary p-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted">PR</span>
            <span className="font-mono text-[11px] text-primary">#{thread.githubPrNumber}</span>
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

  const approvalSection = canApprove ? (
    <div className="mb-5 rounded-md border border-border bg-secondary p-3">
      <div className="mb-3 flex flex-wrap gap-2">
        <Button onClick={handleApprove} disabled={isSubmitting}>
          {isSubmitting ? 'Approving...' : 'Approve & Execute'}
        </Button>
        <Button
          variant="secondary"
          onClick={() => setShowRejectForm((value) => !value)}
          disabled={isSubmitting}
        >
          Request Changes
        </Button>
      </div>
      {showRejectForm && (
        <div className="flex flex-col gap-2">
          <Textarea
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="Describe what should change before execution..."
            rows={4}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setShowRejectForm(false);
                setFeedback('');
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={handleReject}
              disabled={!feedback.trim() || isSubmitting}
              aria-label="Submit review feedback"
            >
              {isSubmitting ? 'Submitting...' : 'Submit'}
            </Button>
          </div>
        </div>
      )}
    </div>
  ) : null;

  const planHistorySection =
    planHistory.length > 0 ? (
      <div className="mb-5">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-secondary">
          Plan History ({planHistory.length} version{planHistory.length !== 1 ? 's' : ''})
        </h4>
        <div className="flex flex-col gap-1">
          {planHistory.map((plan) => {
            const isExpanded = effectiveExpanded === plan.id;
            const review = reviewsByPlanId[plan.id];

            return (
              <div
                key={plan.id}
                className={`rounded-md border ${isExpanded ? 'border-border' : 'border-transparent'}`}
              >
                <div className="flex items-center">
                  <Button
                    variant="ghost"
                    className="h-auto min-w-0 flex-1 justify-start gap-2 rounded-md px-3 py-2 text-left text-[13px] font-normal text-primary"
                    onClick={() => setExpandedPlanId(isExpanded ? null : plan.id)}
                  >
                    <span className="font-mono text-xs font-semibold text-muted">
                      v{plan.version}
                    </span>
                    <span className="text-xs" style={{ color: statusColor(plan.status) }}>
                      {plan.status}
                    </span>
                    {review && (
                      <Badge
                        variant={review.decision === 'approve' ? 'success' : 'warning'}
                        className="text-[10px]"
                      >
                        {review.decision}
                      </Badge>
                    )}
                    <span className="ml-auto text-[11px] text-muted">
                      {new Date(plan.createdAt).toLocaleString()}
                    </span>
                    <span className="text-muted">{isExpanded ? '▾' : '▸'}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="mr-1 shrink-0 text-muted hover:text-primary"
                    aria-label="View plan full screen"
                    onClick={() => setFullScreenPlanId(plan.id)}
                  >
                    <Maximize2 size={13} />
                  </Button>
                </div>

                {isExpanded && (
                  <div className="border-t border-border p-3">
                    {plan.structured && <PlanViewer plan={plan.structured} />}
                    {review?.structured && <ReviewViewer review={review.structured} />}
                    {!plan.structured && (
                      <div className="overflow-x-auto">
                        <pre className="whitespace-pre-wrap text-xs text-secondary">
                          {plan.rawOutput}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    ) : null;

  const pipelineStartCard = canStartPipeline ? (
    <div className="sticky -top-4 z-20 -mx-4 -mt-4 mb-4 bg-primary px-4 pt-4 pb-3">
      <div className="rounded-lg border border-border bg-tertiary p-4 shadow-[0_1px_0_0_rgba(0,0,0,0.3)]">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
          Ready
        </div>
        <h4 className="mb-1.5 text-[14px] font-semibold leading-snug text-primary">
          Run the agent pipeline
        </h4>
        <p className="mb-5 text-[12px] leading-relaxed text-secondary">
          The issue will move through these phases in an isolated worktree.
          You'll approve the plan before any code is written.
        </p>

        <div className="mb-5">
          <div className="relative">
            <div
              aria-hidden="true"
              className="absolute left-[9px] right-[9px] top-[9px] h-px bg-border"
            />
            <ol className="relative grid grid-cols-5 gap-1">
              {PIPELINE_PREVIEW_PHASES.map((phase, i) => (
                <li
                  key={phase.id}
                  className="flex min-w-0 flex-col items-center gap-1.5"
                >
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
          <Button
            size="sm"
            onClick={handleStartPipeline}
            disabled={isSubmitting}
          >
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
    </div>
  ) : null;

  const planFullScreenDialog = (
    <Dialog
      open={fullScreenPlanId !== null}
      onOpenChange={(open) => { if (!open) setFullScreenPlanId(null); }}
    >
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle>
            Plan v{fullScreenPlan?.version}{fullScreenPlan?.status ? ` — ${fullScreenPlan.status}` : ''}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto">
          {fullScreenPlan?.structured && <PlanViewer plan={fullScreenPlan.structured} />}
          {fullScreenReview?.structured && <ReviewViewer review={fullScreenReview.structured} />}
          {fullScreenPlan && !fullScreenPlan.structured && (
            <div className="p-4">
              <pre className="whitespace-pre-wrap text-xs text-secondary">{fullScreenPlan.rawOutput}</pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
            <h1 className="my-1 pr-16 text-xl font-semibold">{activeIssue.title}</h1>
            {issueBadges}
          </div>

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
                    <RefreshCw
                      size={14}
                      className={isRefreshingFromGithub ? 'animate-spin' : ''}
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={handleEditPrd}
                    title="Edit the PRD body"
                    aria-label="Edit PRD"
                  >
                    <Pencil size={14} />
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

            {approvalSection}
            {planHistorySection}

            {/* Thread exists but no plans yet — only while not failed */}
            {activeThreadId && planHistory.length === 0 && threadPhase !== 'failed' && (
              <div className="mb-5">
                <p className="py-4 text-center text-[13px] text-muted">
                  Pipeline is running — waiting for plan generation...
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar — properties */}
        <div className="w-72 shrink-0 border-l border-border overflow-y-auto p-4">
          {pipelineStartCard}
          {/* Re-run CTA — top action when failed */}
          {canRerun && (
            <div className="mb-4">
              {(thread?.lastError || planHistory[0]?.rawOutput) && (
                <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-danger">Error</p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-danger/60 hover:bg-danger/10 hover:text-danger"
                        onClick={() => navigator.clipboard.writeText([thread?.lastError, planHistory[0]?.rawOutput].filter(Boolean).join('\n\n'))}
                        title="Copy to clipboard"
                      >
                        <Copy size={14} />
                      </Button>
                      {planHistory[0]?.rawOutput && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="text-danger/60 hover:bg-danger/10 hover:text-danger"
                          onClick={() => setShowRawOutput(v => !v)}
                        >
                          {showRawOutput ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </Button>
                      )}
                    </div>
                  </div>
                  {thread?.lastError && <p className="text-[12px] text-danger/80 break-words">{thread.lastError}</p>}
                  {showRawOutput && planHistory[0]?.rawOutput && (
                    <pre className="mt-2 max-h-[200px] overflow-y-auto text-[11px] text-danger/70 whitespace-pre-wrap break-words border-t border-danger/20 pt-2">{planHistory[0].rawOutput}</pre>
                  )}
                </div>
              )}
              <Button size="sm" variant="outline" onClick={handleRerun} disabled={isSubmitting} className="w-full border-danger/40 text-danger hover:bg-danger/10 hover:border-danger">
                {isSubmitting ? 'Starting...' : 'Re-run Pipeline'}
              </Button>
            </div>
          )}

          {agentsSection}
          {pipelineSection}
        </div>
        {planFullScreenDialog}
      </div>
    );
  }

  // ─── Panel (default) layout ──────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col overflow-y-auto bg-primary">
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
        <h3 className="my-1 pr-16 text-[15px] font-semibold">{activeIssue.title}</h3>
        {issueBadges}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {pipelineStartCard}
        {/* Re-run CTA — top of content when failed */}
        {canRerun && (
          <div className="mb-5">
            {(thread?.lastError || planHistory[0]?.rawOutput) && (
              <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-danger">Error</p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-danger/60 hover:bg-danger/10 hover:text-danger"
                      onClick={() => navigator.clipboard.writeText([thread?.lastError, planHistory[0]?.rawOutput].filter(Boolean).join('\n\n'))}
                      title="Copy to clipboard"
                    >
                      <Copy size={14} />
                    </Button>
                    {planHistory[0]?.rawOutput && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-danger/60 hover:bg-danger/10 hover:text-danger"
                        onClick={() => setShowRawOutput(v => !v)}
                      >
                        {showRawOutput ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </Button>
                    )}
                  </div>
                </div>
                {thread?.lastError && <p className="text-[12px] text-danger/80 break-words">{thread.lastError}</p>}
                {showRawOutput && planHistory[0]?.rawOutput && (
                  <pre className="mt-2 max-h-[200px] overflow-y-auto text-[11px] text-danger/70 whitespace-pre-wrap break-words border-t border-danger/20 pt-2">{planHistory[0].rawOutput}</pre>
                )}
              </div>
            )}
            <Button size="sm" variant="outline" onClick={handleRerun} disabled={isSubmitting} className="w-full border-danger/40 text-danger hover:bg-danger/10 hover:border-danger">
              {isSubmitting ? 'Starting...' : 'Re-run Pipeline'}
            </Button>
          </div>
        )}

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
                <RefreshCw size={14} className={isRefreshingFromGithub ? 'animate-spin' : ''} />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handleEditPrd}
                title="Edit the PRD body (pushes to the GitHub issue on save)"
                aria-label="Edit PRD"
              >
                <Pencil size={14} />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setPrdCollapsed((v) => !v)}
                title={prdCollapsed ? 'Expand PRD' : 'Collapse PRD'}
                aria-label={prdCollapsed ? 'Expand PRD' : 'Collapse PRD'}
              >
                <ChevronRight
                  size={14}
                  className={`text-muted transition-transform ${prdCollapsed ? '' : 'rotate-90'}`}
                />
              </Button>
            </div>
          </div>
          {!prdCollapsed && (
            activeIssue.body ? (
              <div className="max-h-[300px] overflow-y-auto rounded-md bg-secondary p-3 text-[13px] leading-relaxed text-primary">
                <div className={PRD_PROSE_CLASSES}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeIssue.body}</ReactMarkdown>
                </div>
              </div>
            ) : (
              <div className="rounded-md bg-secondary p-3 text-[13px] text-muted">
                This issue has no PRD body yet. Click "Edit PRD" to author one.
              </div>
            )
          )}
        </div>

        {agentsSection}
        {pipelineSection}
        {approvalSection}
        {planHistorySection}

        {/* Thread exists but no plans yet — only while not failed */}
        {activeThreadId && planHistory.length === 0 && threadPhase !== 'failed' && (
          <div className="mb-5">
            <p className="py-4 text-center text-[13px] text-muted">
              Pipeline is running — waiting for plan generation...
            </p>
          </div>
        )}
      </div>
      {planFullScreenDialog}
    </div>
  );
}
