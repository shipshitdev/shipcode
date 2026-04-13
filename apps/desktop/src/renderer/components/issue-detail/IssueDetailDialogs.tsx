import type { PlanRecord, ReviewRecord } from '@shipcode/shared';
import { Button, Modal, ModalFooter, PlanViewer, ReviewViewer, X } from '@shipcode/ui';
import { resolveClientSidePlan, resolveRawPlanText } from './helpers';

interface IssueDetailDialogsProps {
  activeIssueNumber: number;
  canApprove: boolean;
  fullScreenPlan: PlanRecord | null;
  fullScreenPlanId: string | null;
  fullScreenReview?: ReviewRecord;
  isSubmitting: boolean;
  latestPlanId: string | null;
  onApprove: () => void;
  onArchiveConfirmed: () => void;
  onCloseArchiveConfirm: () => void;
  onCloseFullScreenPlan: () => void;
  showArchiveConfirm: boolean;
}

export function IssueDetailDialogs({
  activeIssueNumber,
  canApprove,
  fullScreenPlan,
  fullScreenPlanId,
  fullScreenReview,
  isSubmitting,
  latestPlanId,
  onApprove,
  onArchiveConfirmed,
  onCloseArchiveConfirm,
  onCloseFullScreenPlan,
  showArchiveConfirm,
}: IssueDetailDialogsProps) {
  const fullScreenClientPlan =
    fullScreenPlan && !fullScreenPlan.structured
      ? resolveClientSidePlan(fullScreenPlan.rawOutput ?? '')
      : null;
  const fullScreenDisplayPlan = fullScreenPlan?.structured ?? fullScreenClientPlan;
  const fullScreenIsLatest = fullScreenPlanId === latestPlanId;

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
    </>
  );
}
