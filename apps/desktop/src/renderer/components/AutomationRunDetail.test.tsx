// @vitest-environment jsdom

import type { Thread } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { AutomationRunDetail } from './AutomationRunDetail';

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    kind: 'pipeline',
    title: 'Daily smoke run',
    prompt:
      '# Automation: Daily smoke\n\n## Goal\nRun the smoke test.\n\n## Verification\n- `bun test` passes',
    status: 'completed',
    worktreeBranch: null,
    worktreePath: null,
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
    githubRepo: null,
    automationId: 'auto-1',
    lastError: null,
    failurePhase: null,
    failureCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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

describe('AutomationRunDetail', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    window.shipcode = {
      invoke: invokeMock as never,
      on: vi.fn(() => () => {}) as never,
    } as never;

    useAppStore.setState({
      activeAutomationThreadId: 'thread-1',
      activeAutomationDetailId: null,
      activeIssue: null,
      activeThreadId: 'thread-1',
      viewMode: 'automations',
    });
  });

  afterEach(() => {
    cleanup();
    invokeMock.mockReset();
    useAppStore.setState({ activeAutomationThreadId: null, activeThreadId: null });
  });

  it('renders the recorded automation prompt as markdown', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'thread:get') return makeThread();
      if (channel === 'plan:list') return [];
      if (channel === 'diff:list') return [];
      if (channel === 'automations:run-history') return [];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Daily smoke run')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Automation: Daily smoke' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Goal' })).toBeInTheDocument();
    expect(screen.getByText('Run the smoke test.')).toBeInTheDocument();
    expect(screen.getByText('bun test')).toBeInTheDocument();
  });
});
