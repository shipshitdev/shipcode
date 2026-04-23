import type * as React from 'react';
import { cn } from '../lib/utils';

type OverlayPanelSide = 'left' | 'right';
type OverlayPanelWidth = React.CSSProperties['width'];

export interface OverlayPanelProps extends Omit<React.ComponentProps<'div'>, 'style'> {
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
  maxWidth?: OverlayPanelWidth;
  minWidth?: OverlayPanelWidth;
  onResizeStart?: React.MouseEventHandler<HTMLButtonElement>;
  resizeHandleLabel?: string;
  side?: OverlayPanelSide;
  style?: React.CSSProperties;
  width?: OverlayPanelWidth;
}

export function OverlayPanel({
  children,
  className,
  containerClassName,
  maxWidth,
  minWidth,
  onResizeStart,
  resizeHandleLabel = 'Resize overlay panel',
  side = 'right',
  style,
  width,
  ...props
}: OverlayPanelProps) {
  const isRight = side === 'right';

  return (
    <div
      data-slot="overlay-panel-wrapper"
      className={cn(
        'pointer-events-none absolute inset-y-0 z-20 flex',
        isRight ? 'right-0' : 'left-0',
        containerClassName,
      )}
    >
      <div
        data-slot="overlay-panel"
        className={cn(
          'pointer-events-auto relative flex h-full flex-col overflow-hidden bg-primary',
          isRight
            ? 'border-l border-border shadow-[-16px_0_40px_rgba(0,0,0,0.35)]'
            : 'border-r border-border shadow-[16px_0_40px_rgba(0,0,0,0.35)]',
          className,
        )}
        style={{ ...style, width, minWidth, maxWidth }}
        {...props}
      >
        {onResizeStart && (
          <button
            type="button"
            aria-label={resizeHandleLabel}
            data-slot="overlay-panel-resize-handle"
            className={cn(
              'absolute inset-y-0 z-10 w-1 cursor-col-resize transition-colors hover:bg-accent/20 active:bg-accent/30',
              isRight ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2',
            )}
            onMouseDown={onResizeStart}
          />
        )}
        {children}
      </div>
    </div>
  );
}
