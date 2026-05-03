import type { HeatmapDayRecord, HeatmapQueryArgs, HeatmapRange } from '@shipcode/shared';
import { formatTokenCount } from '@shipcode/shared';
import { PageHeader } from '@shipcode/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ActivityHeatmap } from '../../components/heatmap/ActivityHeatmap';
import { useAppStore } from '../../stores/app-store';

const RANGE_SUBTITLE: Record<HeatmapRange, string> = {
  30: 'Last 30 days',
  90: 'Last 90 days',
  365: 'Last year',
};

function formatCostValue(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.005) return '< $0.01';
  return `$${usd.toFixed(2)}`;
}

function InsightStatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex-1 min-w-0 rounded-lg border border-border bg-secondary p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold text-primary">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export function ProjectInsights() {
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const [range, setRange] = useState<HeatmapRange>(90);

  const queryArgs: HeatmapQueryArgs = useMemo(
    () => ({ scope: 'project', projectId: activeProjectId ?? undefined, rangeDays: range }),
    [activeProjectId, range],
  );

  const { data: heatmapData = [] } = useQuery<HeatmapDayRecord[]>({
    queryKey: ['activity-heatmap', 'project', activeProjectId ?? null, null, range],
    queryFn: () => window.shipcode.invoke<HeatmapDayRecord[]>('activity-heatmap:query', queryArgs),
    staleTime: 60_000,
    enabled: !!activeProjectId,
  });

  const totals = useMemo(
    () => ({
      tokens: heatmapData.reduce((s, r) => s + r.tokens, 0),
      cost: heatmapData.reduce((s, r) => s + r.costUsd, 0),
      runs: heatmapData.reduce((s, r) => s + r.runs, 0),
      prs: heatmapData.reduce((s, r) => s + r.prsOpened, 0),
      activeDays: heatmapData.filter((r) => r.runs > 0).length,
    }),
    [heatmapData],
  );

  if (!activeProjectId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        Select a project to view insights.
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <PageHeader
        title="Insights"
        subtitle={`${RANGE_SUBTITLE[range]} · activity and spend across this project.`}
      />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-5xl space-y-6">
          {/* KPI strip */}
          <div className="flex gap-3">
            <InsightStatCard label="Tokens" value={formatTokenCount(totals.tokens)} />
            <InsightStatCard label="Cost" value={formatCostValue(totals.cost)} />
            <InsightStatCard label="Runs" value={String(totals.runs)} />
            <InsightStatCard label="PRs Opened" value={String(totals.prs)} />
            <InsightStatCard
              label="Active Days"
              value={String(totals.activeDays)}
              sub={`of ${range}`}
            />
          </div>

          {/* Activity heatmap */}
          <section className="rounded-xl border border-border bg-elevated p-4">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-primary">Activity</h3>
              <p className="text-[11px] text-muted">
                Daily tokens, cost, runs, and PRs across this project.
              </p>
            </div>
            <ActivityHeatmap
              scope="project"
              surface="project"
              projectId={activeProjectId}
              range={range}
              onRangeChange={setRange}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
