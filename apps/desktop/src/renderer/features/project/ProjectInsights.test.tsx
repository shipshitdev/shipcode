// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type { HeatmapDayRecord, HeatmapQueryArgs } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../stores/app-store';
import { ProjectInsights } from './ProjectInsights';

vi.mock('../../components/heatmap/ActivityHeatmap', () => ({
  ActivityHeatmap: ({
    onRangeChange,
    range,
  }: {
    onRangeChange: (range: 30 | 90 | 365) => void;
    range: 30 | 90 | 365;
  }) => (
    <div data-testid="project-activity-heatmap">
      <div>range {range}</div>
      <button type="button" onClick={() => onRangeChange(30)}>
        30 days
      </button>
      <button type="button" onClick={() => onRangeChange(365)}>
        365 days
      </button>
    </div>
  ),
}));

function renderWithClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectInsights />
    </QueryClientProvider>,
  );
}

function makeRecord(overrides: Partial<HeatmapDayRecord>): HeatmapDayRecord {
  return {
    date: '2026-01-01',
    costUsd: 0,
    tokens: 0,
    runs: 0,
    prsOpened: 0,
    ...overrides,
  };
}

describe('ProjectInsights', () => {
  const invokeMock = vi.fn<(channel: string, args?: HeatmapQueryArgs) => Promise<unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    useAppStore.setState({ activeProjectId: null } as never);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the empty state without querying activity', () => {
    renderWithClient();

    expect(screen.getByText('Select a project to view insights.')).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('summarizes activity totals and refetches when the range changes', async () => {
    invokeMock.mockResolvedValue([
      makeRecord({ costUsd: 1.2, tokens: 1500, runs: 2, prsOpened: 1 }),
      makeRecord({ costUsd: 0.04, tokens: 600, runs: 0, prsOpened: 2 }),
      makeRecord({ costUsd: 0, tokens: 0, runs: 1, prsOpened: 0 }),
    ]);
    useAppStore.setState({ activeProjectId: 'project-1' } as never);

    renderWithClient();

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('activity-heatmap:query', {
        scope: 'project',
        projectId: 'project-1',
        rangeDays: 90,
      }),
    );
    expect(screen.getByText('Insights')).toBeInTheDocument();
    expect(
      screen.getByText('Last 90 days · activity and spend across this project.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('2k')).toBeInTheDocument();
    expect(screen.getByText('$1.24')).toBeInTheDocument();
    expect(screen.getAllByText('3')).toHaveLength(2);
    expect(screen.getByText('of 90')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '30 days' }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('activity-heatmap:query', {
        scope: 'project',
        projectId: 'project-1',
        rangeDays: 30,
      }),
    );
    expect(
      screen.getByText('Last 30 days · activity and spend across this project.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '365 days' }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('activity-heatmap:query', {
        scope: 'project',
        projectId: 'project-1',
        rangeDays: 365,
      }),
    );
    expect(
      screen.getByText('Last year · activity and spend across this project.'),
    ).toBeInTheDocument();
  });

  it('formats zero and sub-cent costs', async () => {
    invokeMock.mockResolvedValueOnce([]);
    useAppStore.setState({ activeProjectId: 'project-1' } as never);

    renderWithClient();

    expect(await screen.findByText('$0.00')).toBeInTheDocument();

    cleanup();
    invokeMock.mockResolvedValueOnce([makeRecord({ costUsd: 0.004, tokens: 10, runs: 1 })]);
    renderWithClient();

    expect(await screen.findByText('< $0.01')).toBeInTheDocument();
  });
});
