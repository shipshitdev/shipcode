import { ConfirmDialog } from '@shipcode/ui';

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
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title={
        issueNumber != null
          ? `Archive issue #${issueNumber}?`
          : `Archive ${count ?? 0} closed issue${(count ?? 0) !== 1 ? 's' : ''}?`
      }
      warningText="Warning: this closes the GitHub issue and archives its GitHub Project card. Archived items disappear from the Done column."
      confirmLabel="Archive"
      confirmVariant="destructive"
    />
  );
}
