import * as PopoverPrimitive from '@radix-ui/react-popover';
import type * as React from 'react';
import { cn } from '@/lib/utils';

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root {...props} />;
}

function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger {...props} />;
}

function PopoverAnchor(props: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor {...props} />;
}

function PopoverContent({
  className,
  sideOffset = 6,
  align = 'end',
  onPointerDownOutside,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        onPointerDownOutside={(e) => {
          const target = e.target as Element | null;
          if (target?.closest('[data-radix-popper-content-wrapper]')) {
            e.preventDefault();
          }
          onPointerDownOutside?.(e);
        }}
        className={cn(
          'z-50 rounded-md border border-border bg-primary shadow-lg outline-none app-region-no-drag',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
