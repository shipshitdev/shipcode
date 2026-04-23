import type { ClarificationAnswer, ClarificationRequest, Thread } from '@shipcode/shared';
import {
  Badge,
  Button,
  ChevronDown,
  ChevronUp,
  Copy,
  cn,
  LoadingButtonContent,
  Textarea,
} from '@shipshitdev/ui';
import { useMemo, useState } from 'react';
import { getFailurePresentation, PIPELINE_PREVIEW_PHASES, safeErrorMessage } from './helpers';

type ClarificationDraft = Record<
  string,
  {
    selectedChoiceId: string | null;
    freeformText: string;
  }
>;

interface IssueDetailActionsProps {
  approveError: string | null;
  approvedAwaitingExecution: boolean;
  canApprove: boolean;
  canRerun: boolean;
  canStartPipeline: boolean;
  effectiveRevisionCount: number;
  clarificationRequest: ClarificationRequest | null;
  failingPhaseOutput: string | null;
  hasApprovalDecision: boolean;
  isSubmitting: boolean;
  requireApproval: boolean;
  retryButtonLabel: string;
  retrySummary: string | null;
  showRawOutput: boolean;
  thread: Thread | null | undefined;
  onApprove: () => void;
  onCancel: () => void;
  onEditPrd: () => void;
  onMarkAsDone: () => void;
  onReject: (feedback: string) => void;
  onRerun: () => void;
  onShowRawOutputChange: (show: boolean) => void;
  onStartPipeline: () => void;
  onSubmitClarification: (answers: ClarificationAnswer[]) => Promise<void>;
}

function buildClarificationDraft(
  request: ClarificationRequest,
  thread: Thread | null | undefined,
): ClarificationDraft {
  return Object.fromEntries(
    request.questions.map((question) => {
      const existing = thread?.clarificationAnswers.find(
        (answer) => answer.questionId === question.id,
      );
      return [
        question.id,
        {
          selectedChoiceId:
            existing?.selectedChoiceId ??
            question.choices.find((choice) => choice.recommended)?.id ??
            null,
          freeformText: existing?.freeformText ?? '',
        },
      ];
    }),
  );
}

function ClarificationSection({
  isSubmitting,
  request,
  thread,
  onSubmitClarification,
}: {
  isSubmitting: boolean;
  request: ClarificationRequest;
  thread: Thread;
  onSubmitClarification: (answers: ClarificationAnswer[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ClarificationDraft>(() =>
    buildClarificationDraft(request, thread),
  );
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(
    () =>
      request.questions.every((question) => {
        const answer = draft[question.id];
        const hasChoice = !!answer?.selectedChoiceId;
        const hasFreeform = !!answer?.freeformText.trim();
        return hasChoice || (question.allowFreeform && hasFreeform);
      }),
    [draft, request.questions],
  );

  const handleChoiceChange = (questionId: string, choiceId: string) => {
    setDraft((current) => ({
      ...current,
      [questionId]: {
        selectedChoiceId: choiceId,
        freeformText: current[questionId]?.freeformText ?? '',
      },
    }));
    setError(null);
  };

  const handleFreeformChange = (questionId: string, value: string) => {
    setDraft((current) => ({
      ...current,
      [questionId]: {
        selectedChoiceId: current[questionId]?.selectedChoiceId ?? null,
        freeformText: value,
      },
    }));
    setError(null);
  };

  const handleSubmit = async () => {
    setError(null);
    try {
      const answers: ClarificationAnswer[] = request.questions.map((question) => {
        const answer = draft[question.id];
        const freeformText = answer?.freeformText.trim();
        return {
          questionId: question.id,
          selectedChoiceId: answer?.selectedChoiceId ?? null,
          freeformText: freeformText ? freeformText : null,
        };
      });
      await onSubmitClarification(answers);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    }
  };

  return (
    <section className="rounded-xl border border-warning/25 bg-warning/[0.04] p-4 shadow-[0_1px_0_0_rgba(0,0,0,0.18)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-warning">
            Planner Input
          </div>
          <h4 className="text-[15px] font-semibold leading-snug text-primary">
            Answer these before planning continues
          </h4>
          <p className="mt-2 max-w-4xl text-[12px] leading-relaxed text-secondary">
            {request.summary}
          </p>
        </div>
        <Badge variant="warning" className="shrink-0 text-[10px]">
          {request.questions.length} {request.questions.length === 1 ? 'question' : 'questions'}
        </Badge>
      </div>

      <div className="mt-5 overflow-hidden rounded-lg border border-warning/15 bg-primary/20">
        {request.questions.map((question, index) => {
          const answer = draft[question.id] ?? {
            selectedChoiceId: null,
            freeformText: '',
          };

          return (
            <section
              key={question.id}
              className={cn('px-4 py-4', index > 0 && 'border-t border-warning/10')}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-warning/80">
                  Q{index + 1}
                </span>
                <h5 className="text-[13px] font-semibold text-primary/95">{question.title}</h5>
              </div>
              <p className="text-[12px] leading-relaxed text-secondary">{question.prompt}</p>
              {question.description && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                  {question.description}
                </p>
              )}

              <div className="mt-3 flex flex-col gap-2">
                {question.choices.map((choice) => {
                  const selected = answer.selectedChoiceId === choice.id;
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      className={cn(
                        'rounded-md border px-3 py-2.5 text-left transition-colors',
                        selected
                          ? 'border-warning/45 bg-warning/[0.12]'
                          : 'border-border/70 bg-secondary/35 hover:border-warning/30 hover:bg-warning/[0.05]',
                      )}
                      onClick={() => handleChoiceChange(question.id, choice.id)}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'h-2.5 w-2.5 rounded-full border',
                            selected ? 'border-warning bg-warning' : 'border-border bg-transparent',
                          )}
                        />
                        <span className="text-[12px] font-medium text-primary">{choice.label}</span>
                        {choice.recommended && (
                          <Badge variant="default" className="text-[9px] uppercase">
                            Recommended
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 pl-[18px] text-[11px] leading-relaxed text-secondary">
                        {choice.description}
                      </p>
                    </button>
                  );
                })}
              </div>

              {question.allowFreeform && (
                <div className="mt-3">
                  <Textarea
                    value={answer.freeformText}
                    onChange={(event) => handleFreeformChange(question.id, event.target.value)}
                    placeholder={question.freeformPlaceholder ?? 'Add context if needed'}
                    rows={3}
                  />
                </div>
              )}
            </section>
          );
        })}
      </div>

      {error && <p className="mt-3 text-[11px] text-danger">{error}</p>}

      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" onClick={handleSubmit} disabled={isSubmitting || !canSubmit}>
          <LoadingButtonContent loading={isSubmitting}>Resume planning</LoadingButtonContent>
        </Button>
        <p className="text-[11px] text-muted">
          ShipCode will start a fresh planning pass with these answers folded into the prompt.
        </p>
      </div>
    </section>
  );
}

export function IssueDetailActions({
  approveError,
  approvedAwaitingExecution,
  canApprove,
  canRerun,
  canStartPipeline,
  effectiveRevisionCount,
  clarificationRequest,
  failingPhaseOutput,
  hasApprovalDecision,
  isSubmitting,
  requireApproval,
  retryButtonLabel,
  retrySummary,
  showRawOutput,
  thread,
  onApprove,
  onCancel,
  onEditPrd,
  onMarkAsDone,
  onReject,
  onRerun,
  onShowRawOutputChange,
  onStartPipeline,
  onSubmitClarification,
}: IssueDetailActionsProps) {
  const failurePresentation = getFailurePresentation(
    thread?.lastError ?? failingPhaseOutput,
    thread,
  );
  const answeredClarification = thread?.answeredClarification ?? null;
  const previewPhases =
    effectiveRevisionCount > 0
      ? PIPELINE_PREVIEW_PHASES
      : PIPELINE_PREVIEW_PHASES.filter((phase) => phase.id !== 'review');
  const pipelineStartCard = canStartPipeline ? (
    <div className="rounded-lg border border-border bg-tertiary p-4 shadow-[0_1px_0_0_rgba(0,0,0,0.3)]">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
        Ready
      </div>
      <h4 className="mb-1.5 text-[14px] font-semibold leading-snug text-primary">
        Run the agent pipeline
      </h4>
      <p className="mb-5 text-[12px] leading-relaxed text-secondary">
        {effectiveRevisionCount > 0
          ? `ShipCode will plan, run ${effectiveRevisionCount} revision${effectiveRevisionCount === 1 ? '' : 's'}, and then ${
              requireApproval ? 'pause for approval' : 'execute automatically'
            } in an isolated worktree.`
          : `ShipCode will plan and then ${
              requireApproval ? 'pause for approval' : 'execute automatically'
            } in an isolated worktree. Review is skipped for this issue.`}
      </p>

      <ol className="mb-5 flex items-center gap-2 overflow-x-auto whitespace-nowrap [&::-webkit-scrollbar]:hidden">
        {previewPhases.map((phase, index) => (
          <li key={phase.id} className="inline-flex shrink-0 items-center gap-2 text-muted">
            <span className="flex h-4 w-4 items-center justify-center rounded-full border border-border bg-tertiary font-mono text-[8px] font-medium">
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

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={onStartPipeline} disabled={isSubmitting}>
          <LoadingButtonContent loading={isSubmitting}>Start pipeline</LoadingButtonContent>
        </Button>
        <Button
          variant="link"
          size="xs"
          onClick={onEditPrd}
          className="px-0 text-muted hover:text-primary"
        >
          Edit
        </Button>
      </div>
    </div>
  ) : null;

  const clarificationSection =
    clarificationRequest && thread?.status === 'clarifying' ? (
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

        <div className="mt-5 overflow-hidden rounded-lg border border-agent/15 bg-primary/20">
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
              <section
                key={question.id}
                className={cn('px-4 py-4', index > 0 && 'border-t border-agent/10')}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-agent/80">
                    Q{index + 1}
                  </span>
                  <h5 className="text-[13px] font-semibold text-primary/95">{question.title}</h5>
                </div>

                {selectedChoice ? (
                  <div className="rounded-md border border-agent/20 bg-agent/[0.08] px-3 py-2.5">
                    <div className="text-[12px] font-medium text-primary">
                      {selectedChoice.label}
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-secondary">
                      {selectedChoice.description}
                    </p>
                  </div>
                ) : null}

                {freeformText ? (
                  <div className={cn(selectedChoice ? 'mt-3' : '')}>
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-agent/80">
                      Note
                    </p>
                    <div className="rounded-md border border-border/70 bg-secondary/35 px-3 py-2.5 text-[12px] leading-relaxed whitespace-pre-wrap text-secondary">
                      {freeformText}
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </section>
    ) : null;

  const rerunSection = canRerun ? (
    <div>
      {(thread?.lastError || failingPhaseOutput) && (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-danger">
              {failurePresentation.label}
            </p>
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
          {failurePresentation.detail && (
            <p className="mb-2 text-[11px] text-danger/70">{failurePresentation.detail}</p>
          )}
          {thread?.lastError && (
            <p className="text-[12px] text-danger/80 break-words">
              {safeErrorMessage(thread.lastError)}
            </p>
          )}
          {showRawOutput && failingPhaseOutput && (
            <pre className="mt-2 max-h-[200px] overflow-y-auto border-t border-danger/20 pt-2 text-[11px] text-danger/70 whitespace-pre-wrap break-words">
              {failingPhaseOutput}
            </pre>
          )}
        </div>
      )}
      {retrySummary ? <p className="mb-3 text-[11px] text-muted">{retrySummary}</p> : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onRerun}
          disabled={isSubmitting}
          className="flex-1 border-danger/40 text-danger hover:bg-danger/10 hover:border-danger"
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
          Mark As Done
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
              Waiting For Execution Slot
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

  return {
    approvalSection,
    clarificationSection,
    pipelineStartCard,
    rerunSection,
  };
}
