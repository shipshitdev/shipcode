import type {
  HeatmapDayRecord,
  HeatmapMetric,
  HeatmapQueryArgs,
  HeatmapRange,
  HeatmapScope,
} from '@shipcode/shared';
import { formatTokenCount } from '@shipcode/shared';
import { Button, cn } from '@shipshitdev/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  /** Controlled range — when provided, overrides internal state. */
  range?: HeatmapRange;
  /** Called when the user changes the range picker. */
  onRangeChange?: (r: HeatmapRange) => void;
}

const ALL_METRICS: HeatmapMetric[] = ['tokens', 'runs', 'prsOpened', 'costUsd'];
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
  return `heatmap.v2.${surface}.${kind}`;
}

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const raw = window.localStorage.getItem(key);
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  return fallback;
}

function writeStored(key: string, value: string): void {
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
 * Quartile points are picked at indices 25/50/75/100% of the sorted positives.
 * `bucketFor` treats the max threshold first so flat non-zero ranges still
 * render as visibly active instead of getting stuck in the faintest bucket.
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
  const t4 = positives.at(-1) ?? 0;
  return [t1, t2, t3, t4];
}

function bucketFor(value: number, thresholds: [number, number, number, number]): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0) return 0;
  if (value >= thresholds[3]) return 4;
  if (value <= thresholds[0]) return 1;
  if (value <= thresholds[1]) return 2;
  if (value <= thresholds[2]) return 3;
  return 4;
}

const BUCKET_CLASS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'border border-border/70 bg-[var(--heatmap-empty)]',
  1: 'border border-black/15 bg-[var(--heatmap-1)]',
  2: 'border border-black/15 bg-[var(--heatmap-2)]',
  3: 'border border-black/15 bg-[var(--heatmap-3)]',
  4: 'border border-black/15 bg-[var(--heatmap-4)]',
};

const CELL_SIZE_CLASS: Record<HeatmapRange, string> = {
  30: 'size-3.5',
  90: 'size-3',
  365: 'size-2.5',
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
  defaultMetric = 'tokens',
  allowedMetrics = ALL_METRICS,
  allowedRanges = ALL_RANGES,
  showMetricToggle = true,
  showRangePicker = true,
  className,
  range: controlledRange,
  onRangeChange,
}: ActivityHeatmapProps) {
  const resolvedDefaultMetric = allowedMetrics.includes(defaultMetric)
    ? defaultMetric
    : (allowedMetrics[0] ?? 'tokens');
  const [metric, setMetric] = useState<HeatmapMetric>(() =>
    readStored<HeatmapMetric>(storageKey(surface, 'metric'), allowedMetrics, resolvedDefaultMetric),
  );
  const [internalRange, setInternalRange] = useState<HeatmapRange>(() => {
    const stored = readStored<string>(
      storageKey(surface, 'range'),
      allowedRanges.map(String),
      String(defaultRange),
    );
    const parsed = Number(stored) as HeatmapRange;
    return (allowedRanges as number[]).includes(parsed) ? parsed : defaultRange;
  });
  // When a controlled range is provided, use it; otherwise fall back to internal state.
  const range = controlledRange !== undefined ? controlledRange : internalRange;

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
  const cellSizeClass = CELL_SIZE_CLASS[range];

  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    record: HeatmapDayRecord;
    x: number;
    y: number;
  } | null>(null);

  const handleCellEnter = useCallback((e: React.MouseEvent, record: HeatmapDayRecord) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    setTooltip({
      record,
      x: rect.left + rect.width / 2 - containerRect.left,
      y: rect.top - containerRect.top,
    });
  }, []);

  const handleCellLeave = useCallback(() => setTooltip(null), []);

  return (
    <div ref={containerRef} className={cn('relative flex flex-col gap-3', className)}>
      {(showMetricToggle || showRangePicker) && (
        <div className="flex items-center justify-between gap-3">
          {showMetricToggle ? (
            <div
              role="tablist"
              aria-label="Heatmap metric"
              className="flex items-center gap-1 rounded-lg border border-border bg-tertiary/40 p-0.5"
            >
              {allowedMetrics.map((m) => (
                <Button
                  key={m}
                  type="button"
                  variant="ghost"
                  role="tab"
                  aria-selected={metric === m}
                  onClick={() => setMetric(m)}
                  className={cn(
                    'h-6 rounded-md px-2 text-[11px] font-medium text-secondary transition-colors',
                    metric === m && 'bg-elevated text-primary shadow-sm',
                  )}
                >
                  {METRIC_LABEL[m]}
                </Button>
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
                <Button
                  key={r}
                  type="button"
                  variant="ghost"
                  role="tab"
                  aria-selected={range === r}
                  onClick={() => {
                    setInternalRange(r);
                    onRangeChange?.(r);
                  }}
                  className={cn(
                    'h-6 rounded-md px-2 text-[11px] font-medium text-secondary transition-colors',
                    range === r && 'bg-elevated text-primary shadow-sm',
                  )}
                >
                  {RANGE_LABEL[r]}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-1.5">
        <div className="flex flex-col justify-between py-0.5 text-[9px] leading-none text-muted-foreground">
          {DAY_LABEL.map((d, i) => (
            <span key={d} className={cn(cellSizeClass, i % 2 === 1 ? 'opacity-100' : 'opacity-0')}>
              {d}
            </span>
          ))}
        </div>
        <section
          aria-busy={isLoading}
          aria-label={`Activity heatmap, ${METRIC_LABEL[metric]}, last ${range} days, ${totalActive} active days`}
          title={`Activity heatmap, ${METRIC_LABEL[metric]}, last ${range} days`}
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
                        className={cn(cellSizeClass, 'rounded-[2px] bg-transparent')}
                        aria-hidden="true"
                      />
                    );
                  }
                  const value = metricValue(cell.record, metric);
                  const bucket = bucketFor(value, thresholds);
                  const rec = cell.record;
                  return (
                    <Button
                      key={rec.date}
                      type="button"
                      variant="ghost"
                      tabIndex={0}
                      aria-label={`${formatTooltipDate(rec.date)}: ${formatMetric(value, metric)}`}
                      onMouseEnter={(e) => handleCellEnter(e, rec)}
                      onMouseLeave={handleCellLeave}
                      className={cn(
                        cellSizeClass,
                        'rounded-[2px] transition-[background-color,border-color,box-shadow] hover:ring-1 hover:ring-accent/60 focus:outline-none focus:ring-1 focus:ring-accent',
                        BUCKET_CLASS[bucket],
                      )}
                    />
                  );
                })}
              </div>
            );
          })}
        </section>
      </div>

      <div className="flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
        <span>Less</span>
        {([0, 1, 2, 3, 4] as const).map((b) => (
          <span
            key={b}
            className={cn('size-2.5 rounded-[2px]', BUCKET_CLASS[b])}
            aria-hidden="true"
          />
        ))}
        <span>More</span>
      </div>

      {tooltip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-50 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-elevated px-2.5 py-2 shadow-lg"
          style={{ left: tooltip.x, top: tooltip.y - 6 }}
        >
          <p className="mb-1 text-[11px] font-medium text-primary">
            {formatTooltipDate(tooltip.record.date)}
          </p>
          <div className="flex flex-col gap-0.5 text-[10px] text-secondary">
            <span>{formatMetric(tooltip.record.tokens, 'tokens')}</span>
            <span>{formatMetric(tooltip.record.runs, 'runs')}</span>
            <span>{formatMetric(tooltip.record.prsOpened, 'prsOpened')}</span>
            <span>{formatMetric(tooltip.record.costUsd, 'costUsd')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
