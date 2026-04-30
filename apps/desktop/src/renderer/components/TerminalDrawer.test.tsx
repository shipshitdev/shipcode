// @vitest-environment jsdom

import type {
  ActivePipelineSummary,
  GitHubIssueCacheRecord,
  IntegrationStatus,
  PlanRecord,
} from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { TerminalDrawer } from './TerminalDrawer';

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TerminalDrawer />
    </QueryClientProvider>,
  );
}

const makeIssue = (overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord => ({
  id: 'issue-1',
  projectId: 'project-1',
  issueNumber: 1,
  title: 'Current project task',
  body: 'Body',
  labels: [],
  assignee: null,
  state: 'open',
  pipelineStatus: 'planning',
  threadId: 'thread-1',
  claimedAt: null,
  claimedBy: null,
  lastPhaseUpdate: null,
  lastStatusLabel: null,
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
  revisionCountOverride: null,
  linkedPrNumber: null,
  linkedPrUrl: null,
  linkedPrIsDraft: false,
  ciBlocked: false,
  failingChecks: [],
  unresolvedReviewComments: [],
  unresolvedReviewCommentCount: 0,
  prLastSyncAt: null,
  fetchedAt: new Date().toISOString(),
  priorityRank: null,
  priorityRaw: null,
  priorityFetchedAt: null,
  isQuickMode: false,
  ...overrides,
});

const integrations: IntegrationStatus = {
  system: {
    claude: {
      available: true,
      version: 'claude 1.0.0',
      path: '/usr/local/bin/claude',
      error: null,
      authenticated: true,
    },
    codex: {
      available: true,
      version: 'codex 1.0.0',
      path: '/usr/local/bin/codex',
      error: null,
      authenticated: true,
    },
    git: {
      available: true,
      version: 'git version 2.43.0',
      path: '/usr/bin/git',
      error: null,
      authenticated: false,
    },
    gh: {
      available: true,
      version: 'gh version 2.40.1',
      path: '/usr/local/bin/gh',
      error: null,
      authenticated: false,
    },
  },
  ghAuth: {
    installed: true,
    authenticated: true,
    username: 'decod3rs',
    version: '2.40.1',
    error: null,
    hasProjectScope: true,
  },
  openrouter: {
    enabled: false,
    keyPresent: false,
    authStatus: 'missing_key',
    message: 'OPENROUTER_API_KEY is not set',
    label: null,
    modelChecks: [],
  },
  discord: {
    enabled: false,
    configured: false,
    destinationConfigured: false,
    validationStatus: 'missing',
    message: 'Discord webhook URL is not configured',
    lastDeliveryStatus: null,
  },
  telegram: {
    enabled: false,
    configured: false,
    destinationConfigured: false,
    validationStatus: 'missing',
    message: 'Telegram bot token is not configured',
    lastDeliveryStatus: null,
  },
  desktopApps: {
    cursor: {
      key: 'cursor',
      label: 'Cursor',
      available: true,
      path: '/Applications/Cursor.app',
      error: null,
    },
    finder: {
      key: 'finder',
      label: 'Finder',
      available: true,
      path: '/System/Library/CoreServices/Finder.app',
      error: null,
    },
    terminal: {
      key: 'terminal',
      label: 'Terminal',
      available: true,
      path: '/System/Applications/Utilities/Terminal.app',
      error: null,
    },
    ghostty: {
      key: 'ghostty',
      label: 'Ghostty',
      available: false,
      path: null,
      error: 'Ghostty is not installed',
    },
    vscode: {
      key: 'vscode',
      label: 'Visual Studio Code',
      available: true,
      path: '/Applications/Visual Studio Code.app',
      error: null,
    },
  },
};

describe('TerminalDrawer', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    class MockResizeObserver {
      observe() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: MockResizeObserver,
    });
    (window as typeof window & { shipcode: typeof window.shipcode }).shipcode = {
      invoke: vi.fn(async (channel: string) => {
        if (channel === 'integrations:check') return integrations;
        return null;
      }) as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };

    useAppStore.setState({
      activeProjectId: 'project-1',
      activeThreadId: null,
      activeIssue: null,
      terminalVisible: true,
      terminalThreadId: null,
      pipelinePhase: 'idle',
      githubIssues: [],
      currentModels: {},
      canonicalTerminalStream: {},
    });
  });

  afterEach(() => {
    cleanup();
    if (originalResizeObserver) {
      Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        writable: true,
        value: originalResizeObserver,
      });
      return;
    }
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
  });

  it('shows an empty state when the visible terminal thread belongs to another project', () => {
    useAppStore.setState({
      activeProjectId: 'project-2',
      terminalThreadId: 'thread-1',
      canonicalTerminalStream: {
        'thread-1': [
          {
            id: 'event-1',
            threadId: 'thread-1',
            event: { kind: 'text', content: 'foreign output' },
            createdAt: new Date().toISOString(),
          },
        ],
      },
      currentModels: { 'thread-1': 'gpt-5.4' },
    });

    renderWithProviders();

    expect(screen.getByText('No issue selected for this project')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Console output will appear when you select or start an issue in this project.',
      ),
    ).toBeInTheDocument();
  });

  it('falls back to the selected project running issue when the stored thread is foreign', () => {
    useAppStore.setState({
      activeProjectId: 'project-1',
      terminalThreadId: 'thread-2',
      githubIssues: [
        makeIssue(),
        makeIssue({
          id: 'issue-2',
          projectId: 'project-2',
          issueNumber: 38,
          title: 'Foreign project task',
          threadId: 'thread-2',
          pipelineStatus: 'executing',
        }),
      ],
    });

    renderWithProviders();

    expect(screen.getByText('Current project task')).toBeInTheDocument();
    expect(screen.queryByText('Foreign project task')).not.toBeInTheDocument();
  });

  it('uses the selected issue when the issue store has not been hydrated yet', () => {
    useAppStore.setState({
      activeProjectId: 'project-1',
      activeIssue: makeIssue({
        pipelineStatus: 'failed',
        title: 'Selected but not yet hydrated',
        threadId: 'thread-1',
      }),
      terminalThreadId: 'thread-1',
      githubIssues: [],
      canonicalTerminalStream: {
        'thread-1': [
          {
            id: 'event-1',
            threadId: 'thread-1',
            event: { kind: 'text', content: 'historical output' },
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });

    renderWithProviders();

    expect(screen.getByText('Selected but not yet hydrated')).toBeInTheDocument();
    expect(screen.queryByText('No issue selected for this project')).not.toBeInTheDocument();
  });

  it('hydrates persisted terminal history for the selected thread', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'terminal:list') {
        return [
          {
            id: 'persisted-1',
            threadId: 'thread-1',
            event: { kind: 'text', content: 'persisted output' },
            createdAt: new Date().toISOString(),
          },
        ];
      }
      return null;
    });

    (window as typeof window & { shipcode: typeof window.shipcode }).shipcode = {
      invoke: invoke as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };

    useAppStore.setState({
      activeProjectId: 'project-1',
      activeIssue: makeIssue({
        pipelineStatus: 'failed',
        title: 'Hydrated issue',
        threadId: 'thread-1',
      }),
      terminalThreadId: 'thread-1',
      githubIssues: [],
      canonicalTerminalStream: {},
    });

    renderWithProviders();

    await waitFor(() => {
      expect(useAppStore.getState().canonicalTerminalStream['thread-1']).toHaveLength(1);
    });
    expect(await screen.findByText('persisted output')).toBeInTheDocument();
  });

  it('shows output for a running automation thread without a GitHub issue card', async () => {
    const automationRun: ActivePipelineSummary = {
      threadId: 'thread-auto',
      projectId: 'project-1',
      projectName: 'shipcode',
      threadTitle: '[Auto] clean',
      phase: 'testing',
      startedAt: Date.now() - 120_000,
      activeProcessId: 'process-auto',
      githubIssueNumber: null,
      modelProvider: 'claude',
      model: 'claude-sonnet-4-6',
      reasoningEffort: 'medium',
    };
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'integrations:check') return integrations;
      if (channel === 'pipeline:list-active') return [automationRun];
      return null;
    });

    (window as typeof window & { shipcode: typeof window.shipcode }).shipcode = {
      invoke: invoke as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };

    useAppStore.setState({
      activeProjectId: 'project-1',
      activeThreadId: 'thread-auto',
      activeIssue: null,
      terminalThreadId: 'thread-auto',
      pipelinePhase: 'testing',
      githubIssues: [],
      currentModels: { 'thread-auto': 'gpt-5.4' },
      canonicalTerminalStream: {
        'thread-auto': [
          {
            id: 'event-auto-1',
            threadId: 'thread-auto',
            event: { kind: 'text', content: 'running tests for automation' },
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });

    renderWithProviders();

    expect(await screen.findByText('Automation')).toBeInTheDocument();
    expect(screen.getByText('[Auto] clean')).toBeInTheDocument();
    expect(screen.getByText('running tests for automation')).toBeInTheDocument();
    expect(screen.queryByText('No issue selected for this project')).not.toBeInTheDocument();
  });

  it('filters the terminal dropdown to running issues in the selected project only', async () => {
    useAppStore.setState({
      activeProjectId: 'project-1',
      terminalThreadId: 'thread-1',
      githubIssues: [
        makeIssue(),
        makeIssue({
          id: 'issue-3',
          issueNumber: 2,
          title: 'Second project task',
          threadId: 'thread-3',
          pipelineStatus: 'verifying',
        }),
        makeIssue({
          id: 'issue-2',
          projectId: 'project-2',
          issueNumber: 38,
          title: 'Foreign project task',
          threadId: 'thread-2',
          pipelineStatus: 'executing',
        }),
      ],
    });

    renderWithProviders();

    fireEvent.pointerDown(screen.getByRole('button', { name: /Current project task/i }));

    expect(await screen.findByText('Second project task')).toBeInTheDocument();
    expect(screen.queryByText('Foreign project task')).not.toBeInTheDocument();
  });

  it('opens the configured project terminal from the header button', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'integrations:check') return integrations;
      return null;
    });

    (window as typeof window & { shipcode: typeof window.shipcode }).shipcode = {
      invoke: invoke as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };

    useAppStore.setState({
      activeProjectId: 'project-1',
      instantPaneThreadIds: [],
      instantPaneMetaByThread: {},
    } as never);

    renderWithProviders();

    fireEvent.click(screen.getByRole('button', { name: 'Open Terminal' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('project:open-path', {
        projectId: 'project-1',
        target: 'default-terminal',
      });
    });

    expect(useAppStore.getState().instantPaneThreadIds).toEqual([]);
  });

  it('switches into full-size terminal mode instead of keeping the resize handle visible', () => {
    useAppStore.setState({
      activeProjectId: 'project-1',
      terminalThreadId: 'thread-1',
      githubIssues: [makeIssue()],
    });

    renderWithProviders();

    expect(screen.getByLabelText('Resize terminal drawer')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand terminal' }));

    expect(screen.queryByLabelText('Resize terminal drawer')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse terminal' })).toBeInTheDocument();
    expect(useAppStore.getState().terminalMaximized).toBe(true);
  });

  it('shows waiting-for-execution copy for approved slot waiters', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'integrations:check') return integrations;
      if (channel === 'plan:list') {
        return [
          {
            id: 'plan-1',
            threadId: 'thread-1',
            version: 2,
            rawOutput: '',
            structured: null,
            status: 'approved',
            createdAt: new Date().toISOString(),
          },
        ] satisfies PlanRecord[];
      }
      return null;
    });

    (window as typeof window & { shipcode: typeof window.shipcode }).shipcode = {
      invoke: invoke as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };

    useAppStore.setState({
      activeProjectId: 'project-1',
      activeThreadId: 'thread-1',
      activeIssue: makeIssue({
        pipelineStatus: 'awaiting_approval',
        title: 'Approved slot waiter',
        threadId: 'thread-1',
      }),
      terminalThreadId: 'thread-1',
      pipelinePhase: 'awaiting_approval',
      githubIssues: [
        makeIssue({
          pipelineStatus: 'awaiting_approval',
          title: 'Approved slot waiter',
          threadId: 'thread-1',
        }),
      ],
      canonicalTerminalStream: {},
    });

    renderWithProviders();

    expect(await screen.findByText('Waiting for slot')).toBeInTheDocument();
    expect(screen.getByText(/Waiting for execution slot/i)).toBeInTheDocument();
  });
});
