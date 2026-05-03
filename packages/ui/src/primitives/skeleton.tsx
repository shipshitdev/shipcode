import type * as React from 'react';
import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      role="status"
      aria-busy="true"
      className={cn('animate-pulse rounded-md bg-hover/70', className)}
      {...props}
    />
  );
}

export { Skeleton };
