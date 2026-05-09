import type { PipelineTokensByPhase } from '@shipcode/shared';
import { formatCost, formatTokenCount } from '@shipcode/shared';
import { cn } from '@shipshitdev/ui';

type DisplayMode = '$' | 'tokens';

function formatPhaseLabel(phase: string): string {
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

export function TokensByPhaseChart({
  tokensByPhase,
  displayMode,
  className,
}: {
  tokensByPhase: PipelineTokensByPhase[];
  displayMode: DisplayMode;
  className?: string;
}) {
  if (tokensByPhase.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-border px-4 py-12 text-center text-xs text-muted">
        No token usage data yet.
      </div>
    );
  }

  const chartData = tokensByPhase.map((p) => ({
    phase: formatPhaseLabel(p.phase),
    prompt: p.promptTokens,
    completion: p.completionTokens,
    cost: p.costUsd,
  }));
  const maxValue = Math.max(
    ...chartData.map((entry) =>
      displayMode === '$' ? entry.cost : entry.prompt + entry.completion,
    ),
    1,
  );

  return (
    <div className={cn('rounded-xl border border-border bg-elevated p-4', className)}>
      <div className="mb-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          {displayMode === '$' ? 'Cost by Phase' : 'Tokens by Phase'}
        </h3>
      </div>
      <div className="flex h-64 items-end gap-3 border-b border-border/50 pb-2">
        {chartData.map((entry) => {
          const total = displayMode === '$' ? entry.cost : entry.prompt + entry.completion;
          const height = Math.max(4, (total / maxValue) * 100);
          const promptHeight = total > 0 ? (entry.prompt / total) * 100 : 0;
          const completionHeight = total > 0 ? (entry.completion / total) * 100 : 0;

          return (
            <div key={entry.phase} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <div
                className="flex w-full max-w-14 flex-col justify-end overflow-hidden rounded-t bg-tertiary"
                style={{ height: `${height}%` }}
                title={
                  displayMode === '$'
                    ? formatCost(entry.cost)
                    : `${formatTokenCount(entry.prompt)} prompt, ${formatTokenCount(entry.completion)} completion`
                }
              >
                {displayMode === '$' ? (
                  <div className="h-full bg-success" />
                ) : (
                  <>
                    <div className="bg-info" style={{ height: `${completionHeight}%` }} />
                    <div className="bg-agent" style={{ height: `${promptHeight}%` }} />
                  </>
                )}
              </div>
              <div className="max-w-full truncate text-[10px] text-muted" title={entry.phase}>
                {entry.phase}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-center gap-4 text-[10px] text-secondary">
        {displayMode === '$' ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-success" />
            Cost
          </span>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-agent" />
              Prompt
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-info" />
              Completion
            </span>
          </>
        )}
      </div>
    </div>
  );
}
