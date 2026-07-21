import { ConfirmDialog } from '@shipcode/ui';

interface ThreadPanelBoardReviewDialogProps {
  count: number;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ThreadPanelBoardReviewDialog({
  count,
  open,
  onClose,
  onConfirm,
}: ThreadPanelBoardReviewDialogProps) {
  const noun = count === 1 ? 'issue' : 'issues';

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title={`Review and align ${count} ${noun}?`}
      className="max-w-md"
      warningText={
        <>
          Warning: ShipCode will ask the triage model to review {count} unclaimed Backlog {noun} and
          may update GitHub labels for each one that meets the auto-apply confidence threshold.
        </>
      }
      warningVariant="warning"
      confirmLabel="Review board"
      confirmVariant="outline"
      confirmClassName="border-warning/35 bg-warning/10 text-warning hover:bg-warning/15 hover:text-warning"
      disabled={count === 0}
    >
      <p className="text-sm text-secondary">
        Active, running, completed, archived, quick-task, and already-linked issues are skipped. The
        board will refresh after the batch finishes.
      </p>
    </ConfirmDialog>
  );
}
