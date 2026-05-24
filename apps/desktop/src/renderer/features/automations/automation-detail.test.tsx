// @vitest-environment jsdom

import type { Automation, Project, Thread } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../stores/app-store';
import { AutomationDetail } from './automation-detail';

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    projectId: 'project-1',
    name: 'Daily smoke',
    prompt:
      '# Automation: Daily smoke\n\n## Goal\nRun the smoke test.\n\n## Verification\n- `bun test` passes',
    cronExpr: '0 9 * * *',
    enabled: true,
    executorProvider: null,
    executorModelId: null,
    executorReasoningEffort: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastStatus: null,
    nextRunAt: null,
    runCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'My Repo',
    path: '/tmp/proj',
    gitRemote: null,
    githubProjectUrl: null,
    githubStatusMapping: null,
    defaultBranch: 'main',
    plannerModelOverride: null,
    reviewerModelOverride: null,
    executorModelOverride: null,
    verifierModelOverride: null,
    plannerModelIdOverride: null,
    reviewerModelIdOverride: null,
    executorModelIdOverride: null,
    verifierModelIdOverride: null,
    plannerReasoningEffortOverride: null,
    reviewerReasoningEffortOverride: null,
    executorReasoningEffortOverride: null,
    verifierReasoningEffortOverride: null,
    discordRouting: 'inherit',
    discordWebhookUrlOverride: null,
    telegramRouting: 'inherit',
    telegramChatIdOverride: null,
    pinned: false,
    archived: false,
    hidden: false,
    notifyGithubUser: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Project;
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    kind: 'pipeline',
    title: 'Daily smoke run',
    prompt: 'Run smoke tests',
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
    pausedPhase: null,
    pausedAt: null,
    createdAt: '2026-05-08T09:00:00.000Z',
    updatedAt: '2026-05-08T09:00:00.000Z',
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
      <AutomationDetail />
    </QueryClientProvider>,
  );
}

describe('AutomationDetail', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    window.shipcode = {
      invoke: invokeMock as never,
      on: vi.fn(() => () => {}) as never,
    } as never;

    useAppStore.setState({
      activeAutomationDetailId: 'auto-1',
      activeAutomationThreadId: null,
      activeIssue: null,
      activeThreadId: null,
      viewMode: 'automations',
    });
  });

  afterEach(() => {
    cleanup();
    invokeMock.mockReset();
    useAppStore.setState({
      activeAutomationDetailId: null,
      activeAutomationThreadId: null,
      activeThreadId: null,
    });
  });

  it('renders nothing when no automation detail is selected', () => {
    useAppStore.setState({ activeAutomationDetailId: null });

    const { container } = renderWithProviders();

    expect(container).toBeEmptyDOMElement();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('shows the loading branch while the automation is fetched', () => {
    invokeMock.mockImplementation(
      (channel: string) =>
        new Promise((resolve) => {
          if (channel === 'automations:run-history') resolve([]);
        }),
    );

    const { container } = renderWithProviders();

    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByText('Daily smoke')).not.toBeInTheDocument();
  });

  it('renders formatted automation prompts in the main detail column', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'automations:get') return makeAutomation();
      if (channel === 'project:get') return makeProject();
      if (channel === 'automations:run-history') return [];
      return null;
    });

    renderWithProviders();

    await waitFor(() => expect(screen.getByText('Daily smoke')).toBeInTheDocument());

    expect(screen.getByRole('heading', { name: 'Automation: Daily smoke' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Goal' })).toBeInTheDocument();
    expect(screen.getByText('Run the smoke test.')).toBeInTheDocument();
    expect(screen.getByText('All Runs (0)')).toBeInTheDocument();
  });

  it('returns to the automations list from the back button', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'automations:get') return makeAutomation();
      if (channel === 'project:get') return makeProject();
      if (channel === 'automations:run-history') return [];
      return null;
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Back to automations' }));

    expect(useAppStore.getState().activeAutomationDetailId).toBeNull();
    expect(useAppStore.getState().viewMode).toBe('automations');
  });

  it('renders empty history, disabled status, invalid schedule, and executor override metadata', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'automations:get') {
        return makeAutomation({
          cronExpr: 'not cron',
          enabled: false,
          executorProvider: 'codex',
          executorModelId: 'gpt-5-codex',
          runCount: 3,
          lastStatus: 'failed',
          lastStartedAt: '2026-05-08T08:00:00.000Z',
        });
      }
      if (channel === 'project:get') return makeProject({ name: 'Automation Repo' });
      if (channel === 'automations:run-history') return [];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Automation Repo')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText('not cron')).toBeInTheDocument();
    expect(screen.getByText('Invalid: not cron')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('codex')).toBeInTheDocument();
    expect(screen.getByText('gpt-5-codex')).toBeInTheDocument();
    expect(screen.getByText('No runs yet.')).toBeInTheDocument();
  });

  it('renders run history with failure, cost, tokens, and opens a selected run', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'automations:get') return makeAutomation({ runCount: 1 });
      if (channel === 'project:get') return makeProject();
      if (channel === 'automations:run-history') {
        return [
          makeThread({
            id: 'thread-failed',
            status: 'failed',
            lastError: 'Verifier found missing coverage',
            failureCount: 2,
            totalCostUsd: 1.25,
            totalTokensPrompt: 1200,
            totalTokensCompletion: 300,
          }),
        ];
      }
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText(/Verifier found missing coverage/)).toBeInTheDocument();
    expect(screen.getByText('2 failures')).toBeInTheDocument();
    expect(screen.getByText('$1.25')).toBeInTheDocument();
    expect(screen.getByText(/tokens/)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Verifier found missing coverage/));

    expect(useAppStore.getState().activeAutomationThreadId).toBe('thread-failed');
    expect(useAppStore.getState().activeAutomationDetailId).toBeNull();
  });
});
