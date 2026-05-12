import { Button, cn } from '@shipshitdev/ui';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

type InAppNotificationTone = 'default' | 'success' | 'warning' | 'danger';

const TONE_DOT_CLASS: Record<InAppNotificationTone, string> = {
  default: 'bg-muted-foreground/50',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

interface InAppNotificationProps {
  title: ReactNode;
  description?: ReactNode;
  tone?: InAppNotificationTone;
  className?: string;
  contentClassName?: string;
  dismissLabel?: string;
  onClick?: () => void;
  onDismiss?: () => void;
}

export function InAppNotification({
  title,
  description,
  tone = 'default',
  className,
  contentClassName,
  dismissLabel = 'Dismiss',
  onClick,
  onDismiss,
}: InAppNotificationProps) {
  const content = (
    <div className={cn('flex min-w-0 flex-col items-start gap-0.5', contentClassName)}>
      <div className="text-[12px] font-semibold leading-5 text-primary">{title}</div>
      {description ? (
        <div className="line-clamp-2 text-[11px] leading-4 text-secondary">{description}</div>
      ) : null}
    </div>
  );

  return (
    <div
      className={cn(
        'group flex min-w-0 items-start gap-2 rounded-lg border border-border/60 px-3 py-2 shadow-lg',
        'bg-[color-mix(in_srgb,var(--bg-elevated)_88%,transparent)] backdrop-blur-xl',
        className,
      )}
    >
      {tone !== 'default' && (
        <span
          className={cn('mt-1.5 inline-block size-2 shrink-0 rounded-full', TONE_DOT_CLASS[tone])}
        />
      )}
      {onClick ? (
        <Button
          variant="ghost"
          onClick={onClick}
          className="h-auto min-w-0 flex-1 justify-start whitespace-normal bg-transparent p-0 text-left font-normal hover:bg-transparent focus-visible:ring-0"
        >
          {content}
        </Button>
      ) : (
        <div className="min-w-0 flex-1">{content}</div>
      )}

      {onDismiss ? (
        <Button
          variant="ghost"
          size="icon"
          onClick={onDismiss}
          className="size-6 shrink-0 text-secondary hover:bg-transparent hover:text-primary"
          title={dismissLabel}
          aria-label={dismissLabel}
        >
          <X size={14} />
        </Button>
      ) : null}
    </div>
  );
}
