import { Button, Modal, ModalFooter } from '@shipshitdev/ui';
import type { ComponentProps, ReactNode } from 'react';

type ConfirmButtonVariant = ComponentProps<typeof Button>['variant'];

export interface ConfirmDialogProps {
  children?: ReactNode;
  className?: string;
  confirmClassName?: string;
  confirmLabel: ReactNode;
  confirmVariant?: ConfirmButtonVariant;
  disabled?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  open: boolean;
  title: ReactNode;
  warningText?: ReactNode;
  warningVariant?: 'danger' | 'warning';
}

const warningClassNames = {
  danger: 'border-danger/30 bg-danger/10 text-danger',
  warning: 'border-warning/30 bg-warning/10 text-warning',
} as const;

export function ConfirmDialog({
  children,
  className = 'max-w-sm',
  confirmClassName,
  confirmLabel,
  confirmVariant,
  disabled = false,
  onClose,
  onConfirm,
  open,
  title,
  warningText,
  warningVariant = 'danger',
}: ConfirmDialogProps) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !disabled) {
      event.preventDefault();
      onConfirm();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      className={className}
      onKeyDown={handleKeyDown}
    >
      {(warningText !== undefined || children !== undefined) && (
        <div className="space-y-3">
          {warningText !== undefined && (
            <div
              className={`rounded-md border px-3 py-2 text-sm ${warningClassNames[warningVariant]}`}
            >
              {warningText}
            </div>
          )}
          {children}
        </div>
      )}
      <ModalFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant={confirmVariant}
          size="sm"
          className={confirmClassName}
          onClick={onConfirm}
          disabled={disabled}
        >
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
