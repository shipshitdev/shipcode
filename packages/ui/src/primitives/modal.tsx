import { X } from 'lucide-react';
import type * as React from 'react';
import { cn } from '../lib/utils';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';

export { DialogFooter as ModalFooter };

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  /** Extra classes forwarded to DialogContent (e.g. max-w-[720px], flex flex-col p-0) */
  className?: string;
  /** Extra classes forwarded to DialogHeader */
  headerClassName?: string;
  /** Optional element rendered on the right side of the header (e.g. a close button) */
  headerAction?: React.ReactNode;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  children: React.ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  className,
  headerClassName,
  headerAction,
  onKeyDown,
  children,
}: ModalProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className={className} onKeyDown={onKeyDown}>
        <DialogHeader className={cn('flex-row items-center justify-between mb-0', headerClassName)}>
          <DialogTitle>{title}</DialogTitle>
          {headerAction}
          <DialogClose
            title="Close"
            aria-label="Close"
            className="rounded-md p-1 text-muted transition-colors hover:text-primary hover:bg-hover"
          >
            <X size={16} />
          </DialogClose>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
