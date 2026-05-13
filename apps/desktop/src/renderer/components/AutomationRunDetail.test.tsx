// @vitest-environment jsdom

import type { PlanRecord, Thread } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    pausedPhase: null,
    pausedAt: null,
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

function makePlan(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: 'plan-1',
    threadId: 'thread-1',
    version: 1,
    rawOutput: 'raw plan',
    status: 'pending_review',
    createdAt: new Date().toISOString(),
    structured: {
      id: 'plan-1',
      threadId: 'thread-1',
      version: 1,
      objective: 'Run automation',
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

describe('AutomationRunDetail', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
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
      activeIssue: null,
      activeThreadId: 'thread-1',
      viewMode: 'automations',
    });
  });

  afterEach(() => {
    cleanup();
    invokeMock.mockReset();
    vi.restoreAllMocks();
    useAppStore.setState({
      activeAutomationThreadId: null,
      activeAutomationDetailId: null,
      activeThreadId: null,
      activeIssue: null,
      pendingGitWorktreePath: null,
    });
  });

  it('renders nothing when no automation run is selected', () => {
    useAppStore.setState({ activeAutomationThreadId: null, activeThreadId: null });

    const { container } = renderWithProviders();

    expect(container).toBeEmptyDOMElement();
    expect(invokeMock).not.toHaveBeenCalled();
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

  it('shows the no-prompt branch for runs without a recorded prompt', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'thread:get') return { ...makeThread(), prompt: null };
      if (channel === 'plan:list') return [];
      if (channel === 'diff:list') return [];
      if (channel === 'automations:run-history') return [];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('No prompt recorded.')).toBeInTheDocument();
  });

  it('renders closed automation runs as closed and lets them move back to completed', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'thread:get') {
        return makeThread({ status: 'completed', doneAt: '2026-05-13T08:00:00.000Z' });
      }
      if (channel === 'plan:list') return [];
      if (channel === 'diff:list') return [];
      if (channel === 'automations:run-history') return [];
      if (channel === 'thread:set-done-status') return makeThread({ status: 'completed' });
      return null;
    });

    renderWithProviders();

    fireEvent.pointerDown(await screen.findByRole('button', { name: /closed/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /completed/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('thread:set-done-status', {
        threadId: 'thread-1',
        status: 'completed',
      }),
    );
  });

  it('clamps approval errors with the shared renderer error helper', async () => {
    const rawError = `${'Approval is already confirmed. '.repeat(20)}\nWaiting for an execution slot.`;
    const expectedError = `${rawError.split('\n')[0].slice(0, 279)}…`;

    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'thread:get') return makeThread({ status: 'approval' });
      if (channel === 'plan:list') return [makePlan()];
      if (channel === 'diff:list') return [];
      if (channel === 'automations:run-history') return [];
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'pipeline:approve') throw new Error(rawError);
      return null;
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(expectedError)).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for an execution slot\./)).not.toBeInTheDocument();
  });

  it('approves automation runs awaiting approval', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'thread:get') return makeThread({ status: 'approval' });
      if (channel === 'plan:list') return [makePlan()];
      if (channel === 'diff:list') return [];
      if (channel === 'automations:run-history') return [];
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'pipeline:approve') {
        return undefined;
      }
      return null;
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('pipeline:approve', { threadId: 'thread-1' });
    });
  });

  it('renders the approved waiting state and cancels it', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'thread:get') return makeThread({ status: 'approval' });
      if (channel === 'plan:list') return [makePlan({ status: 'approved' })];
      if (channel === 'diff:list') return [];
      if (channel === 'automations:run-history') return [];
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'pipeline:cancel') return undefined;
      return null;
    });

    renderWithProviders();

    expect(
      await screen.findByText(
        'Approval is confirmed. Execution starts when current slot frees up.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('pipeline:cancel', { threadId: 'thread-1' }),
    );
  });

  it('closes the run detail from the back button and Escape key', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'thread:get') return makeThread();
      if (channel === 'plan:list') return [];
      if (channel === 'diff:list') return [];
      if (channel === 'automations:run-history') return [];
      return null;
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Back to board' }));
    expect(useAppStore.getState().activeAutomationThreadId).toBeNull();

    useAppStore.setState({ activeAutomationThreadId: 'thread-1', activeThreadId: 'thread-1' });
    renderWithProviders();
    await screen.findByText('Daily smoke run');
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(useAppStore.getState().activeAutomationThreadId).toBeNull();
  });

  it('pauses active runs through the persistent pipeline action', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'thread:get') return makeThread({ status: 'executing' });
      if (channel === 'plan:list') return [];
      if (channel === 'diff:list') return [];
      if (channel === 'automations:run-history') return [];
      if (channel === 'pipeline:pause') return undefined;
      return null;
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Pause task' }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('pipeline:pause', { threadId: 'thread-1' }),
    );
  });

  it('resumes paused runs through the persistent pipeline action', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'thread:get')
        return makeThread({ status: 'paused', pausedPhase: 'executing' });
      if (channel === 'plan:list') return [];
      if (channel === 'diff:list') return [];
      if (channel === 'automations:run-history') return [];
      if (channel === 'pipeline:resume') return undefined;
      return null;
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Resume task' }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('pipeline:resume', { threadId: 'thread-1' }),
    );
  });

  it('renders failed run errors and retries or closes the run', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'thread:get') {
        return makeThread({
          status: 'failed',
          lastError: 'Verifier found missing coverage',
          failurePhase: 'verify',
          failureCount: 1,
        });
      }
      if (channel === 'plan:list') return [];
      if (channel === 'diff:list') return [];
      if (channel === 'automations:run-history') return [];
      if (channel === 'pipeline:retry') return undefined;
      if (channel === 'thread:mark-done') return undefined;
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Failed in verify')).toBeInTheDocument();
    expect(screen.getByText('Verifier found missing coverage')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('pipeline:retry', { threadId: 'thread-1' }),
    );
    expect(invokeMock).toHaveBeenCalledWith('thread:mark-done', { threadId: 'thread-1' });
  });

  it('renders branch metadata actions and creates a pull request', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'thread:get') {
        return makeThread({
          status: 'completed',
          worktreeBranch: 'shipcode/auto-1',
          worktreePath: '/tmp/worktree',
          githubRepo: 'decod3rs/shipcode',
          baseBranch: 'main',
          totalCostUsd: 0.5,
          totalTokensPrompt: 1000,
          totalTokensCompletion: 500,
          executorResolvedModel: 'claude-sonnet',
          verifierResolvedModel: 'codex',
        });
      }
      if (channel === 'plan:list') return [];
      if (channel === 'diff:list') return [];
      if (channel === 'automations:run-history') return [];
      if (channel === 'shell:open-external') return undefined;
      if (channel === 'pipeline:create-pr') {
        return { prNumber: 12, prUrl: 'https://github.com/decod3rs/shipcode/pull/12' };
      }
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('shipcode/auto-1')).toBeInTheDocument();
    expect(screen.getByText('$0.50')).toBeInTheDocument();
    expect(screen.getByText('Tokens')).toBeInTheDocument();
    expect(screen.getByText('claude-sonnet')).toBeInTheDocument();
    expect(screen.getByText('codex')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Copy branch name'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('shipcode/auto-1');

    fireEvent.click(screen.getByTitle('Compare on GitHub'));
    expect(invokeMock).toHaveBeenCalledWith('shell:open-external', {
      url: 'https://github.com/decod3rs/shipcode/compare/main...shipcode%2Fauto-1',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('pipeline:create-pr', { threadId: 'thread-1' }),
    );

    fireEvent.click(screen.getByTitle('View in Git tab'));
    expect(useAppStore.getState().activeProjectId).toBe('project-1');
    expect(useAppStore.getState().projectTab).toBe('git');
    expect(useAppStore.getState().pendingGitWorktreePath).toBe('/tmp/worktree');
  });

  it('shows pull request creation errors inline', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'thread:get') {
        return makeThread({
          status: 'completed',
          worktreeBranch: 'shipcode/auto-1',
          githubRepo: 'decod3rs/shipcode',
          baseBranch: 'main',
        });
      }
      if (channel === 'plan:list') return [];
      if (channel === 'diff:list') return [];
      if (channel === 'automations:run-history') return [];
      if (channel === 'pipeline:create-pr') throw new Error('draft PR failed');
      return null;
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Create PR' }));

    expect(await screen.findByText('draft PR failed')).toBeInTheDocument();
  });

  it('opens pull request links and switches between run history entries', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'thread:get') {
        return makeThread({
          githubRepo: 'decod3rs/shipcode',
          githubPrNumber: 42,
          automationId: 'auto-1',
        });
      }
      if (channel === 'plan:list') return [];
      if (channel === 'diff:list') return [];
      if (channel === 'automations:run-history') {
        return [
          makeThread({ id: 'thread-1', title: 'Current run', status: 'completed' }),
          makeThread({
            id: 'thread-2',
            title: 'Previous run',
            status: 'failed',
            lastError: 'Previous failure',
            failureCount: 2,
          }),
        ];
      }
      if (channel === 'shell:open-external') return undefined;
      return null;
    });

    renderWithProviders();

    fireEvent.click(await screen.findByTitle('Open pull request on GitHub'));
    expect(invokeMock).toHaveBeenCalledWith('shell:open-external', {
      url: 'https://github.com/decod3rs/shipcode/pull/42',
    });

    const historyTab = screen.getByRole('tab', { name: /History/ });
    fireEvent.mouseDown(historyTab, { button: 0 });
    fireEvent.click(historyTab);
    await waitFor(() => expect(historyTab).toHaveAttribute('data-state', 'active'));
    fireEvent.click(await screen.findByText(/Previous failure/));

    expect(useAppStore.getState().activeAutomationThreadId).toBe('thread-2');
  });
});
