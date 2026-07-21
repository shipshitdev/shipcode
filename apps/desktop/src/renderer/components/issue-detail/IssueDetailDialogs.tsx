import type { PlanRecord, ReviewRecord } from '@shipcode/shared';
import { ConfirmDialog, PlanViewer, ReviewViewer } from '@shipcode/ui';
import { Button, Modal, ModalFooter } from '@shipshitdev/ui';
import { LoadingButtonContent } from '@shipshitdev/ui/common';
import { X } from 'lucide-react';
import { diagnosePlanParseFailure, resolveClientSidePlan } from './helpers';

interface IssueDetailDialogsProps {
  activeIssueNumber: number;
  fullScreenPlan: PlanRecord | null;
  fullScreenPlanId: string | null;
  fullScreenReview?: ReviewRecord;
  latestPlanId: string | null;
  state: {
    canApprove: boolean;
    isFullScreenPlanLoading: boolean;
    isSubmitting: boolean;
    showArchiveConfirm: boolean;
    showMarkAsDoneConfirm: boolean;
  };
  onApprove: () => void;
  onArchiveConfirmed: () => void;
  onCloseArchiveConfirm: () => void;
  onCloseFullScreenPlan: () => void;
  onMarkAsDoneConfirmed: () => void;
  onCloseMarkAsDoneConfirm: () => void;
}

export function buildIssueDetailDialogs({
  activeIssueNumber,
  fullScreenPlan,
  fullScreenPlanId,
  fullScreenReview,
  latestPlanId,
  state,
  onApprove,
  onArchiveConfirmed,
  onCloseArchiveConfirm,
  onCloseFullScreenPlan,
  onMarkAsDoneConfirmed,
  onCloseMarkAsDoneConfirm,
}: IssueDetailDialogsProps) {
  const {
    canApprove,
    isFullScreenPlanLoading,
    isSubmitting,
    showArchiveConfirm,
    showMarkAsDoneConfirm,
  } = state;
  const fullScreenClientPlan =
    fullScreenPlan && !fullScreenPlan.structured
      ? resolveClientSidePlan(fullScreenPlan.rawOutput ?? '')
      : null;
  const fullScreenDisplayPlan = fullScreenPlan?.structured ?? fullScreenClientPlan;
  const fullScreenIsLatest = fullScreenPlanId === latestPlanId;
  const fullScreenParseFailureMessage = fullScreenPlan?.rawOutput.trim()
    ? diagnosePlanParseFailure(fullScreenPlan.rawOutput)
    : 'Structured plan data is unavailable for this version.';
  const handleApproveAndClose = () => {
    onApprove();
    onCloseFullScreenPlan();
  };
  const handleFullScreenKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey && e.key === 'Enter' && canApprove && fullScreenIsLatest && !isSubmitting) {
      e.preventDefault();
      handleApproveAndClose();
    }
  };
  return (
    <>
      <Modal
        open={fullScreenPlanId !== null}
        onClose={onCloseFullScreenPlan}
        title={`Plan v${fullScreenPlan?.version}${fullScreenPlan?.status ? ` - ${fullScreenPlan.status}` : ''}`}
        className="max-w-4xl h-[90vh] flex flex-col overflow-hidden p-0"
        headerClassName="shrink-0 border-b border-border px-6 py-4"
        onKeyDown={handleFullScreenKeyDown}
        headerAction={
          <Button variant="ghost" className="size-7 p-0" onClick={onCloseFullScreenPlan}>
            <X size={15} strokeWidth={2.25} />
          </Button>
        }
      >
        <div className="flex-1 overflow-y-auto">
          {fullScreenDisplayPlan && <PlanViewer plan={fullScreenDisplayPlan} />}
          {fullScreenReview?.structured && <ReviewViewer review={fullScreenReview.structured} />}
          {!fullScreenDisplayPlan && isFullScreenPlanLoading && (
            <div className="p-6 text-sm text-muted-foreground">Loading plan details…</div>
          )}
          {!fullScreenDisplayPlan && fullScreenPlan && !isFullScreenPlanLoading && (
            <div className="p-6">
              <div className="space-y-2 rounded-md border border-warning/30 bg-warning/10 px-4 py-3">
                <p className="text-sm font-medium text-warning">Structured plan unavailable</p>
                <p className="text-sm text-muted-foreground">{fullScreenParseFailureMessage}</p>
                <p className="text-sm text-muted-foreground">
                  Raw planner transcript is hidden here. Use the terminal drawer for subprocess
                  output.
                </p>
              </div>
            </div>
          )}
        </div>
        {canApprove && fullScreenIsLatest && (
          <ModalFooter className="shrink-0 border-t border-border px-6 py-4">
            <Button onClick={handleApproveAndClose} disabled={isSubmitting}>
              <LoadingButtonContent loading={isSubmitting}>Approve & Execute</LoadingButtonContent>
            </Button>
          </ModalFooter>
        )}
      </Modal>

      <ConfirmDialog
        open={showArchiveConfirm}
        onClose={onCloseArchiveConfirm}
        onConfirm={onArchiveConfirmed}
        title={`Archive issue #${activeIssueNumber}?`}
        warningText="Warning: this closes the GitHub issue and archives its GitHub Project card. Archived items disappear from the Done column."
        confirmLabel="Archive"
        confirmVariant="destructive"
      />

      <ConfirmDialog
        open={showMarkAsDoneConfirm}
        onClose={onCloseMarkAsDoneConfirm}
        onConfirm={onMarkAsDoneConfirmed}
        title={`Close issue #${activeIssueNumber}?`}
        confirmLabel={
          <LoadingButtonContent loading={isSubmitting}>Close Issue</LoadingButtonContent>
        }
        confirmClassName="bg-purple-600 text-white hover:bg-purple-700"
        disabled={isSubmitting}
      >
        <p className="text-sm text-secondary">
          This will move the issue to Closed in the Done column. You can still reopen it later from
          GitHub.
        </p>
      </ConfirmDialog>
    </>
  );
}
