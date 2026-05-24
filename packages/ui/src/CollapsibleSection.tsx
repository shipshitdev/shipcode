import { ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/primitives/button';

export interface CollapsibleSectionProps {
  title: string;
  count?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  contentClassName?: string;
}

export function CollapsibleSection({
  title,
  count,
  children,
  defaultOpen = false,
  className,
  contentClassName,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      data-slot="collapsible-section"
      className={cn('rounded-md border border-border bg-secondary/20 px-3 py-2', className)}
    >
      <Button
        type="button"
        variant="ghost"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="h-auto w-full rounded-none p-0 text-[11px] font-medium uppercase tracking-wide text-secondary hover:bg-transparent hover:text-secondary"
      >
        <ChevronRight
          size={12}
          className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
        />
        <span className="min-w-0 flex-1">{title}</span>
        {count !== undefined && (
          <span className="text-[10px] font-normal normal-case text-muted-foreground">{count}</span>
        )}
      </Button>
      <div className={cn('mt-3', !open && 'hidden', contentClassName)}>{children}</div>
    </div>
  );
}
