import type { ClarificationAnswer, ClarificationRequest, Thread } from '@shipcode/shared';
import { AGENT_RUNNING_PHASES, PIPELINE_PHASE } from '@shipcode/shared';
import { Badge, Button, cn } from '@shipshitdev/ui';
import { LoadingButtonContent } from '@shipshitdev/ui/common';
import { ChevronDown, ChevronUp, Copy, GitPullRequest } from 'lucide-react';
import { ApprovalSection } from './ApprovalSection';
import {
  getFailurePresentation,
  getTriageFailurePresentation,
  PIPELINE_PREVIEW_PHASES,
  safeErrorMessage,
  stripAnsi,
} from './helpers';
import { ClarificationSection } from './IssueDetailClarificationSection';

interface IssueDetailActionsProps {
  approveError: string | null;
  approvedAwaitingExecution: boolean;
  canApprove: boolean;
  canRerun: boolean;
  canStartPipeline: boolean;
  effectiveRevisionCount: number;
  clarificationRequest: ClarificationRequest | null;
  failingPhaseOutput: string | null;
  triageFailureReason?: string | null;
  hasDiffs: boolean;
  hasApprovalDecision: boolean;
  isCompleted: boolean;
  isSubmitting: boolean;
  requireApproval: boolean;
  retryButtonLabel: string;
  retrySummary: string | null;
  showRawOutput: boolean;
  thread: Thread | null | undefined;
  verificationSummary: string | null;
  onApprove: () => void;
  onCancel: () => void;
  onEditPrd: () => void;
  onMarkAsDone: () => void;
  onReject: (feedback: string) => void;
  onRerun: () => void;
  onShowRawOutputChange: (show: boolean) => void;
  onStartPipeline: () => void;
  onSubmitClarification: (answers: ClarificationAnswer[]) => Promise<void>;
  // Create PR
  canCreatePr?: boolean;
  isCreatingPr?: boolean;
  createPrError?: string | null;
  onCreatePr?: () => void;
  // Issue-linked terminal sessions
  canOpenIssueTerminal?: boolean;
  openingIssueTerminalProvider?: 'claude' | 'codex' | null;
  onOpenIssueTerminal?: (provider: 'claude' | 'codex') => void;
}

export function buildIssueDetailActions({
  approveError,
  approvedAwaitingExecution,
  canApprove,
  canRerun,
  canStartPipeline,
  effectiveRevisionCount,
  clarificationRequest,
  failingPhaseOutput,
  triageFailureReason,
  hasDiffs,
  hasApprovalDecision,
  isCompleted,
  isSubmitting,
  requireApproval,
  retryButtonLabel,
  retrySummary,
  showRawOutput,
  thread,
  verificationSummary,
  onApprove,
  onCancel,
  onEditPrd,
  onMarkAsDone,
  onReject,
  onRerun,
  onShowRawOutputChange,
  onStartPipeline,
  onSubmitClarification,
  canCreatePr,
  isCreatingPr,
  createPrError,
  onCreatePr,
  canOpenIssueTerminal,
  openingIssueTerminalProvider,
  onOpenIssueTerminal,
}: IssueDetailActionsProps) {
  const failurePresentation = getFailurePresentation(
    thread?.lastError ?? failingPhaseOutput,
    thread,
  );
  const triageFailurePresentation = getTriageFailurePresentation(triageFailureReason);
  const answeredClarification = thread?.answeredClarification ?? null;
  const isThreadRunning = thread ? AGENT_RUNNING_PHASES.includes(thread.status) : false;
  const previewPhases =
    effectiveRevisionCount > 0
      ? PIPELINE_PREVIEW_PHASES
      : PIPELINE_PREVIEW_PHASES.filter((phase) => phase.id !== 'review');
  const terminalControls =
    canOpenIssueTerminal && onOpenIssueTerminal && !isThreadRunning ? (
      <div className="mt-4 border-t border-border/70 pt-4">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Manual run
        </div>
        <p className="mb-3 text-[12px] leading-relaxed text-secondary">
          Open a CLI in this issue worktree. ShipCode keeps this pipeline thread active and saves
          the transcript here.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={openingIssueTerminalProvider != null}
            onClick={() => onOpenIssueTerminal('claude')}
          >
            <LoadingButtonContent loading={openingIssueTerminalProvider === 'claude'}>
              Claude CLI
            </LoadingButtonContent>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={openingIssueTerminalProvider != null}
            onClick={() => onOpenIssueTerminal('codex')}
          >
            <LoadingButtonContent loading={openingIssueTerminalProvider === 'codex'}>
              Codex CLI
            </LoadingButtonContent>
          </Button>
        </div>
      </div>
    ) : null;
  const pipelineStartCard =
    canStartPipeline || terminalControls ? (
      <div className="rounded-lg border border-border bg-tertiary p-4 shadow-[0_1px_0_0_rgba(0,0,0,0.3)]">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Pipeline
        </div>
        <h4 className="mb-1.5 text-[14px] font-semibold leading-snug text-primary">
          Run this issue
        </h4>
        {canStartPipeline ? (
          <p className="mb-5 text-[12px] leading-relaxed text-secondary">
            {effectiveRevisionCount > 0
              ? `ShipCode will plan, run ${effectiveRevisionCount} revision${effectiveRevisionCount === 1 ? '' : 's'}, and then ${
                  requireApproval ? 'pause for approval' : 'execute automatically'
                } in an isolated worktree.`
              : `ShipCode will plan and then ${
                  requireApproval ? 'pause for approval' : 'execute automatically'
                } in an isolated worktree. Review is skipped for this issue.`}
          </p>
        ) : terminalControls ? (
          <p className="mb-4 text-[12px] leading-relaxed text-secondary">
            Continue the same issue pipeline from a terminal.
          </p>
        ) : null}

        {canStartPipeline ? (
          <ol className="mb-5 flex items-center gap-2 overflow-x-auto whitespace-nowrap [&::-webkit-scrollbar]:hidden">
            {previewPhases.map((phase, index) => (
              <li
                key={phase.id}
                className="inline-flex shrink-0 items-center gap-2 text-muted-foreground"
              >
                <span className="flex size-4 items-center justify-center rounded-full border border-border bg-tertiary font-mono text-[8px] font-medium">
                  {index + 1}
                </span>
                <span className="text-[9px] font-semibold uppercase tracking-[0.08em]">
                  {phase.label}
                </span>
                {index < previewPhases.length - 1 ? (
                  <span aria-hidden="true" className="text-border">
                    /
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}

        {canStartPipeline ? (
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={onStartPipeline} disabled={isSubmitting}>
              <LoadingButtonContent loading={isSubmitting}>Start pipeline</LoadingButtonContent>
            </Button>
            <Button
              variant="link"
              size="xs"
              onClick={onEditPrd}
              className="px-0 text-muted-foreground hover:text-primary"
            >
              Edit
            </Button>
          </div>
        ) : null}
        {terminalControls}
      </div>
    ) : null;

  const clarificationSection =
    clarificationRequest && thread?.status === PIPELINE_PHASE.clarifying ? (
      <ClarificationSection
        key={`${thread.id}:${clarificationRequest.id}`}
        isSubmitting={isSubmitting}
        request={clarificationRequest}
        thread={thread}
        onSubmitClarification={onSubmitClarification}
      />
    ) : answeredClarification ? (
      <section className="rounded-xl border border-agent/25 bg-agent/[0.04] p-4 shadow-[0_1px_0_0_rgba(0,0,0,0.18)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-agent">
              Planner Input
            </div>
            <h4 className="text-[15px] font-semibold leading-snug text-primary">
              Planning resumed with your answers
            </h4>
            <p className="mt-2 max-w-4xl text-[12px] leading-relaxed text-secondary">
              These answers were folded into the current planning pass.
            </p>
          </div>
          <Badge variant="success" className="shrink-0 text-[10px]">
            Answered
          </Badge>
        </div>

        <div className="mt-4 space-y-3">
          {answeredClarification.request.questions.map((question, index) => {
            const answer = answeredClarification.answers.find(
              (entry) => entry.questionId === question.id,
            );
            const selectedChoice =
              answer?.selectedChoiceId != null
                ? (question.choices.find((choice) => choice.id === answer.selectedChoiceId) ?? null)
                : null;
            const freeformText = answer?.freeformText?.trim() ?? '';

            return (
              <div key={question.id} className="border-l-2 border-agent/30 pl-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-agent/70">
                    Q{index + 1}
                  </span>
                  <h5 className="text-[12px] font-semibold text-primary/90">{question.title}</h5>
                </div>

                {selectedChoice ? (
                  <div>
                    <div className="text-[12px] font-medium text-primary">
                      {selectedChoice.label}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-secondary">
                      {selectedChoice.description}
                    </p>
                  </div>
                ) : null}

                {freeformText ? (
                  <p
                    className={cn(
                      'text-[11px] leading-relaxed whitespace-pre-wrap text-secondary',
                      selectedChoice ? 'mt-1.5' : undefined,
                    )}
                  >
                    {freeformText}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    ) : null;

  const rerunSection = canRerun ? (
    <div>
      <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-danger">
            {failurePresentation.label}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-danger/60 hover:bg-danger/10 hover:text-danger"
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
                size="icon"
                className="size-6 text-danger/60 hover:bg-danger/10 hover:text-danger"
                title={showRawOutput ? 'Hide raw output' : 'Show raw output'}
                aria-label={showRawOutput ? 'Hide raw output' : 'Show raw output'}
                onClick={() => onShowRawOutputChange(!showRawOutput)}
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
        {failurePresentation.detail ? (
          <p className="mb-2 text-[11px] text-danger/70">{failurePresentation.detail}</p>
        ) : null}
        {thread?.lastError ? (
          <p className="text-[12px] text-danger/80 break-words">
            {stripAnsi(safeErrorMessage(thread.lastError))}
          </p>
        ) : !failingPhaseOutput ? (
          <p className="text-[12px] text-danger/70 italic break-words">
            No error message captured. Check the Pipeline tab terminal output for details.
          </p>
        ) : null}
        {showRawOutput && failingPhaseOutput && (
          <pre className="mt-2 max-h-[200px] overflow-y-auto border-t border-danger/20 pt-2 text-[11px] text-danger/70 whitespace-pre-wrap break-words">
            {stripAnsi(failingPhaseOutput)}
          </pre>
        )}
      </div>
      {retrySummary ? (
        <p className="mb-3 text-[11px] text-muted-foreground">{retrySummary}</p>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          onClick={onRerun}
          disabled={isSubmitting}
          className="flex-1"
        >
          <LoadingButtonContent loading={isSubmitting}>{retryButtonLabel}</LoadingButtonContent>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onMarkAsDone}
          disabled={isSubmitting}
          className="flex-1 border-purple-500/40 text-purple-400 hover:border-purple-500 hover:bg-purple-500/10"
        >
          Close Issue
        </Button>
      </div>
    </div>
  ) : null;

  const completionSection = isCompleted ? (
    <div className="flex items-center justify-between rounded-md border border-success/30 bg-success/10 px-3 py-2">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-success">
          Pipeline Completed
        </p>
        {verificationSummary ? (
          <span className="text-[11px] text-muted-foreground" title={verificationSummary}>
            {verificationSummary.slice(0, 80)}
            {verificationSummary.length > 80 ? '…' : ''}
          </span>
        ) : !hasDiffs ? (
          <span className="text-[11px] text-muted-foreground">no code changes</span>
        ) : null}
        {thread?.totalCostUsd ? (
          <span className="text-[11px] text-muted-foreground">
            · ${thread.totalCostUsd.toFixed(4)}
          </span>
        ) : null}
        {createPrError && <span className="text-[11px] text-destructive">{createPrError}</span>}
      </div>
      <div className="flex items-center gap-2">
        {canCreatePr && onCreatePr && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onCreatePr}
            disabled={isSubmitting || !!isCreatingPr}
            className="gap-1"
          >
            <GitPullRequest className="size-3" />
            <LoadingButtonContent loading={!!isCreatingPr}>Create PR</LoadingButtonContent>
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          onClick={() => {
            onMarkAsDone();
          }}
          disabled={isSubmitting}
          className="bg-purple-600 text-white hover:bg-purple-500"
        >
          Close Issue
        </Button>
      </div>
    </div>
  ) : null;

  const approvalSection = hasApprovalDecision ? (
    <ApprovalSection
      key={thread?.id ?? 'approval'}
      approveError={approveError}
      canApprove={canApprove}
      isSubmitting={isSubmitting}
      onApprove={onApprove}
      onCancel={onCancel}
      onReject={onReject}
    />
  ) : approvedAwaitingExecution ? (
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
            Approval is already confirmed. ShipCode will start execution as soon as the current
            execution slot frees up.
          </p>
        </div>
        <Button size="sm" variant="destructive" onClick={onCancel} disabled={isSubmitting}>
          <LoadingButtonContent loading={isSubmitting}>Cancel</LoadingButtonContent>
        </Button>
      </div>
    </div>
  ) : null;

  const triageFailureSection = triageFailurePresentation ? (
    <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-danger">
        {triageFailurePresentation.label}
      </p>
      <p className="text-[12px] text-danger/80 break-words">{triageFailurePresentation.detail}</p>
    </div>
  ) : null;

  return {
    approvalSection,
    clarificationSection,
    completionSection,
    pipelineStartCard,
    rerunSection,
    triageFailureSection,
  };
}
