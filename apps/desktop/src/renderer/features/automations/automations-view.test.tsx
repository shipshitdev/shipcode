// @vitest-environment jsdom

import type { Automation, Project, Thread } from '@shipcode/shared';
import { TooltipProvider } from '@shipcode/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../stores/app-store';
import { AutomationsView } from './automations-view';

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    projectId: 'project-1',
    targets: ['project-1'],
    name: 'Daily smoke',
    prompt: 'List 3 files',
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
    prompt: 'Run the smoke test',
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
      <TooltipProvider>
        <AutomationsView />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe('AutomationsView', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    window.shipcode = {
      invoke: invokeMock as never,
      on: vi.fn(() => () => {}) as never,
    } as never;

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    useAppStore.setState({
      createAutomationModalOpen: false,
      editingAutomationId: null,
      activeAutomationThreadId: null,
      activeAutomationDetailId: null,
    });
  });

  afterEach(() => {
    cleanup();
    invokeMock.mockReset();
    vi.restoreAllMocks();
    useAppStore.setState({
      createAutomationModalOpen: false,
      editingAutomationId: null,
      activeAutomationThreadId: null,
      activeAutomationDetailId: null,
    });
  });

  it('shows the loading branch while automations are being fetched', () => {
    invokeMock.mockImplementation(
      (channel: string) =>
        new Promise((resolve) => {
          if (channel === 'project:list-visible') resolve([]);
        }),
    );

    const { container } = renderWithProviders();

    expect(screen.getByText('Automations')).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByText(/No automations yet\./)).not.toBeInTheDocument();
  });

  it('renders the empty state when there are no automations', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'automations:list-all') return [];
      if (channel === 'project:list-visible') return [];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText(/No automations yet\./)).toBeInTheDocument();
    expect(screen.getAllByText(/New automation/).length).toBeGreaterThan(0);
  });

  it('opens the create automation modal from the empty state action', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'automations:list-all') return [];
      if (channel === 'project:list-visible') return [];
      return null;
    });

    renderWithProviders();

    await screen.findByText(/No automations yet\./);
    fireEvent.click(screen.getAllByRole('button', { name: '+ New automation' })[1]);

    expect(useAppStore.getState().createAutomationModalOpen).toBe(true);
    expect(useAppStore.getState().editingAutomationId).toBeNull();
  });

  it('renders a card for each automation with project name and status', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'automations:list-all') {
        return [makeAutomation({ name: 'Smoke', lastStatus: 'completed' })];
      }
      if (channel === 'project:list-visible') return [makeProject()];
      return null;
    });

    renderWithProviders();

    await waitFor(() => expect(screen.getByText('Smoke')).toBeInTheDocument());
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText(/My Repo/)).toBeInTheDocument();
  });

  it('shows the next scheduled run when enabled and scheduled', async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 26).toISOString();
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'automations:list-all') {
        return [makeAutomation({ enabled: true, nextRunAt: future })];
      }
      if (channel === 'project:list-visible') return [makeProject()];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText(/Next in/)).toBeInTheDocument();
  });

  it('omits the next run line when the automation is disabled', async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 26).toISOString();
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'automations:list-all') {
        return [makeAutomation({ enabled: false, nextRunAt: future })];
      }
      if (channel === 'project:list-visible') return [makeProject()];
      return null;
    });

    renderWithProviders();

    await waitFor(() => expect(screen.getByText('Daily smoke')).toBeInTheDocument());
    expect(screen.queryByText(/Next in/)).not.toBeInTheDocument();
  });

  it('runs, edits, toggles, and deletes an automation from the card actions', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'automations:list-all') return [makeAutomation({ enabled: true })];
      if (channel === 'project:list-visible') return [makeProject()];
      if (channel === 'automations:run-now') return { queued: true };
      if (channel === 'automations:set-enabled') return makeAutomation({ enabled: false });
      if (channel === 'automations:delete') return undefined;
      return null;
    });

    renderWithProviders();

    await screen.findByText('Daily smoke');
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit automation' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Disable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete automation' }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('automations:run-now', { id: 'auto-1' }),
    );
    expect(useAppStore.getState().createAutomationModalOpen).toBe(true);
    expect(useAppStore.getState().editingAutomationId).toBe('auto-1');
    expect(invokeMock).toHaveBeenCalledWith('automations:set-enabled', {
      id: 'auto-1',
      enabled: false,
    });
    expect(window.confirm).toHaveBeenCalledWith('Delete automation "Daily smoke"?');
    expect(invokeMock).toHaveBeenCalledWith('automations:delete', { id: 'auto-1' });
  });

  it('expands run history, opens a run, and links to the full detail when history is long', async () => {
    const runs = Array.from({ length: 6 }, (_, index) =>
      makeThread({
        id: `thread-${index + 1}`,
        title: `Run ${index + 1}`,
        status: index === 0 ? 'failed' : 'completed',
        lastError: index === 0 ? 'Tests failed' : null,
        failureCount: index === 0 ? 1 : 0,
      }),
    );
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'automations:list-all') return [makeAutomation({ runCount: 6 })];
      if (channel === 'project:list-visible') return [makeProject()];
      if (channel === 'automations:run-history') return runs;
      return null;
    });

    renderWithProviders();

    fireEvent.click(
      await screen.findByRole('button', { name: /Expand run history for Daily smoke/ }),
    );
    expect(await screen.findByText('Run History')).toBeInTheDocument();
    fireEvent.click(await screen.findByText(/Tests failed/));

    expect(useAppStore.getState().activeAutomationThreadId).toBe('thread-1');

    fireEvent.click(screen.getByRole('button', { name: /View all 6 runs/ }));

    expect(useAppStore.getState().activeAutomationDetailId).toBe('auto-1');
  });

  it('shows empty run history and invalid cron text when expanded', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'automations:list-all') return [makeAutomation({ cronExpr: 'not cron' })];
      if (channel === 'project:list-visible') return [];
      if (channel === 'automations:run-history') return [];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText(/Unknown project · Invalid: not cron/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Expand run history for Daily smoke/ }));

    expect(await screen.findByText('No runs yet.')).toBeInTheDocument();
  });
});
