import * as React from 'react';
import { cn } from '../lib/utils';

/**
 * Minimal Checkbox primitive. Wraps a native <input type="checkbox"> so that
 * consumers never have to inline raw HTML. If we need an indeterminate state
 * or richer visuals later, swap this for @radix-ui/react-checkbox without
 * touching call sites.
 */
function Checkbox({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type="checkbox"
      className={cn(
        'h-3.5 w-3.5 shrink-0 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
export { Checkbox };
