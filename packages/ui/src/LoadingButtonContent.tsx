import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './lib/utils';

export function LoadingButtonContent({
  loading,
  children,
  className,
  labelClassName,
  spinnerClassName,
  spinnerSize = 12,
}: {
  loading: boolean;
  children: ReactNode;
  className?: string;
  labelClassName?: string;
  spinnerClassName?: string;
  spinnerSize?: number;
}) {
  return (
    <span className={cn('inline-flex items-center justify-center gap-2', className)}>
      <span
        aria-hidden="true"
        className="inline-flex shrink-0 items-center justify-center"
        style={{ width: spinnerSize, height: spinnerSize }}
      >
        <Loader2
          size={spinnerSize}
          className={cn(
            'transition-opacity',
            loading ? 'animate-spin opacity-100' : 'opacity-0',
            spinnerClassName,
          )}
        />
      </span>
      <span className={cn('inline-flex items-center gap-2', labelClassName)}>{children}</span>
    </span>
  );
}
