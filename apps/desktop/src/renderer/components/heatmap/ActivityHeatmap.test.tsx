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
    expect(screen.getByRole('tab', { name: 'Cost', selected: true })).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }));
    expect(screen.getByRole('tab', { name: 'Tokens', selected: true })).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledTimes(1);
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
    const grid = await screen.findByRole('grid');
    expect(grid).toBeInTheDocument();
    // No "1 PR" / "$1.00" cells — every day is zero.
    expect(screen.queryByLabelText(/\$1\.00/)).toBeNull();
  });
});
