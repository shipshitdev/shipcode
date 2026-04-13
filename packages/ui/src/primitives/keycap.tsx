import type * as React from 'react';
import { cn } from '../lib/utils';

export function Keycap({ className, children, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'rounded-sm border border-black/10 bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent-foreground/80',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
