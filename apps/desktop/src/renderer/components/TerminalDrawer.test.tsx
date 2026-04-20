import type { GitHubIssueCacheRecord } from '@shipcode/shared';
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

const fitSpy = vi.fn();

vi.mock('@xterm/xterm', () => ({
  Terminal: class MockTerminal {
    options: Record<string, unknown> = {};
    rows = 24;
    loadAddon() {}
    open() {}
    write() {}
    reset() {}
    refresh() {}
    dispose() {}
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class MockFitAddon {
    fit() {
      fitSpy();
    }
  },
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class MockWebLinksAddon {},
}));

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
  linkedPrNumber: null,
  linkedPrUrl: null,
  linkedPrIsDraft: false,
  ciBlocked: false,
  failingChecks: [],
  unresolvedReviewComments: [],
  unresolvedReviewCommentCount: 0,
  prLastSyncAt: null,
  fetchedAt: new Date().toISOString(),
  ...overrides,
});

describe('TerminalDrawer', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    fitSpy.mockClear();
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
        if (channel === 'integrations:check') return Promise.resolve(undefined);
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
    expect(fitSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
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
});
