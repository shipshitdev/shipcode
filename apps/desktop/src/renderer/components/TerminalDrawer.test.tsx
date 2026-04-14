import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { TerminalDrawer } from './TerminalDrawer';

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
    fit() {}
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
  beforeEach(() => {
    class MockResizeObserver {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    (window as typeof window & { shipcode: typeof window.shipcode }).shipcode = {
      invoke: vi.fn() as unknown as typeof window.shipcode.invoke,
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
    vi.unstubAllGlobals();
  });

  it('shows an empty state when the visible terminal thread belongs to another project', () => {
    useAppStore.setState({
      activeProjectId: 'project-2',
      terminalThreadId: 'thread-1',
      canonicalTerminalStream: {
        'thread-1': [{ kind: 'text', content: 'foreign output' }],
      },
      currentModels: { 'thread-1': 'gpt-5.4' },
    });

    render(<TerminalDrawer />);

    expect(screen.getByText('No issue selected for this project')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Terminal output will appear when you select or start an issue in this project.',
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

    render(<TerminalDrawer />);

    expect(screen.getByText('Current project task')).toBeInTheDocument();
    expect(screen.queryByText('Foreign project task')).not.toBeInTheDocument();
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

    render(<TerminalDrawer />);

    fireEvent.pointerDown(screen.getByRole('button', { name: /Current project task/i }));

    expect(await screen.findByText('Second project task')).toBeInTheDocument();
    expect(screen.queryByText('Foreign project task')).not.toBeInTheDocument();
  });
});
