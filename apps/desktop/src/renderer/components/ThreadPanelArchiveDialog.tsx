import { Button, Modal, ModalFooter } from '@shipshitdev/ui';

interface ThreadPanelArchiveDialogProps {
  count?: number;
  issueNumber?: number;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ThreadPanelArchiveDialog({
  count,
  issueNumber,
  open,
  onClose,
  onConfirm,
}: ThreadPanelArchiveDialogProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey && e.key === 'Enter') {
      e.preventDefault();
      onConfirm();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        issueNumber != null
          ? `Archive issue #${issueNumber}?`
          : `Archive ${count ?? 0} done issue${(count ?? 0) !== 1 ? 's' : ''}?`
      }
      className="max-w-sm"
      onKeyDown={handleKeyDown}
    >
      <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
        Warning: this closes the GitHub issue and archives its GitHub Project card. Archived items
        disappear from the Done column.
      </div>
      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="destructive" size="sm" onClick={onConfirm}>
          Archive
        </Button>
      </ModalFooter>
    </Modal>
  );
}
