// @vitest-environment jsdom

import type { PipelinePhaseDurationSummary, PipelineTokensByPhase } from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CostByProjectChart } from './CostByProjectChart';
import { PhaseDurationsChart } from './PhaseDurationsChart';
import { TokensByPhaseChart } from './TokensByPhaseChart';

afterEach(() => {
  cleanup();
});

describe('cost chart components', () => {
  it('renders project totals in cost and token modes and hides single-project data', () => {
    const byProject = [
      {
        projectId: 'project-1',
        projectName: 'ShipCode',
        totalCostUsd: 12.5,
        totalTokensPrompt: 10_000,
        totalTokensCompletion: 2_500,
        taskCount: 4,
      },
      {
        projectId: 'project-2',
        projectName: 'Docs',
        totalCostUsd: 3.25,
        totalTokensPrompt: 1_000,
        totalTokensCompletion: 500,
        taskCount: 1,
      },
    ];

    const { rerender, container } = render(
      <CostByProjectChart byProject={[byProject[0]]} displayMode="$" />,
    );
    expect(container.firstChild).toBeNull();

    rerender(<CostByProjectChart byProject={byProject} displayMode="$" className="custom-chart" />);
    expect(screen.getByText('Cost by Project')).toBeInTheDocument();
    expect(screen.getByText('$15.75')).toBeInTheDocument();
    expect(screen.getByText('ShipCode')).toBeInTheDocument();
    expect(screen.getByText('$12.50')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('custom-chart');

    rerender(<CostByProjectChart byProject={byProject} displayMode="tokens" />);
    expect(screen.getByText('Tokens by Project')).toBeInTheDocument();
    expect(screen.getByText('14k')).toBeInTheDocument();
    expect(screen.getByText('13k')).toBeInTheDocument();
  });

  it('aggregates duplicate project names into a single entry', () => {
    const byProject = [
      {
        projectId: 'p1',
        projectName: 'shipcode',
        totalCostUsd: 5,
        totalTokensPrompt: 1_000,
        totalTokensCompletion: 500,
        taskCount: 2,
      },
      {
        projectId: 'p2',
        projectName: 'shipcode',
        totalCostUsd: 3,
        totalTokensPrompt: 2_000,
        totalTokensCompletion: 1_000,
        taskCount: 1,
      },
      {
        projectId: 'p3',
        projectName: 'docs',
        totalCostUsd: 1,
        totalTokensPrompt: 500,
        totalTokensCompletion: 200,
        taskCount: 1,
      },
    ];

    render(<CostByProjectChart byProject={byProject} displayMode="$" />);
    const labels = screen.getAllByText('shipcode');
    expect(labels).toHaveLength(1);
    expect(screen.getByText('$8.00')).toBeInTheDocument();
    expect(screen.getByText('$9.00')).toBeInTheDocument();
  });

  it('renders phase token and cost charts with legends and empty state', () => {
    const tokensByPhase = [
      {
        phase: 'plan' as const,
        promptTokens: 20_000,
        completionTokens: 5_000,
        costUsd: 1.25,
        attemptCount: 2,
      },
      {
        phase: 'execute' as const,
        promptTokens: 50_000,
        completionTokens: 10_000,
        costUsd: 4.5,
        attemptCount: 3,
      },
    ] satisfies PipelineTokensByPhase[];

    const { rerender } = render(<TokensByPhaseChart tokensByPhase={[]} displayMode="tokens" />);
    expect(screen.getByText('No token usage data yet.')).toBeInTheDocument();

    rerender(<TokensByPhaseChart tokensByPhase={tokensByPhase} displayMode="tokens" />);
    expect(screen.getByText('Tokens by Phase')).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('Execute')).toBeInTheDocument();
    expect(screen.getByText('Prompt')).toBeInTheDocument();
    expect(screen.getByText('Completion')).toBeInTheDocument();
    expect(screen.getByTitle('20k prompt, 5k completion')).toBeInTheDocument();

    rerender(<TokensByPhaseChart tokensByPhase={tokensByPhase} displayMode="$" />);
    expect(screen.getByText('Cost by Phase')).toBeInTheDocument();
    expect(screen.getByText('Cost')).toBeInTheDocument();
    expect(screen.getByTitle('$4.50')).toBeInTheDocument();
  });

  it('renders phase duration rows across duration formats and empty state', () => {
    const phaseDurations = [
      {
        phase: 'review_plan' as PipelinePhaseDurationSummary['phase'],
        runCount: 3,
        averageMs: 500,
        medianMs: 450,
        p75Ms: 900,
        p95Ms: 950,
      },
      {
        phase: 'execute' as PipelinePhaseDurationSummary['phase'],
        runCount: 3,
        averageMs: 12_500,
        medianMs: 11_000,
        p75Ms: 75_000,
        p95Ms: 90_000,
      },
      {
        phase: 'verify' as PipelinePhaseDurationSummary['phase'],
        runCount: 3,
        averageMs: 3_900_000,
        medianMs: 3_600_000,
        p75Ms: null,
        p95Ms: null,
      },
    ] as unknown as PipelinePhaseDurationSummary[];

    const { rerender } = render(<PhaseDurationsChart phaseDurations={[]} />);
    expect(screen.getByText('No phase timing data yet.')).toBeInTheDocument();

    rerender(<PhaseDurationsChart phaseDurations={phaseDurations} />);
    expect(screen.getByText('Phase Durations')).toBeInTheDocument();
    expect(screen.getByText('review plan')).toBeInTheDocument();
    expect(screen.getByText('avg 500ms')).toBeInTheDocument();
    expect(screen.getByText('p75 900ms')).toBeInTheDocument();
    expect(screen.getByText('avg 12.5s')).toBeInTheDocument();
    expect(screen.getByText('p75 1m 15s')).toBeInTheDocument();
    expect(screen.getByText('avg 1h 5m')).toBeInTheDocument();
    expect(screen.getByText('p75 —')).toBeInTheDocument();
  });
});
