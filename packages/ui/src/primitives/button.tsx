import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, Ref } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center gap-2 whitespace-nowrap text-left text-[13px] font-medium transition-colors cursor-pointer disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'justify-center rounded-md bg-accent text-accent-foreground hover:bg-accent-hover shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]',
        secondary:
          'justify-center rounded-md bg-tertiary text-primary border border-border hover:bg-hover',
        outline:
          'justify-center rounded-md bg-transparent border border-border text-primary hover:bg-hover',
        ghost:
          'justify-start rounded-md bg-transparent text-secondary hover:bg-hover hover:text-primary',
        pill: 'justify-center rounded-md bg-transparent text-secondary hover:text-primary border border-border hover:border-text-secondary',
        destructive:
          'justify-center rounded-md bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25',
        link: 'justify-center text-primary underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-6 px-2 text-[11px] gap-1',
        sm: 'h-7 px-2.5 text-xs',
        default: 'h-8 px-3.5 py-1.5',
        md: 'h-8 px-3.5 py-1.5',
        lg: 'h-9 px-4 text-[13px]',
        xl: 'h-10 px-5 text-[14px]',
        'icon-xs': 'size-6 justify-center',
        'icon-sm': 'size-7 justify-center',
        icon: 'size-8 justify-center',
        'icon-lg': 'size-9 justify-center',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    ref?: Ref<HTMLButtonElement>;
  };

function Button({
  className,
  variant,
  size,
  asChild = false,
  title,
  'aria-label': ariaLabel,
  ref,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      ref={ref}
      title={title}
      aria-label={ariaLabel}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button };
