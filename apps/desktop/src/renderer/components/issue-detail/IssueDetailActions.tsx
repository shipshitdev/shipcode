import type { ClarificationRequest, Thread } from '@shipcode/shared';
import {
  Badge,
  Button,
  ChevronDown,
  ChevronUp,
  Copy,
  cn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@shipcode/ui';
import { getFailurePresentation, PIPELINE_PREVIEW_PHASES, safeErrorMessage } from './helpers';

interface IssueDetailActionsProps {
  approveError: string | null;
  canApprove: boolean;
  canRerun: boolean;
  canStartPipeline: boolean;
  canSubmitClarification: boolean;
  effectiveRevisionCount: number;
  clarificationDraft: Record<
    string,
    {
      selectedChoiceId: string | null;
      freeformText: string;
    }
  >;
  clarificationError: string | null;
  clarificationRequest: ClarificationRequest | null;
  failingPhaseOutput: string | null;
  feedback: string;
  hasApprovalDecision: boolean;
  isSubmitting: boolean;
  pendingAction: 'approve' | 'request_changes' | 'cancel';
  requireApproval: boolean;
  retryButtonLabel: string;
  retrySummary: string | null;
  showRawOutput: boolean;
  thread: Thread | null | undefined;
  onApprove: () => void;
  onCancel: () => void;
  onClarificationChoiceChange: (questionId: string, choiceId: string) => void;
  onClarificationFreeformChange: (questionId: string, value: string) => void;
  onEditPrd: () => void;
  onFeedbackChange: (value: string) => void;
  onMarkAsDone: () => void;
  onPendingActionChange: (value: 'approve' | 'request_changes' | 'cancel') => void;
  onReject: () => void;
  onRerun: () => void;
  onShowRawOutputChange: (show: boolean) => void;
  onStartPipeline: () => void;
  onSubmitClarification: () => void;
}

export function IssueDetailActions({
  approveError,
  canApprove,
  canRerun,
  canStartPipeline,
  canSubmitClarification,
  effectiveRevisionCount,
  clarificationDraft,
  clarificationError,
  clarificationRequest,
  failingPhaseOutput,
  feedback,
  hasApprovalDecision,
  isSubmitting,
  pendingAction,
  requireApproval,
  retryButtonLabel,
  retrySummary,
  showRawOutput,
  thread,
  onApprove,
  onCancel,
  onClarificationChoiceChange,
  onClarificationFreeformChange,
  onEditPrd,
  onFeedbackChange,
  onMarkAsDone,
  onPendingActionChange,
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
          {isSubmitting ? 'Starting…' : 'Start pipeline'}
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

  const clarificationSection = clarificationRequest ? (
    <div className="rounded-lg border border-warning/35 bg-warning/[0.06] p-4 shadow-[0_1px_0_0_rgba(0,0,0,0.2)]">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-warning">
        Planner Input
      </div>
      <div className="mb-1.5 flex items-center gap-2">
        <h4 className="text-[14px] font-semibold leading-snug text-primary">
          Answer these before planning continues
        </h4>
        <Badge variant="warning" className="text-[10px]">
          {clarificationRequest.questions.length}{' '}
          {clarificationRequest.questions.length === 1 ? 'question' : 'questions'}
        </Badge>
      </div>
      <p className="mb-4 text-[12px] leading-relaxed text-secondary">
        {clarificationRequest.summary}
      </p>

      <div className="space-y-3">
        {clarificationRequest.questions.map((question, index) => {
          const answer = clarificationDraft[question.id] ?? {
            selectedChoiceId: null,
            freeformText: '',
          };

          return (
            <div
              key={question.id}
              className="rounded-md border border-border/80 bg-secondary/80 p-3"
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                  Q{index + 1}
                </span>
                <h5 className="text-[13px] font-semibold text-primary">{question.title}</h5>
              </div>
              <p className="text-[12px] leading-relaxed text-secondary">{question.prompt}</p>
              {question.description && (
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
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
                        'rounded-md border px-3 py-2 text-left transition-colors',
                        selected
                          ? 'border-warning/45 bg-warning/[0.08]'
                          : 'border-border bg-primary/30 hover:border-warning/30 hover:bg-warning/[0.04]',
                      )}
                      onClick={() => onClarificationChoiceChange(question.id, choice.id)}
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
                    onChange={(event) =>
                      onClarificationFreeformChange(question.id, event.target.value)
                    }
                    placeholder={question.freeformPlaceholder ?? 'Add context if needed'}
                    rows={3}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {clarificationError && <p className="mt-3 text-[11px] text-danger">{clarificationError}</p>}

      <div className="mt-4 flex items-center gap-3">
        <Button
          size="sm"
          onClick={onSubmitClarification}
          disabled={isSubmitting || !canSubmitClarification}
        >
          {isSubmitting ? 'Submitting…' : 'Resume planning'}
        </Button>
        <p className="text-[11px] text-muted">
          ShipCode will start a fresh planning pass with these answers folded into the prompt.
        </p>
      </div>
    </div>
  ) : null;

  const rerunSection = canRerun ? (
    <div className="mb-5">
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
          {isSubmitting ? 'Starting...' : retryButtonLabel}
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
    <div className="mb-5 rounded-md border border-border bg-secondary p-3">
      <div
        className={
          pendingAction === 'request_changes'
            ? 'mb-3 flex items-center gap-2'
            : 'flex items-center gap-2'
        }
      >
        <Select
          value={pendingAction}
          onValueChange={(value) =>
            onPendingActionChange(value as 'approve' | 'request_changes' | 'cancel')
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
            onClick={onApprove}
            disabled={isSubmitting || !canApprove}
            title={
              !canApprove ? 'No plan content found - use Request Changes or Cancel' : undefined
            }
          >
            {isSubmitting ? 'Approving...' : 'Confirm'}
          </Button>
        )}
        {pendingAction === 'cancel' && (
          <Button size="sm" variant="destructive" onClick={onCancel} disabled={isSubmitting}>
            {isSubmitting ? 'Cancelling...' : 'Confirm cancel'}
          </Button>
        )}
      </div>
      {pendingAction === 'request_changes' && (
        <div className="flex flex-col gap-2">
          <Textarea
            value={feedback}
            onChange={(event) => onFeedbackChange(event.target.value)}
            placeholder="Tell the planner what to change before the next pass..."
            rows={4}
          />
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={onReject}
              disabled={!feedback.trim() || isSubmitting}
            >
              {isSubmitting ? 'Submitting...' : 'Resume planning with feedback'}
            </Button>
          </div>
        </div>
      )}
      {approveError && (
        <p className="mt-2 text-[11px] text-danger">
          {approveError} <span className="text-muted">(full trace in devtools console)</span>
        </p>
      )}
    </div>
  ) : null;

  return {
    approvalSection,
    clarificationSection,
    pipelineStartCard,
    rerunSection,
  };
}
