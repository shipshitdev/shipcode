import { EyeOff, MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/primitives/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/primitives/dropdown-menu';
import { COLUMN_FILL, COLUMN_TEXT_CLASS } from './constants';
import { StatusCircleIcon } from './StatusCircleIcon';
import type { ColumnKey } from './types';

interface ColumnHeaderBaseProps {
  columnKey: ColumnKey;
  label: string;
  count: number;
  columnDotColor?: string | null;
  leading?: ReactNode;
  className?: string;
}

type ColumnHeaderProps = ColumnHeaderBaseProps &
  (
    | { countStyle: 'badge'; onHideColumn?: () => void }
    | { countStyle: 'parenthetical'; onHideColumn?: never }
  );

export function ColumnHeader({
  columnKey,
  label,
  count,
  countStyle,
  columnDotColor,
  leading,
  onHideColumn,
  className,
}: ColumnHeaderProps) {
  return (
    <span
      data-slot="kanban-column-header"
      className={cn('flex min-w-0 flex-1 items-center justify-between gap-2', className)}
    >
      <span
        className={cn(
          'flex min-w-0 items-center',
          countStyle === 'parenthetical' ? 'gap-2' : 'gap-1.5',
        )}
      >
        {leading}
        <StatusCircleIcon
          fill={COLUMN_FILL[columnKey]}
          className={cn(!columnDotColor && COLUMN_TEXT_CLASS[columnKey])}
          style={columnDotColor ? { color: columnDotColor } : undefined}
          size={10}
        />
        <span>{label}</span>
        {countStyle === 'parenthetical' ? (
          <span className="ml-0.5 font-normal normal-case tracking-normal text-muted-foreground">
            ({count})
          </span>
        ) : null}
      </span>
      {countStyle === 'badge' || onHideColumn ? (
        <span className="flex shrink-0 items-center gap-1">
          {countStyle === 'badge' ? (
            <span
              className={cn(
                'min-w-[18px] rounded-full border border-transparent bg-tertiary px-1.5 py-px text-center text-[10px] font-medium',
                COLUMN_TEXT_CLASS[columnKey],
              )}
            >
              {count}
            </span>
          ) : null}
          {onHideColumn ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="h-5 w-5 text-muted-foreground/60 hover:bg-muted/10 hover:text-primary"
                  title="Hide column"
                  aria-label="Hide column"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  <MoreHorizontal size={12} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onHideColumn}>
                  <EyeOff size={14} />
                  Hide column
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
