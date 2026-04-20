import type { PlanRecord, ReviewRecord } from '@shipcode/shared';
import { Button, Modal, ModalFooter, PlanViewer, ReviewViewer, X } from '@shipcode/ui';
import { diagnosePlanParseFailure, resolveClientSidePlan } from './helpers';

interface IssueDetailDialogsProps {
  activeIssueNumber: number;
  canApprove: boolean;
  fullScreenPlan: PlanRecord | null;
  fullScreenPlanId: string | null;
  fullScreenReview?: ReviewRecord;
  isFullScreenPlanLoading: boolean;
  isSubmitting: boolean;
  latestPlanId: string | null;
  onApprove: () => void;
  onArchiveConfirmed: () => void;
  onCloseArchiveConfirm: () => void;
  onCloseFullScreenPlan: () => void;
  onMarkAsDoneConfirmed: () => void;
  onCloseMarkAsDoneConfirm: () => void;
  showArchiveConfirm: boolean;
  showMarkAsDoneConfirm: boolean;
}

export function IssueDetailDialogs({
  activeIssueNumber,
  canApprove,
  fullScreenPlan,
  fullScreenPlanId,
  fullScreenReview,
  isFullScreenPlanLoading,
  isSubmitting,
  latestPlanId,
  onApprove,
  onArchiveConfirmed,
  onCloseArchiveConfirm,
  onCloseFullScreenPlan,
  onMarkAsDoneConfirmed,
  onCloseMarkAsDoneConfirm,
  showArchiveConfirm,
  showMarkAsDoneConfirm,
}: IssueDetailDialogsProps) {
  const fullScreenClientPlan =
    fullScreenPlan && !fullScreenPlan.structured
      ? resolveClientSidePlan(fullScreenPlan.rawOutput ?? '')
      : null;
  const fullScreenDisplayPlan = fullScreenPlan?.structured ?? fullScreenClientPlan;
  const fullScreenIsLatest = fullScreenPlanId === latestPlanId;
  const fullScreenParseFailureMessage = fullScreenPlan?.rawOutput.trim()
    ? diagnosePlanParseFailure(fullScreenPlan.rawOutput)
    : 'Structured plan data is unavailable for this version.';

  return (
    <>
      <Modal
        open={fullScreenPlanId !== null}
        onClose={onCloseFullScreenPlan}
        title={`Plan v${fullScreenPlan?.version}${fullScreenPlan?.status ? ` - ${fullScreenPlan.status}` : ''}`}
        className="max-w-4xl h-[90vh] flex flex-col overflow-hidden p-0"
        headerClassName="shrink-0 border-b border-border px-6 py-4"
        headerAction={
          <Button variant="ghost" className="h-7 w-7 p-0" onClick={onCloseFullScreenPlan}>
            <X size={15} strokeWidth={2.25} />
          </Button>
        }
      >
        <div className="flex-1 overflow-y-auto">
          {fullScreenDisplayPlan && <PlanViewer plan={fullScreenDisplayPlan} />}
          {fullScreenReview?.structured && <ReviewViewer review={fullScreenReview.structured} />}
          {!fullScreenDisplayPlan && isFullScreenPlanLoading && (
            <div className="p-6 text-sm text-muted">Loading plan details…</div>
          )}
          {!fullScreenDisplayPlan && fullScreenPlan && !isFullScreenPlanLoading && (
            <div className="p-6">
              <div className="space-y-2 rounded-md border border-warning/30 bg-warning/10 px-4 py-3">
                <p className="text-sm font-medium text-warning">Structured plan unavailable</p>
                <p className="text-sm text-muted">{fullScreenParseFailureMessage}</p>
                <p className="text-sm text-muted">
                  Raw planner transcript is hidden here. Use the terminal drawer for subprocess
                  output.
                </p>
              </div>
            </div>
          )}
        </div>
        {canApprove && fullScreenIsLatest && (
          <ModalFooter className="shrink-0 border-t border-border px-6 py-4">
            <Button
              onClick={() => {
                onApprove();
                onCloseFullScreenPlan();
              }}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Approving...' : 'Approve & Execute'}
            </Button>
          </ModalFooter>
        )}
      </Modal>

      <Modal
        open={showArchiveConfirm}
        onClose={onCloseArchiveConfirm}
        title={`Archive issue #${activeIssueNumber}?`}
        className="max-w-sm"
      >
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          Warning: this closes the GitHub issue and archives its GitHub Project card. Archived items
          disappear from the Done column.
        </div>
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={onCloseArchiveConfirm}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={onArchiveConfirmed}>
            Archive
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        open={showMarkAsDoneConfirm}
        onClose={onCloseMarkAsDoneConfirm}
        title={`Mark issue #${activeIssueNumber} as done?`}
        className="max-w-sm"
      >
        <p className="text-sm text-secondary">
          This will move the issue to the Done column. You can still reopen it later from GitHub.
        </p>
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={onCloseMarkAsDoneConfirm}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onMarkAsDoneConfirmed}
            disabled={isSubmitting}
            className="bg-purple-600 text-white hover:bg-purple-700"
          >
            {isSubmitting ? 'Marking...' : 'Mark As Done'}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
