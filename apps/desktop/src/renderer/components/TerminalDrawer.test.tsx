// @vitest-environment jsdom

import type {
  ActivePipelineSummary,
  GitHubIssueCacheRecord,
  IntegrationStatus,
  PlanRecord,
} from '@shipcode/shared';
import { TooltipProvider } from '@shipcode/ui';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { useToastStore } from '../stores/toast-store';
import { TerminalDrawer } from './TerminalDrawer';

function renderWithProviders(props: React.ComponentProps<typeof TerminalDrawer> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <TerminalDrawer {...props} />
      </TooltipProvider>
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
    t3code: {
      key: 't3code',
      label: 'T3 Code',
      available: true,
      path: '/Applications/T3 Code.app',
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
      terminalMaximized: false,
      terminalThreadId: null,
      pipelinePhase: 'idle',
      githubIssues: [],
      currentModels: {},
      canonicalTerminalStream: {},
    });
    useToastStore.setState({ toasts: [] });
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

  it('uses the exit animation while closing', () => {
    const { container } = renderWithProviders({ isExiting: true });

    expect(container.firstElementChild).toHaveClass('animate-terminal-exit');
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

  it('ignores terminal history hydration failures', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'integrations:check') return integrations;
      if (channel === 'terminal:list') throw new Error('history unavailable');
      return null;
    });

    (window as typeof window & { shipcode: typeof window.shipcode }).shipcode = {
      invoke: invoke as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };

    useAppStore.setState({
      activeProjectId: 'project-1',
      activeIssue: makeIssue({
        pipelineStatus: 'executing',
        title: 'No history task',
        threadId: 'thread-1',
      }),
      terminalThreadId: 'thread-1',
      githubIssues: [
        makeIssue({
          pipelineStatus: 'executing',
          title: 'No history task',
          threadId: 'thread-1',
        }),
      ],
      canonicalTerminalStream: {},
    });

    renderWithProviders();

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('terminal:list', {
        threadId: 'thread-1',
        limit: 2000,
      });
    });
    expect(useAppStore.getState().canonicalTerminalStream['thread-1']).toBeUndefined();
  });

  it('opens issue targets from action rows in terminal output', async () => {
    useAppStore.setState({
      activeProjectId: 'project-1',
      activeIssue: null,
      terminalThreadId: 'thread-1',
      githubIssues: [
        makeIssue({
          id: 'issue-action',
          issueNumber: 9,
          pipelineStatus: 'executing',
          title: 'Action task',
          threadId: 'thread-1',
        }),
      ],
      canonicalTerminalStream: {
        'thread-1': [
          {
            id: 'action-1',
            threadId: 'thread-1',
            event: { kind: 'action', label: 'Open action task', action: 'open-issue-detail' },
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Open action task' }));

    expect(useAppStore.getState().activeIssue?.id).toBe('issue-action');
    expect(useAppStore.getState().terminalThreadId).toBe('thread-1');
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

  it('selects running issue targets and ignores issues without threads', async () => {
    useAppStore.setState({
      activeProjectId: 'project-1',
      terminalThreadId: 'thread-1',
      activeIssue: null,
      githubIssues: [
        makeIssue(),
        makeIssue({
          id: 'issue-3',
          issueNumber: 2,
          title: 'Selectable task',
          threadId: 'thread-3',
          pipelineStatus: 'verifying',
        }),
        makeIssue({
          id: 'issue-no-thread',
          issueNumber: 4,
          title: 'No thread yet',
          threadId: null,
          pipelineStatus: 'planning',
        }),
      ],
    });

    renderWithProviders();

    fireEvent.pointerDown(screen.getByRole('button', { name: /Current project task/i }));
    expect(screen.queryByText('No thread yet')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText('Selectable task'));

    const state = useAppStore.getState();
    expect(state.terminalThreadId).toBe('thread-3');
    expect(state.activeIssue?.id).toBe('issue-3');
  });

  it('loads an explicit instant thread when no issue target exists', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'integrations:check') return integrations;
      if (channel === 'thread:get') {
        return {
          id: 'thread-instant',
          projectId: 'project-1',
          title: 'Quick terminal session',
          status: 'completed',
          githubIssueNumber: null,
          automationId: null,
          kind: 'instant',
        };
      }
      return null;
    });

    (window as typeof window & { shipcode: typeof window.shipcode }).shipcode = {
      invoke: invoke as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };

    useAppStore.setState({
      activeProjectId: 'project-1',
      terminalThreadId: 'thread-instant',
      activeIssue: null,
      githubIssues: [],
      canonicalTerminalStream: {
        'thread-instant': [
          {
            id: 'event-instant-1',
            threadId: 'thread-instant',
            event: { kind: 'text', content: 'instant output' },
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });

    renderWithProviders();

    expect(await screen.findByText('Quick terminal session')).toBeInTheDocument();
    expect(screen.getByText('Session')).toBeInTheDocument();
    expect(screen.getByText('instant output')).toBeInTheDocument();
  });

  it('opens an embedded bare shell from the header button', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'integrations:check') return integrations;
      if (channel === 'instant:bare-shell') return { threadId: 'thread-shell-1' };
      return null;
    });

    (window as typeof window & { shipcode: typeof window.shipcode }).shipcode = {
      invoke: invoke as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };

    useAppStore.setState({
      activeProjectId: 'project-1',
      terminalPaneThreadIds: [],
      terminalPaneMetaByThread: {},
    } as never);

    renderWithProviders();

    fireEvent.click(screen.getByRole('button', { name: 'Open Terminal' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('instant:bare-shell', {
        projectId: 'project-1',
      });
    });

    const state = useAppStore.getState();
    expect(state.terminalPaneThreadIds).toContain('thread-shell-1');
  });

  it('shows a toast when opening an embedded terminal fails', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'integrations:check') return integrations;
      if (channel === 'instant:bare-shell') throw 'spawn denied';
      return null;
    });

    (window as typeof window & { shipcode: typeof window.shipcode }).shipcode = {
      invoke: invoke as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };

    useAppStore.setState({
      activeProjectId: 'project-1',
      terminalPaneThreadIds: [],
      terminalPaneMetaByThread: {},
    } as never);

    renderWithProviders();

    fireEvent.click(screen.getByRole('button', { name: 'Open Terminal' }));

    await waitFor(() => {
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        kind: 'error',
        title: 'Failed to open terminal',
        body: undefined,
      });
    });
  });

  it('includes Error messages when opening an embedded terminal fails', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'integrations:check') return integrations;
      if (channel === 'instant:bare-shell') throw new Error('spawn denied');
      return null;
    });

    (window as typeof window & { shipcode: typeof window.shipcode }).shipcode = {
      invoke: invoke as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };

    useAppStore.setState({
      activeProjectId: 'project-1',
      terminalPaneThreadIds: [],
      terminalPaneMetaByThread: {},
    } as never);

    renderWithProviders();

    fireEvent.click(screen.getByRole('button', { name: 'Open Terminal' }));

    await waitFor(() => {
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        title: 'Failed to open terminal',
        body: 'spawn denied',
      });
    });
  });

  it('runs Auto Fix once while an event is already being fixed', async () => {
    let resolveAutoFix: (() => void) | undefined;
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'integrations:check') return integrations;
      if (channel === 'pipeline:auto-fix') {
        await new Promise<void>((resolve) => {
          resolveAutoFix = resolve;
        });
        return null;
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
        title: 'Auto fix task',
        threadId: 'thread-1',
      }),
      terminalThreadId: 'thread-1',
      githubIssues: [
        makeIssue({
          pipelineStatus: 'failed',
          title: 'Auto fix task',
          threadId: 'thread-1',
        }),
      ],
      canonicalTerminalStream: {
        'thread-1': [
          {
            id: 'error-1',
            threadId: 'thread-1',
            event: { kind: 'raw', content: 'ERROR first failure' },
            createdAt: new Date().toISOString(),
          },
          {
            id: 'error-2',
            threadId: 'thread-1',
            event: { kind: 'raw', content: 'ERROR second failure' },
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });

    renderWithProviders();

    const autoFixButtons = await screen.findAllByRole('button', { name: /auto fix failure/i });
    fireEvent.click(autoFixButtons[0]);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('pipeline:auto-fix', {
        threadId: 'thread-1',
        failureOutput: 'ERROR first failure',
      });
    });

    fireEvent.click(screen.getAllByRole('button', { name: /auto fix failure/i })[1]);

    expect(invoke).toHaveBeenCalledTimes(2);

    resolveAutoFix?.();
  });

  it('shows a toast when Auto Fix fails', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'integrations:check') return integrations;
      if (channel === 'pipeline:auto-fix') throw 'auto fix denied';
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
        title: 'Broken task',
        threadId: 'thread-1',
      }),
      terminalThreadId: 'thread-1',
      githubIssues: [
        makeIssue({
          pipelineStatus: 'failed',
          title: 'Broken task',
          threadId: 'thread-1',
        }),
      ],
      canonicalTerminalStream: {
        'thread-1': [
          {
            id: 'error-1',
            threadId: 'thread-1',
            event: { kind: 'raw', content: 'ERROR needs auto fix' },
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: /auto fix failure/i }));

    await waitFor(() => {
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        kind: 'error',
        title: 'Auto Fix failed',
        body: undefined,
      });
    });
  });

  it('includes Error messages when Auto Fix fails', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'integrations:check') return integrations;
      if (channel === 'pipeline:auto-fix') throw new Error('auto fix denied');
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
        title: 'Broken task',
        threadId: 'thread-1',
      }),
      terminalThreadId: 'thread-1',
      githubIssues: [
        makeIssue({
          pipelineStatus: 'failed',
          title: 'Broken task',
          threadId: 'thread-1',
        }),
      ],
      canonicalTerminalStream: {
        'thread-1': [
          {
            id: 'error-1',
            threadId: 'thread-1',
            event: { kind: 'raw', content: 'ERROR needs auto fix' },
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: /auto fix failure/i }));

    await waitFor(() => {
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        title: 'Auto Fix failed',
        body: 'auto fix denied',
      });
    });
  });

  it('sends a terminal failure to an embedded fix session', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'integrations:check') return integrations;
      if (channel === 'instant:fix-thread-failure') {
        return { threadId: 'thread-fix-1', cli: 'codex', title: 'Fix #1' };
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
        title: 'Broken task',
        threadId: 'thread-1',
      }),
      terminalThreadId: 'thread-1',
      githubIssues: [
        makeIssue({
          pipelineStatus: 'failed',
          title: 'Broken task',
          threadId: 'thread-1',
        }),
      ],
      canonicalTerminalStream: {
        'thread-1': [
          {
            id: 'error-1',
            threadId: 'thread-1',
            event: {
              kind: 'raw',
              content: 'ERROR codex_core::session: failed to record rollout items',
            },
            createdAt: new Date().toISOString(),
          },
        ],
      },
      terminalPaneThreadIds: [],
      terminalPaneMetaByThread: {},
      projectTab: 'issues',
    } as never);

    renderWithProviders();

    fireEvent.click(screen.getByRole('button', { name: /send failure to terminal/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('instant:fix-thread-failure', {
        threadId: 'thread-1',
        failureOutput: 'ERROR codex_core::session: failed to record rollout items',
      });
    });

    const state = useAppStore.getState();
    expect(state.terminalPaneThreadIds).toContain('thread-fix-1');
    expect(state.terminalPaneMetaByThread['thread-fix-1']).toMatchObject({
      mode: 'replay',
      cli: 'codex',
      title: 'Fix #1',
      state: 'running',
    });
    expect(state.projectTab).toBe('terminal');
  });

  it('ignores send-to-terminal clicks while another failure is being sent', async () => {
    let resolveSend:
      | ((value: { threadId: string; cli: 'claude' | 'codex'; title: string }) => void)
      | undefined;
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'integrations:check') return integrations;
      if (channel === 'instant:fix-thread-failure') {
        return await new Promise<{ threadId: string; cli: 'claude' | 'codex'; title: string }>(
          (resolve) => {
            resolveSend = resolve;
          },
        );
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
        title: 'Broken task',
        threadId: 'thread-1',
      }),
      terminalThreadId: 'thread-1',
      githubIssues: [
        makeIssue({
          pipelineStatus: 'failed',
          title: 'Broken task',
          threadId: 'thread-1',
        }),
      ],
      canonicalTerminalStream: {
        'thread-1': [
          {
            id: 'error-1',
            threadId: 'thread-1',
            event: { kind: 'raw', content: 'ERROR first send' },
            createdAt: new Date().toISOString(),
          },
          {
            id: 'error-2',
            threadId: 'thread-1',
            event: { kind: 'raw', content: 'ERROR second send' },
            createdAt: new Date().toISOString(),
          },
        ],
      },
      terminalPaneThreadIds: [],
      terminalPaneMetaByThread: {},
      projectTab: 'issues',
    } as never);

    renderWithProviders();

    const sendButtons = await screen.findAllByRole('button', { name: /send failure to terminal/i });
    fireEvent.click(sendButtons[0]);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('instant:fix-thread-failure', {
        threadId: 'thread-1',
        failureOutput: 'ERROR first send',
      });
    });

    fireEvent.click(screen.getAllByRole('button', { name: /send failure to terminal/i })[1]);

    expect(invoke).toHaveBeenCalledTimes(2);

    resolveSend?.({ threadId: 'thread-fix-guard', cli: 'claude', title: 'Fix guard' });
  });

  it('shows a toast when sending a failure to terminal fails', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'integrations:check') return integrations;
      if (channel === 'instant:fix-thread-failure') throw 'fix session denied';
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
        title: 'Broken task',
        threadId: 'thread-1',
      }),
      terminalThreadId: 'thread-1',
      githubIssues: [
        makeIssue({
          pipelineStatus: 'failed',
          title: 'Broken task',
          threadId: 'thread-1',
        }),
      ],
      canonicalTerminalStream: {
        'thread-1': [
          {
            id: 'error-1',
            threadId: 'thread-1',
            event: { kind: 'raw', content: 'ERROR cannot send' },
            createdAt: new Date().toISOString(),
          },
        ],
      },
      terminalPaneThreadIds: [],
      terminalPaneMetaByThread: {},
    } as never);

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: /send failure to terminal/i }));

    await waitFor(() => {
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        kind: 'error',
        title: 'Failed to send to terminal',
        body: undefined,
      });
    });
  });

  it('includes Error messages when sending a failure to terminal fails', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'integrations:check') return integrations;
      if (channel === 'instant:fix-thread-failure') throw new Error('fix session denied');
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
        title: 'Broken task',
        threadId: 'thread-1',
      }),
      terminalThreadId: 'thread-1',
      githubIssues: [
        makeIssue({
          pipelineStatus: 'failed',
          title: 'Broken task',
          threadId: 'thread-1',
        }),
      ],
      canonicalTerminalStream: {
        'thread-1': [
          {
            id: 'error-1',
            threadId: 'thread-1',
            event: { kind: 'raw', content: 'ERROR cannot send' },
            createdAt: new Date().toISOString(),
          },
        ],
      },
      terminalPaneThreadIds: [],
      terminalPaneMetaByThread: {},
    } as never);

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: /send failure to terminal/i }));

    await waitFor(() => {
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        title: 'Failed to send to terminal',
        body: 'fix session denied',
      });
    });
  });

  it('uses the full-size button as a resizable height preset', () => {
    useAppStore.setState({
      activeProjectId: 'project-1',
      terminalThreadId: 'thread-1',
      githubIssues: [makeIssue()],
    });

    renderWithProviders();

    expect(screen.getByLabelText('Resize terminal drawer')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Maximize terminal' }));

    const resizeHandle = screen.getByLabelText('Resize terminal drawer');
    expect(resizeHandle).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Minimize terminal to window' })).toBeInTheDocument();
    expect(resizeHandle.parentElement).toHaveStyle({ height: '9999px' });
    expect(useAppStore.getState().terminalMaximized).toBe(false);

    fireEvent.mouseDown(resizeHandle, { clientY: 500 });
    fireEvent.mouseMove(window, { clientY: 520 });
    fireEvent.mouseUp(window);

    expect(resizeHandle.parentElement).toHaveStyle({ height: '9979px' });
  });

  it('resets a resized or maximized terminal back to the default drawer size', () => {
    useAppStore.setState({
      activeProjectId: 'project-1',
      terminalThreadId: 'thread-1',
      githubIssues: [makeIssue()],
    });

    renderWithProviders();

    const resizeHandle = screen.getByLabelText('Resize terminal drawer');
    const drawer = resizeHandle.parentElement;
    expect(drawer).toHaveStyle({ height: '250px' });

    fireEvent.mouseDown(resizeHandle, { clientY: 500 });
    fireEvent.mouseMove(window, { clientY: 400 });
    fireEvent.mouseUp(window);

    expect(drawer).toHaveStyle({ height: '350px' });

    fireEvent.click(screen.getByRole('button', { name: 'Reset terminal size' }));

    expect(useAppStore.getState().terminalMaximized).toBe(false);
    expect(screen.getByLabelText('Resize terminal drawer')).toBeInTheDocument();
    expect(drawer).toHaveStyle({ height: '250px' });

    fireEvent.click(screen.getByRole('button', { name: 'Maximize terminal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset terminal size' }));

    expect(useAppStore.getState().terminalMaximized).toBe(false);
    expect(screen.getByLabelText('Resize terminal drawer').parentElement).toHaveStyle({
      height: '250px',
    });
  });

  it('uses the minimize button as a one-line resizable height preset', () => {
    useAppStore.setState({
      activeProjectId: 'project-1',
      terminalThreadId: 'thread-1',
      githubIssues: [makeIssue()],
    });

    renderWithProviders();

    const resizeHandle = screen.getByLabelText('Resize terminal drawer');
    const drawer = resizeHandle.parentElement;
    expect(drawer).toHaveStyle({ height: '250px' });

    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal to one line' }));

    expect(screen.getByText('Console')).toBeInTheDocument();
    expect(screen.getByLabelText('Resize terminal drawer')).toBeInTheDocument();
    expect(screen.getByText(/Thinking/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore terminal drawer' })).toBeInTheDocument();
    expect(drawer).toHaveStyle({ height: '42px' });

    fireEvent.mouseDown(resizeHandle, { clientY: 500 });
    fireEvent.mouseMove(window, { clientY: 300 });
    fireEvent.mouseUp(window);

    expect(drawer).toHaveStyle({ height: '242px' });

    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal to one line' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore terminal drawer' }));

    expect(screen.getByLabelText('Resize terminal drawer')).toBeInTheDocument();
    expect(drawer).toHaveStyle({ height: '250px' });
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
        pipelineStatus: 'approval',
        title: 'Approved slot waiter',
        threadId: 'thread-1',
      }),
      terminalThreadId: 'thread-1',
      pipelinePhase: 'approval',
      githubIssues: [
        makeIssue({
          pipelineStatus: 'approval',
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
