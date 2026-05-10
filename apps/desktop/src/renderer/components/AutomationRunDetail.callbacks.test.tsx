// @vitest-environment jsdom

import type { PlanRecord, Thread } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';

vi.mock('./issue-detail/ApprovalSection', () => ({
  ApprovalSection: ({
    onApprove,
    onCancel,
    onReject,
  }: {
    onApprove: () => void;
    onCancel: () => void;
    onReject: (feedback: string) => void;
  }) => (
    <div>
      <button type="button" onClick={onApprove}>
        approve callback
      </button>
      <button type="button" onClick={onCancel}>
        cancel callback
      </button>
      <button type="button" onClick={() => onReject('  tighten scope  ')}>
        reject callback
      </button>
      <button type="button" onClick={() => onReject('   ')}>
        reject blank callback
      </button>
    </div>
  ),
}));

vi.mock('./issue-detail/PlanHistoryTab', () => ({
  PlanHistoryTab: ({
    onFullScreenPlan,
    onPlanExpandedChange,
    onPlanHistoryCollapsedChange,
    onShowAllPlanRunsChange,
  }: {
    onFullScreenPlan: (planId: string | null) => void;
    onPlanExpandedChange: (planId: string | null) => void;
    onPlanHistoryCollapsedChange: (collapsed: boolean) => void;
    onShowAllPlanRunsChange: (show: boolean) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onFullScreenPlan('plan-1')}>
        plan fullscreen callback
      </button>
      <button type="button" onClick={() => onPlanExpandedChange('plan-1')}>
        plan expand callback
      </button>
      <button type="button" onClick={() => onPlanHistoryCollapsedChange(true)}>
        plan collapse callback
      </button>
      <button type="button" onClick={() => onShowAllPlanRunsChange(true)}>
        plan all runs callback
      </button>
    </div>
  ),
}));

vi.mock('./issue-detail/DiffTab', () => ({
  DiffTab: ({ children }: { children?: ReactNode }) => <div>diff tab {children}</div>,
}));

import { AutomationRunDetail } from './AutomationRunDetail';

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    kind: 'pipeline',
    title: 'Callback run',
    prompt: 'Run callback test',
    status: 'approval',
    worktreeBranch: 'shipcode/callback',
    worktreePath: '/tmp/worktree',
    plannerModel: 'claude',
    reviewerModel: 'claude',
    verifierModel: 'claude',
    executorModel: 'claude',
    reviewRound: 0,
    clarificationRound: 0,
    clarificationRequest: null,
    clarificationAnswers: [],
    answeredClarification: null,
    verificationStatus: null,
    verificationRetries: 0,
    autonomous: true,
    baseBranch: 'main',
    forkPointSha: null,
    githubIssueNumber: null,
    githubPrNumber: null,
    githubRepo: 'decod3rs/shipcode',
    automationId: 'auto-1',
    lastError: null,
    failurePhase: null,
    failureCount: 0,
    pausedPhase: null,
    pausedAt: null,
    createdAt: '2026-05-09T00:00:00.000Z',
    updatedAt: '2026-05-09T00:00:00.000Z',
    plannerResolvedModel: null,
    reviewerResolvedModel: null,
    revisorResolvedModel: null,
    executorResolvedModel: null,
    verifierResolvedModel: null,
    totalTokensPrompt: 0,
    totalTokensCompletion: 0,
    totalCostUsd: 0,
    doneAt: null,
    ...overrides,
  };
}

function makePlan(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: 'plan-1',
    threadId: 'thread-1',
    version: 1,
    rawOutput: 'raw plan',
    status: 'pending_review',
    createdAt: '2026-05-09T00:00:00.000Z',
    structured: {
      id: 'plan-1',
      threadId: 'thread-1',
      version: 1,
      objective: 'Plan objective',
      files: [],
      steps: [],
      acceptanceCriteria: [],
      outOfScope: [],
      estimatedComplexity: 'low',
      dependencies: [],
    },
    ...overrides,
  };
}

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AutomationRunDetail />
    </QueryClientProvider>,
  );
}

describe('AutomationRunDetail callback harness', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    cleanup();
    invokeMock.mockReset();
    window.shipcode = {
      invoke: invokeMock as never,
      on: vi.fn(() => () => {}) as never,
    } as never;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn() },
    });
    useAppStore.setState({
      activeAutomationThreadId: 'thread-1',
      activeAutomationDetailId: null,
      activeThreadId: 'thread-1',
      activeIssue: null,
      viewMode: 'automations',
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('routes approval child callbacks through automation run handlers', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread:get') return makeThread({ status: 'approval' });
      if (channel === 'plan:list') return [makePlan()];
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'diff:list') return [];
      if (channel === 'automations:run-history') return [];
      return undefined;
    });

    renderWithProviders();

    expect(await screen.findByText('Callback run')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'approve callback' }));
    fireEvent.click(screen.getByRole('button', { name: 'reject callback' }));
    fireEvent.click(screen.getByRole('button', { name: 'reject blank callback' }));
    fireEvent.click(screen.getByRole('button', { name: 'cancel callback' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('pipeline:approve', { threadId: 'thread-1' });
      expect(invokeMock).toHaveBeenCalledWith('pipeline:reject', {
        threadId: 'thread-1',
        feedback: 'tighten scope',
      });
      expect(invokeMock).toHaveBeenCalledWith('pipeline:cancel', { threadId: 'thread-1' });
    });
    expect(invokeMock).not.toHaveBeenCalledWith('pipeline:reject', {
      threadId: 'thread-1',
      feedback: '',
    });
  });

  it('routes plan history callbacks and copied branch reset', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread:get') return makeThread({ status: 'completed' });
      if (channel === 'plan:list') return [makePlan()];
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'diff:list') return [];
      if (channel === 'automations:run-history') return [];
      return undefined;
    });

    renderWithProviders();

    expect(await screen.findByText('Callback run')).toBeInTheDocument();

    const plansTab = screen.getByRole('tab', { name: /Plans/ });
    fireEvent.mouseDown(plansTab, { button: 0 });
    fireEvent.click(plansTab);

    fireEvent.click(await screen.findByRole('button', { name: 'plan fullscreen callback' }));
    fireEvent.click(screen.getByRole('button', { name: 'plan expand callback' }));
    fireEvent.click(screen.getByRole('button', { name: 'plan collapse callback' }));
    fireEvent.click(screen.getByRole('button', { name: 'plan all runs callback' }));

    fireEvent.click(screen.getByTitle('Copy branch name'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('shipcode/callback');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    await waitFor(
      () => {
        expect(screen.queryByText('Copied')).not.toBeInTheDocument();
      },
      { timeout: 2500 },
    );
  });
});
