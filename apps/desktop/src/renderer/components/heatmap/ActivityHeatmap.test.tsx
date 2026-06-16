import type { HeatmapDayRecord, HeatmapQueryArgs } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityHeatmap } from './ActivityHeatmap';

function makeRecord(date: string, overrides: Partial<HeatmapDayRecord> = {}): HeatmapDayRecord {
  return { date, costUsd: 0, tokens: 0, runs: 0, prsOpened: 0, ...overrides };
}

function ymd(daysAgo: number): string {
  const today = new Date();
  const utc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return new Date(utc - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

function buildRange(rangeDays: number, populate?: (date: string, idx: number) => HeatmapDayRecord) {
  const out: HeatmapDayRecord[] = [];
  for (let i = rangeDays - 1; i >= 0; i--) {
    const date = ymd(i);
    out.push(populate ? populate(date, rangeDays - 1 - i) : makeRecord(date));
  }
  return out;
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 60_000 } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('ActivityHeatmap', () => {
  let invokeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
        clear: () => store.clear(),
        get length() {
          return store.size;
        },
        key: (i: number) => Array.from(store.keys())[i] ?? null,
      },
    });
    invokeMock = vi.fn(async (_channel: string, args: HeatmapQueryArgs) => {
      return buildRange(args.rangeDays, (date) =>
        makeRecord(date, { costUsd: 1, tokens: 100, runs: 1 }),
      );
    });
    window.shipcode = {
      invoke: invokeMock,
      on: vi.fn(() => () => {}),
    } as unknown as typeof window.shipcode;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the metric and range toggles', async () => {
    renderWithProviders(<ActivityHeatmap scope="global" surface="global" />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(screen.getByRole('tab', { name: 'Tokens', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '90 days', selected: true })).toBeInTheDocument();
  });

  it('passes scope/projectId/range to the IPC query', async () => {
    renderWithProviders(
      <ActivityHeatmap scope="project" surface="project" projectId="p1" defaultRange={30} />,
    );
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(invokeMock).toHaveBeenCalledWith('activity-heatmap:query', {
      scope: 'project',
      projectId: 'p1',
      threadId: undefined,
      rangeDays: 30,
    });
  });

  it('passes threadId for the embedded variant', async () => {
    renderWithProviders(
      <ActivityHeatmap
        scope="thread"
        surface="issue"
        threadId="t1"
        defaultRange={90}
        defaultMetric="costUsd"
        showMetricToggle={false}
        showRangePicker={false}
        allowedMetrics={['costUsd']}
      />,
    );
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(invokeMock).toHaveBeenCalledWith('activity-heatmap:query', {
      scope: 'thread',
      projectId: undefined,
      threadId: 't1',
      rangeDays: 90,
    });
  });

  it('switches metrics without refiring the IPC', async () => {
    renderWithProviders(<ActivityHeatmap scope="global" surface="global" defaultRange={30} />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('tab', { name: 'Runs' }));
    expect(screen.getByRole('tab', { name: 'Runs', selected: true })).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('uses the strongest green bucket for flat non-zero usage', async () => {
    invokeMock.mockImplementation(async (_channel: string, args: HeatmapQueryArgs) => {
      return buildRange(args.rangeDays, (date) =>
        makeRecord(date, { costUsd: 1, tokens: 100, runs: 1 }),
      );
    });
    renderWithProviders(<ActivityHeatmap scope="global" surface="global" defaultRange={30} />);

    const usageCells = await screen.findAllByLabelText(/100 tokens/);
    expect(usageCells[0]?.className).toContain('bg-[var(--heatmap-4)]');
  });

  it('renders middle quantile buckets for varied usage', async () => {
    invokeMock.mockImplementation(async (_channel: string, args: HeatmapQueryArgs) => {
      return buildRange(args.rangeDays, (date, idx) =>
        makeRecord(date, { tokens: idx + 1, runs: idx + 1 }),
      );
    });
    renderWithProviders(<ActivityHeatmap scope="global" surface="global" defaultRange={30} />);

    expect((await screen.findByLabelText(/^.+: 1 tokens$/)).className).toContain(
      'bg-[var(--heatmap-1)]',
    );
    expect(screen.getByLabelText(/^.+: 16 tokens$/).className).toContain('bg-[var(--heatmap-2)]');
    expect(screen.getByLabelText(/^.+: 23 tokens$/).className).toContain('bg-[var(--heatmap-3)]');
  });

  it('refires the IPC when range changes', async () => {
    renderWithProviders(<ActivityHeatmap scope="global" surface="global" defaultRange={30} />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('tab', { name: '1 year' }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    expect(invokeMock).toHaveBeenLastCalledWith(
      'activity-heatmap:query',
      expect.objectContaining({
        rangeDays: 365,
      }),
    );
  });

  it('reports controlled range changes without changing the IPC range locally', async () => {
    const onRangeChange = vi.fn();
    renderWithProviders(
      <ActivityHeatmap
        scope="global"
        surface="global"
        range={30}
        allowedRanges={[30, 90]}
        onRangeChange={onRangeChange}
      />,
    );
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('tab', { name: '90 days' }));

    expect(onRangeChange).toHaveBeenCalledWith(90);
    expect(screen.getByRole('tab', { name: '30 days', selected: true })).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('shows metric details in the hover tooltip and hides it on leave', async () => {
    invokeMock.mockImplementation(async (_channel: string, args: HeatmapQueryArgs) => {
      return buildRange(args.rangeDays, (date, idx) =>
        makeRecord(date, {
          costUsd: idx === 0 ? 0.004 : 0,
          tokens: idx === 0 ? 1234 : 0,
          runs: idx === 0 ? 1 : 0,
          prsOpened: idx === 0 ? 1 : 0,
        }),
      );
    });
    renderWithProviders(
      <ActivityHeatmap
        scope="global"
        surface="global"
        defaultRange={30}
        defaultMetric="costUsd"
        allowedMetrics={['costUsd']}
      />,
    );

    const activeCell = await screen.findByLabelText(/^.+: < \$0\.01$/);
    fireEvent.mouseEnter(activeCell);

    expect(await screen.findByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByText('1 run')).toBeInTheDocument();
    expect(screen.getByText('1 PR')).toBeInTheDocument();
    expect(screen.getByText('< $0.01')).toBeInTheDocument();

    fireEvent.mouseLeave(activeCell);
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });

  it('supports PR metrics and falls back when stored metric/range values are not allowed', async () => {
    window.localStorage.setItem('heatmap.v2.issue.metric', 'tokens');
    window.localStorage.setItem('heatmap.v2.issue.range', '365');
    invokeMock.mockImplementation(async (_channel: string, args: HeatmapQueryArgs) => {
      return buildRange(args.rangeDays, (date, idx) =>
        makeRecord(date, { prsOpened: idx === 0 ? 1 : idx === 1 ? 2 : 0 }),
      );
    });

    renderWithProviders(
      <ActivityHeatmap
        scope="thread"
        surface="issue"
        threadId="thread-1"
        defaultRange={30}
        defaultMetric="tokens"
        allowedMetrics={['prsOpened']}
        allowedRanges={[30, 90]}
      />,
    );

    expect(await screen.findByRole('tab', { name: 'PRs', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '30 days', selected: true })).toBeInTheDocument();
    expect(await screen.findByLabelText(/^.+: 1 PR$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^.+: 2 PRs$/)).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith('activity-heatmap:query', {
      scope: 'thread',
      projectId: undefined,
      threadId: 'thread-1',
      rangeDays: 30,
    });
  });

  it('falls back to token metric when allowed metrics are empty', async () => {
    renderWithProviders(
      <ActivityHeatmap
        scope="global"
        surface="global"
        defaultMetric="costUsd"
        allowedMetrics={[]}
        defaultRange={30}
      />,
    );

    expect((await screen.findAllByLabelText(/^.+: 100 tokens$/))[0]).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Tokens' })).not.toBeInTheDocument();
  });

  it('keeps the default range when it is omitted from allowed ranges', async () => {
    renderWithProviders(
      <ActivityHeatmap
        scope="global"
        surface="global"
        defaultRange={365}
        allowedRanges={[30, 90]}
      />,
    );

    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(invokeMock).toHaveBeenCalledWith(
      'activity-heatmap:query',
      expect.objectContaining({ rangeDays: 365 }),
    );
  });

  it('renders range controls without metric controls', async () => {
    renderWithProviders(
      <ActivityHeatmap
        scope="global"
        surface="global"
        defaultRange={30}
        showMetricToggle={false}
        showRangePicker
      />,
    );

    expect(await screen.findByRole('tab', { name: '30 days', selected: true })).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Heatmap metric' })).not.toBeInTheDocument();
  });

  it('formats zero cost, zero tokens, and plural run values', async () => {
    invokeMock.mockImplementation(async (_channel: string, args: HeatmapQueryArgs) => {
      return buildRange(args.rangeDays, (date, idx) =>
        makeRecord(date, {
          costUsd: idx === 1 ? 1.23 : 0,
          tokens: idx === 0 ? 0 : 10,
          runs: idx === 0 ? 2 : 0,
        }),
      );
    });
    renderWithProviders(
      <ActivityHeatmap
        scope="global"
        surface="global"
        defaultRange={30}
        defaultMetric="costUsd"
        allowedMetrics={['costUsd']}
      />,
    );

    const zeroCostCell = (await screen.findAllByLabelText(/^.+: \$0\.00$/))[0];
    if (!zeroCostCell) throw new Error('Expected zero-cost cell');
    expect(await screen.findByLabelText(/^.+: \$1\.23$/)).toBeInTheDocument();
    fireEvent.mouseEnter(zeroCostCell);

    expect(await screen.findByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByText('0 tokens')).toBeInTheDocument();
    expect(screen.getByText('2 runs')).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });

  it('persists metric and range across mounts via localStorage', async () => {
    const { unmount } = renderWithProviders(
      <ActivityHeatmap scope="global" surface="global" defaultRange={30} />,
    );
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('tab', { name: 'Runs' }));
    fireEvent.click(screen.getByRole('tab', { name: '1 year' }));
    unmount();

    renderWithProviders(<ActivityHeatmap scope="global" surface="global" defaultRange={30} />);
    expect(await screen.findByRole('tab', { name: 'Runs', selected: true })).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: '1 year', selected: true })).toBeInTheDocument();
  });

  it('renders the empty-state grid without crashing when there is no activity', async () => {
    invokeMock.mockImplementation(async (_channel: string, args: HeatmapQueryArgs) => {
      return buildRange(args.rangeDays);
    });
    renderWithProviders(<ActivityHeatmap scope="global" surface="global" defaultRange={30} />);
    const heatmap = await screen.findByRole('region', { name: /Activity heatmap/ });
    expect(heatmap).toBeInTheDocument();
    // No "1 PR" / "$1.00" cells — every day is zero.
    expect(screen.queryByLabelText(/\$1\.00/)).toBeNull();
  });
});
