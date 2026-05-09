import type { PipelinePhaseDurationSummary } from '@shipcode/shared';
import { cn } from '@shipshitdev/ui';

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function PhaseDurationsChart({
  phaseDurations,
  className,
}: {
  phaseDurations: PipelinePhaseDurationSummary[];
  className?: string;
}) {
  if (phaseDurations.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-border px-4 py-12 text-center text-xs text-muted">
        No phase timing data yet.
      </div>
    );
  }

  const chartData = phaseDurations.map((p) => ({
    phase: p.phase.replace(/_/g, ' '),
    average: p.averageMs,
    p75: p.p75Ms,
  }));
  const maxDuration = Math.max(...chartData.map((entry) => entry.p75 ?? entry.average ?? 0), 1);

  return (
    <div className={cn('rounded-xl border border-border bg-elevated p-4', className)}>
      <div className="mb-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          Phase Durations
        </h3>
      </div>
      <div className="space-y-3">
        {chartData.map((entry) => {
          const averageWidth = Math.max(2, ((entry.average ?? 0) / maxDuration) * 100);
          const p75Width = Math.max(2, ((entry.p75 ?? 0) / maxDuration) * 100);

          return (
            <div key={entry.phase} className="grid grid-cols-[72px_1fr] items-center gap-3">
              <div className="truncate text-[10px] text-muted" title={entry.phase}>
                {entry.phase}
              </div>
              <div className="space-y-1">
                <div className="h-2 overflow-hidden rounded-full bg-tertiary">
                  <div
                    className="h-full rounded-full bg-agent"
                    style={{ width: `${averageWidth}%` }}
                  />
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-tertiary">
                  <div
                    className="h-full rounded-full bg-warning/70"
                    style={{ width: `${p75Width}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted">
                  <span>avg {formatDuration(entry.average)}</span>
                  <span>p75 {formatDuration(entry.p75)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
