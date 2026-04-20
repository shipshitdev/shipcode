import type { Thread } from '@shipcode/shared';
import {
  Button,
  ChevronDown,
  ChevronUp,
  Copy,
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
  failingPhaseOutput: string | null;
  feedback: string;
  hasApprovalDecision: boolean;
  isSubmitting: boolean;
  pendingAction: 'approve' | 'request_changes' | 'cancel';
  showRawOutput: boolean;
  thread: Thread | null | undefined;
  onApprove: () => void;
  onCancel: () => void;
  onEditPrd: () => void;
  onFeedbackChange: (value: string) => void;
  onMarkAsDone: () => void;
  onPendingActionChange: (value: 'approve' | 'request_changes' | 'cancel') => void;
  onReject: () => void;
  onRerun: () => void;
  onShowRawOutputChange: (show: boolean) => void;
  onStartPipeline: () => void;
}

export function IssueDetailActions({
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
  onApprove,
  onCancel,
  onEditPrd,
  onFeedbackChange,
  onMarkAsDone,
  onPendingActionChange,
  onReject,
  onRerun,
  onShowRawOutputChange,
  onStartPipeline,
}: IssueDetailActionsProps) {
  const failurePresentation = getFailurePresentation(
    thread?.lastError ?? failingPhaseOutput,
    thread,
  );
  const pipelineStartCard = canStartPipeline ? (
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

      <ol className="mb-5 flex items-center gap-2 overflow-x-auto whitespace-nowrap [&::-webkit-scrollbar]:hidden">
        {PIPELINE_PREVIEW_PHASES.map((phase, index) => (
          <li key={phase.id} className="inline-flex shrink-0 items-center gap-2 text-muted">
            <span className="flex h-4 w-4 items-center justify-center rounded-full border border-border bg-tertiary font-mono text-[8px] font-medium">
              {index + 1}
            </span>
            <span className="text-[9px] font-semibold uppercase tracking-[0.08em]">
              {phase.label}
            </span>
            {index < PIPELINE_PREVIEW_PHASES.length - 1 ? (
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
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onRerun}
          disabled={isSubmitting}
          className="flex-1 border-danger/40 text-danger hover:bg-danger/10 hover:border-danger"
        >
          {isSubmitting ? 'Starting...' : 'Retry'}
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
            placeholder="Send direction for another planning round..."
            rows={4}
          />
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={onReject}
              disabled={!feedback.trim() || isSubmitting}
            >
              {isSubmitting ? 'Submitting...' : 'Re-plan with feedback'}
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
    pipelineStartCard,
    rerunSection,
  };
}
