import type { ProjectCostSummary } from '@shipcode/shared';
import { formatCost, formatTokenCount } from '@shipcode/shared';
import { cn } from '@shipshitdev/ui';

type DisplayMode = '$' | 'tokens';

const PROJECT_COLORS = [
  'var(--color-agent)',
  'var(--color-info)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-done)',
  'var(--color-danger)',
];

export function CostByProjectChart({
  byProject,
  displayMode,
  className,
}: {
  byProject: ProjectCostSummary[];
  displayMode: DisplayMode;
  className?: string;
}) {
  if (byProject.length < 2) return null;

  const pieData = byProject.map((p, i) => ({
    name: p.projectName,
    value: displayMode === '$' ? p.totalCostUsd : p.totalTokensPrompt + p.totalTokensCompletion,
    fill: PROJECT_COLORS[i % PROJECT_COLORS.length],
  }));
  const total = pieData.reduce((sum, entry) => sum + entry.value, 0);

  return (
    <div className={cn('rounded-xl border border-border bg-elevated p-4', className)}>
      <div className="mb-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          {displayMode === '$' ? 'Cost by Project' : 'Tokens by Project'}
        </h3>
      </div>
      <div className="flex h-64 items-center justify-center">
        <div className="grid size-36 place-items-center rounded-full border border-border bg-secondary/40">
          <div className="text-center">
            <div className="text-lg font-semibold tabular-nums text-primary">
              {displayMode === '$' ? formatCost(total) : formatTokenCount(total)}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted">total</div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
        {pieData.map((entry) => (
          <div key={entry.name} className="flex items-center gap-1.5 text-[10px] text-secondary">
            <span
              className="inline-block size-2 rounded-full"
              style={{ backgroundColor: entry.fill }}
            />
            <span className="truncate max-w-[100px]">{entry.name}</span>
            <span className="tabular-nums text-muted">
              {displayMode === '$' ? formatCost(entry.value) : formatTokenCount(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
