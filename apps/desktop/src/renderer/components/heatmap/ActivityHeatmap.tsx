import type {
  HeatmapDayRecord,
  HeatmapMetric,
  HeatmapQueryArgs,
  HeatmapRange,
  HeatmapScope,
} from '@shipcode/shared';
import { formatTokenCount } from '@shipcode/shared';
import { cn } from '@shipshitdev/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

export type HeatmapSurface = 'global' | 'project' | 'issue';

interface ActivityHeatmapProps {
  scope: HeatmapScope;
  surface: HeatmapSurface;
  projectId?: string;
  threadId?: string;
  defaultRange?: HeatmapRange;
  defaultMetric?: HeatmapMetric;
  allowedMetrics?: HeatmapMetric[];
  allowedRanges?: HeatmapRange[];
  showMetricToggle?: boolean;
  showRangePicker?: boolean;
  className?: string;
}

const ALL_METRICS: HeatmapMetric[] = ['costUsd', 'prsOpened', 'tokens', 'runs'];
const ALL_RANGES: HeatmapRange[] = [30, 90, 365];

const METRIC_LABEL: Record<HeatmapMetric, string> = {
  costUsd: 'Cost',
  prsOpened: 'PRs',
  tokens: 'Tokens',
  runs: 'Runs',
};

const RANGE_LABEL: Record<HeatmapRange, string> = {
  30: '30 days',
  90: '90 days',
  365: '1 year',
};

const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function storageKey(surface: HeatmapSurface, kind: 'metric' | 'range'): string {
  return `heatmap.${surface}.${kind}`;
}

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  return fallback;
}

function writeStored(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, value);
}

function metricValue(row: HeatmapDayRecord, metric: HeatmapMetric): number {
  switch (metric) {
    case 'costUsd':
      return row.costUsd;
    case 'tokens':
      return row.tokens;
    case 'runs':
      return row.runs;
    case 'prsOpened':
      return row.prsOpened;
  }
}

function formatMetric(value: number, metric: HeatmapMetric): string {
  switch (metric) {
    case 'costUsd':
      return value === 0 ? '$0.00' : value < 0.005 ? '< $0.01' : `$${value.toFixed(2)}`;
    case 'tokens':
      return value === 0 ? '0 tokens' : `${formatTokenCount(value)} tokens`;
    case 'runs':
      return `${value} ${value === 1 ? 'run' : 'runs'}`;
    case 'prsOpened':
      return `${value} ${value === 1 ? 'PR' : 'PRs'}`;
  }
}

/**
 * Quantile thresholds across non-zero values. Returns [t1, t2, t3, t4] —
 * a value v lands in bucket k where v <= tk (k=1..4). Values <= 0 → bucket 0.
 *
 * Quartile points are picked at indices 25/50/75/100% of the sorted positives,
 * deduped so flat ranges don't waste buckets.
 */
function quantileThresholds(values: number[]): [number, number, number, number] {
  const positives = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (positives.length === 0) return [0, 0, 0, 0];
  const pick = (frac: number): number => {
    const idx = Math.min(positives.length - 1, Math.max(0, Math.floor(positives.length * frac)));
    return positives[idx] ?? 0;
  };
  const t1 = pick(0.25);
  const t2 = pick(0.5);
  const t3 = pick(0.75);
  const t4 = positives[positives.length - 1] ?? 0;
  return [t1, t2, t3, t4];
}

function bucketFor(value: number, thresholds: [number, number, number, number]): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0) return 0;
  if (value <= thresholds[0]) return 1;
  if (value <= thresholds[1]) return 2;
  if (value <= thresholds[2]) return 3;
  return 4;
}

const BUCKET_CLASS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'bg-tertiary border border-border/50',
  1: 'bg-success/20',
  2: 'bg-success/40',
  3: 'bg-success/65',
  4: 'bg-success',
};

interface WeekCell {
  record: HeatmapDayRecord | null;
  date: string | null;
  dayKey: string;
}

/**
 * Build a 7-row × N-column matrix where each column is a Sunday-aligned week.
 * Leading nulls pad the first column so the grid lines up on weekday rows.
 */
function buildWeekMatrix(rows: HeatmapDayRecord[]): WeekCell[][] {
  if (rows.length === 0) return [];
  const first = new Date(`${rows[0].date}T00:00:00Z`);
  const firstWeekday = first.getUTCDay(); // 0 = Sun
  const padded: WeekCell[] = [];
  for (let i = 0; i < firstWeekday; i++)
    padded.push({ record: null, date: null, dayKey: `pad-lead-${i}` });
  for (const r of rows) padded.push({ record: r, date: r.date, dayKey: r.date });
  // Pad trailing nulls so the last column is exactly 7 cells.
  const trailing = (7 - (padded.length % 7)) % 7;
  for (let i = 0; i < trailing; i++)
    padded.push({ record: null, date: null, dayKey: `pad-tail-${i}` });

  const weeks: WeekCell[][] = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));
  return weeks;
}

function formatTooltipDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function ActivityHeatmap({
  scope,
  surface,
  projectId,
  threadId,
  defaultRange = 90,
  defaultMetric = 'costUsd',
  allowedMetrics = ALL_METRICS,
  allowedRanges = ALL_RANGES,
  showMetricToggle = true,
  showRangePicker = true,
  className,
}: ActivityHeatmapProps) {
  const [metric, setMetric] = useState<HeatmapMetric>(() =>
    readStored<HeatmapMetric>(storageKey(surface, 'metric'), allowedMetrics, defaultMetric),
  );
  const [range, setRange] = useState<HeatmapRange>(() => {
    const stored = readStored<string>(
      storageKey(surface, 'range'),
      allowedRanges.map(String),
      String(defaultRange),
    );
    const parsed = Number(stored) as HeatmapRange;
    return (allowedRanges as number[]).includes(parsed) ? parsed : defaultRange;
  });

  useEffect(() => {
    writeStored(storageKey(surface, 'metric'), metric);
  }, [surface, metric]);

  useEffect(() => {
    writeStored(storageKey(surface, 'range'), String(range));
  }, [surface, range]);

  const queryArgs: HeatmapQueryArgs = useMemo(
    () => ({ scope, projectId, threadId, rangeDays: range }),
    [scope, projectId, threadId, range],
  );

  const { data = [], isLoading } = useQuery<HeatmapDayRecord[]>({
    queryKey: ['activity-heatmap', scope, projectId ?? null, threadId ?? null, range],
    queryFn: () => window.shipcode.invoke<HeatmapDayRecord[]>('activity-heatmap:query', queryArgs),
    staleTime: 60_000,
  });

  const weeks = useMemo(() => buildWeekMatrix(data), [data]);
  const thresholds = useMemo(
    () => quantileThresholds(data.map((r) => metricValue(r, metric))),
    [data, metric],
  );

  const totalActive = data.reduce((sum, r) => sum + (metricValue(r, metric) > 0 ? 1 : 0), 0);
  const showLegendGradient = totalActive > 0;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {(showMetricToggle || showRangePicker) && (
        <div className="flex items-center justify-between gap-3">
          {showMetricToggle ? (
            <div
              role="tablist"
              aria-label="Heatmap metric"
              className="flex items-center gap-1 rounded-lg border border-border bg-tertiary/40 p-0.5"
            >
              {allowedMetrics.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={metric === m}
                  onClick={() => setMetric(m)}
                  className={cn(
                    'h-6 rounded-md px-2 text-[11px] font-medium text-secondary transition-colors',
                    metric === m && 'bg-elevated text-primary shadow-sm',
                  )}
                >
                  {METRIC_LABEL[m]}
                </button>
              ))}
            </div>
          ) : (
            <div />
          )}
          {showRangePicker && (
            <div
              role="tablist"
              aria-label="Heatmap range"
              className="flex items-center gap-1 rounded-lg border border-border bg-tertiary/40 p-0.5"
            >
              {allowedRanges.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={range === r}
                  onClick={() => setRange(r)}
                  className={cn(
                    'h-6 rounded-md px-2 text-[11px] font-medium text-secondary transition-colors',
                    range === r && 'bg-elevated text-primary shadow-sm',
                  )}
                >
                  {RANGE_LABEL[r]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-1.5">
        <div className="flex flex-col justify-between py-0.5 text-[9px] leading-none text-muted">
          {DAY_LABEL.map((d, i) => (
            <span key={d} className={cn('h-2.5', i % 2 === 1 ? 'opacity-100' : 'opacity-0')}>
              {d}
            </span>
          ))}
        </div>
        <div
          title={`Activity heatmap, ${METRIC_LABEL[metric]}, last ${range} days`}
          data-busy={isLoading}
          className="flex flex-1 gap-[3px] overflow-x-auto"
        >
          {weeks.map((week) => {
            const weekKey = week.map((c) => c.record?.date ?? 'p').join('|');
            return (
              <div key={weekKey} className="flex flex-col gap-[3px]">
                {week.map((cell) => {
                  if (!cell.record) {
                    return (
                      <div
                        key={`pad-${cell.dayKey}`}
                        className="h-2.5 w-2.5 rounded-[2px] bg-transparent"
                        aria-hidden="true"
                      />
                    );
                  }
                  const value = metricValue(cell.record, metric);
                  const bucket = bucketFor(value, thresholds);
                  return (
                    <button
                      key={cell.record.date}
                      type="button"
                      tabIndex={0}
                      title={`${formatTooltipDate(cell.record.date)} — ${formatMetric(value, metric)}`}
                      aria-label={`${formatTooltipDate(cell.record.date)}: ${formatMetric(value, metric)}`}
                      className={cn(
                        'h-2.5 w-2.5 rounded-[2px] focus:outline-none focus:ring-1 focus:ring-accent',
                        BUCKET_CLASS[bucket],
                      )}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-end gap-1.5 text-[10px] text-muted">
        <span>Less</span>
        {showLegendGradient ? (
          ([0, 1, 2, 3, 4] as const).map((b) => (
            <span key={b} className={cn('h-2.5 w-2.5 rounded-[2px]', BUCKET_CLASS[b])} />
          ))
        ) : (
          <span className={cn('h-2.5 w-2.5 rounded-[2px]', BUCKET_CLASS[0])} />
        )}
        <span>More</span>
      </div>
    </div>
  );
}
