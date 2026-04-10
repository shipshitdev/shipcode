import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'rounded-lg bg-accent text-accent-foreground hover:bg-accent-hover shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]',
        secondary: 'rounded-lg bg-tertiary text-primary border border-border hover:bg-hover',
        outline: 'rounded-lg bg-transparent border border-border text-primary hover:bg-hover',
        ghost: 'rounded-md bg-transparent text-secondary hover:bg-hover hover:text-primary',
        destructive:
          'rounded-lg bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-6 px-2 text-[11px] gap-1',
        sm: 'h-7 px-2.5 text-xs',
        default: 'h-8 px-3.5 py-1.5',
        md: 'h-8 px-3.5 py-1.5',
        lg: 'h-9 px-4 text-[13px]',
        xl: 'h-10 px-5 text-[14px]',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
