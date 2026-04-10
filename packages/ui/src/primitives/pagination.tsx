import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

function Pagination({ page, totalPages, onPageChange, className }: PaginationProps) {
  if (totalPages <= 1) return null;

  // Show at most 5 page numbers, centered around current page
  const getPages = (): (number | '…')[] => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | '…')[] = [];
    const start = Math.max(1, Math.min(page - 1, totalPages - 3));
    const end = Math.min(totalPages, start + 2);
    if (start > 1) {
      pages.push(1);
      if (start > 2) pages.push('…');
    }
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < totalPages) {
      if (end < totalPages - 1) pages.push('…');
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className={cn('flex items-center justify-center gap-1 pt-3', className)}>
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-border bg-transparent text-secondary transition-colors hover:bg-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Previous page"
      >
        <ChevronLeft size={12} />
      </button>

      {getPages().map((p, i) =>
        p === '…' ? (
          <span
            key={`ellipsis-${i}`}
            className="flex h-6 w-6 items-center justify-center text-[11px] text-muted"
          >
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            className={cn(
              'inline-flex h-6 min-w-6 cursor-pointer items-center justify-center rounded border px-1.5 text-[11px] tabular-nums transition-colors',
              p === page
                ? 'border-border-strong bg-tertiary text-primary'
                : 'border-border bg-transparent text-secondary hover:bg-hover hover:text-primary',
            )}
          >
            {p}
          </button>
        ),
      )}

      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-border bg-transparent text-secondary transition-colors hover:bg-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Next page"
      >
        <ChevronRight size={12} />
      </button>
    </div>
  );
}

export { Pagination };
export type { PaginationProps };
