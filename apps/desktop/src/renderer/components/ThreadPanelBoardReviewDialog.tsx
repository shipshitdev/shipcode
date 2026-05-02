import { Button, LoadingButtonContent, Modal, ModalFooter } from '@shipshitdev/ui';

interface ThreadPanelBoardReviewDialogProps {
  count: number;
  open: boolean;
  reviewing: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ThreadPanelBoardReviewDialog({
  count,
  open,
  reviewing,
  onClose,
  onConfirm,
}: ThreadPanelBoardReviewDialogProps) {
  const noun = count === 1 ? 'issue' : 'issues';
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey && event.key === 'Enter' && count > 0 && !reviewing) {
      event.preventDefault();
      onConfirm();
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!reviewing) onClose();
      }}
      title={`Review and align ${count} ${noun}?`}
      className="max-w-md"
      onKeyDown={handleKeyDown}
    >
      <div className="space-y-3">
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          Warning: ShipCode will ask the triage model to review {count} unclaimed Todo {noun} and
          may update GitHub labels for each one that meets the auto-apply confidence threshold.
        </div>
        <p className="text-sm text-secondary">
          Active, running, completed, archived, quick-task, and already-linked issues are skipped.
          The board will refresh after the batch finishes.
        </p>
      </div>
      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={reviewing}>
          Cancel
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="border-warning/35 bg-warning/10 text-warning hover:bg-warning/15 hover:text-warning"
          onClick={onConfirm}
          disabled={count === 0 || reviewing}
        >
          <LoadingButtonContent loading={reviewing}>Review board</LoadingButtonContent>
        </Button>
      </ModalFooter>
    </Modal>
  );
}
