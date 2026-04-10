import * as React from 'react';
import { cn } from '../lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex min-h-[80px] w-full rounded-lg border border-border bg-tertiary px-3 py-2 text-[13px] text-primary placeholder:text-muted focus-visible:outline-none focus-visible:border-border-strong disabled:cursor-not-allowed disabled:opacity-50 resize-vertical font-[inherit]',
        className,
      )}
      {...props}
    />
  );
}
export { Textarea };
