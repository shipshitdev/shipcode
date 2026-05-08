import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex h-5 items-center whitespace-nowrap rounded-sm border px-1.5 text-[10px] font-medium leading-none uppercase tracking-wide transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-hover text-primary border-border',
        done: 'bg-done/12 text-done border-done/25',
        success: 'bg-success/12 text-success border-success/20',
        warning: 'bg-warning/12 text-warning border-warning/20',
        danger: 'bg-danger/12 text-danger border-danger/20',
        info: 'bg-info/12 text-info border-info/20',
        accent: 'bg-accent/10 text-primary border-border-strong',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
