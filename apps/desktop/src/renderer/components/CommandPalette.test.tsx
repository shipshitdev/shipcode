// @vitest-environment jsdom

import {
  type GitHubIssueCacheRecord,
  ISSUE_PIPELINE_STATUS,
  type PlanRecord,
  type Project,
} from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { CommandPalette } from './CommandPalette';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'ShipCode',
    path: '/repo/shipcode',
    pathExists: true,
    gitRemote: 'git@github.com:shipshitdev/shipcode.git',
    githubRepoId: null,
    githubRepoFullName: null,
    starterIssueNumber: null,
    starterIssueCreatedAt: null,
    githubProjectUrl: null,
    githubStatusMapping: null,
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
    discordRouting: 'inherit',
    discordWebhookUrlOverride: null,
    telegramRouting: 'inherit',
    telegramChatIdOverride: null,
    defaultBranch: 'main',
    pinned: false,
    archived: false,
    hidden: false,
    notifyGithubUser: null,
    createdAt: '2026-05-09T00:00:00.000Z',
    updatedAt: '2026-05-09T00:00:00.000Z',
    ...overrides,
  };
}

function makeIssue(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 42,
    title: 'Cover command palette',
    body: '',
    url: 'https://github.com/shipshitdev/shipcode/issues/42',
    state: 'open',
    labels: [],
    assignees: [],
    author: 'decod3rs',
    milestone: null,
    pipelineStatus: ISSUE_PIPELINE_STATUS.idle,
    threadId: 'thread-42',
    createdAt: '2026-05-09T00:00:00.000Z',
    updatedAt: '2026-05-09T00:00:00.000Z',
    ...overrides,
  };
}

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <CommandPalette />
    </QueryClientProvider>,
  );
}

describe('CommandPalette', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true);
    class MockResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: MockResizeObserver,
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    window.shipcode.on = vi.fn(() => () => {}) as unknown as typeof window.shipcode.on;

    useAppStore.setState({
      commandPaletteOpen: true,
      activeProjectId: 'project-1',
      activeThreadId: 'thread-1',
      pipelinePhase: 'approval',
      activeIssue: null,
      githubIssues: [],
    } as never);
  });

  afterEach(() => {
    cleanup();
    if (originalResizeObserver) {
      Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        writable: true,
        value: originalResizeObserver,
      });
    } else {
      Reflect.deleteProperty(globalThis, 'ResizeObserver');
    }
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        writable: true,
        value: originalScrollIntoView,
      });
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  });

  it('replaces approval actions with waiting-for-slot state after approval', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:list-visible') return [];
      if (channel === 'plan:list') {
        return [
          {
            id: 'plan-1',
            threadId: 'thread-1',
            version: 1,
            rawOutput: '',
            structured: null,
            status: 'approved',
            createdAt: new Date().toISOString(),
          },
        ] satisfies PlanRecord[];
      }
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Waiting for execution slot')).toBeInTheDocument();
    expect(screen.queryByText('Approve Plan')).not.toBeInTheDocument();
    expect(screen.queryByText('Reject Plan')).not.toBeInTheDocument();
  });

  it('keeps approval actions visible while the plan still needs a decision', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:list-visible') return [];
      if (channel === 'plan:list') {
        return [
          {
            id: 'plan-1',
            threadId: 'thread-1',
            version: 1,
            rawOutput: '',
            structured: null,
            status: 'approval',
            createdAt: new Date().toISOString(),
          },
        ] satisfies PlanRecord[];
      }
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Approve Plan')).toBeInTheDocument();
    expect(screen.getByText('Reject Plan')).toBeInTheDocument();
    expect(screen.queryByText('Waiting for execution slot')).not.toBeInTheDocument();
  });

  it('does not mount command content while the palette is closed', () => {
    useAppStore.setState({ commandPaletteOpen: false });
    renderWithProviders();

    expect(screen.queryByPlaceholderText('Search issues, commands...')).not.toBeInTheDocument();
  });

  it('navigates to cross-project issue results', async () => {
    const navigateToIssue = vi.fn();
    const project = makeProject({ id: 'project-2', name: 'Docs' });
    const issue = makeIssue({ id: 'issue-77', projectId: 'project-2', issueNumber: 77 });
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:list-visible') return [project];
      if (channel === 'github:list-issues') return [issue];
      if (channel === 'plan:list') return [];
      return null;
    });
    useAppStore.setState({ navigateToIssue } as never);

    renderWithProviders();

    fireEvent.click(await screen.findByText('Cover command palette'));

    await waitFor(() => {
      expect(navigateToIssue).toHaveBeenCalledWith('project-2', issue);
    });
    expect(useAppStore.getState().commandPaletteOpen).toBe(false);
  });

  it('runs GitHub refresh, pipeline, navigation, workspace, and git actions', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:list-visible') return [];
      if (channel === 'plan:list') return [];
      return null;
    });

    renderWithProviders();

    fireEvent.click(await screen.findByText('New Issue…'));
    expect(useAppStore.getState().createIssueModalOpen).toBe(true);

    useAppStore.setState({ commandPaletteOpen: true });
    fireEvent.click(await screen.findByText('Refresh Issues'));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:refresh-issues', {
        projectId: 'project-1',
        force: true,
      });
    });

    useAppStore.setState({ commandPaletteOpen: true, pipelinePhase: 'idle' });
    fireEvent.click(await screen.findByText('Start Pipeline'));
    expect(invokeMock).toHaveBeenCalledWith('pipeline:start', { threadId: 'thread-1' });

    useAppStore.setState({ commandPaletteOpen: true, pipelinePhase: 'approval' });
    fireEvent.click(await screen.findByText('Approve Plan'));
    expect(invokeMock).toHaveBeenCalledWith('pipeline:approve', { threadId: 'thread-1' });

    useAppStore.setState({ commandPaletteOpen: true, pipelinePhase: 'approval' });
    fireEvent.click(await screen.findByText('Reject Plan'));
    expect(invokeMock).toHaveBeenCalledWith('pipeline:reject', {
      threadId: 'thread-1',
      feedback: '',
    });

    useAppStore.setState({ commandPaletteOpen: true });
    fireEvent.click(await screen.findByText('Cancel Pipeline'));
    expect(invokeMock).toHaveBeenCalledWith('pipeline:cancel', { threadId: 'thread-1' });

    useAppStore.setState({ commandPaletteOpen: true });
    fireEvent.click(await screen.findByText('Open Terminal'));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('instant:bare-shell', { projectId: 'project-1' });
    });

    useAppStore.setState({ commandPaletteOpen: true });
    fireEvent.click(await screen.findByText('Overview'));
    expect(useAppStore.getState().viewMode).toBe('overview');

    useAppStore.setState({ commandPaletteOpen: true });
    fireEvent.click(await screen.findByText('Inbox'));
    expect(useAppStore.getState().viewMode).toBe('inbox');

    useAppStore.setState({ commandPaletteOpen: true });
    fireEvent.click(await screen.findByText('Activity'));
    expect(useAppStore.getState().viewMode).toBe('activity');

    useAppStore.setState({ commandPaletteOpen: true });
    fireEvent.click(await screen.findByText('Costs'));
    expect(useAppStore.getState().viewMode).toBe('costs');

    useAppStore.setState({ commandPaletteOpen: true });
    fireEvent.click(await screen.findByText('Skills'));
    expect(useAppStore.getState().viewMode).toBe('skills');

    useAppStore.setState({ commandPaletteOpen: true });
    fireEvent.click(await screen.findByText('Copilot'));
    expect(useAppStore.getState().assistantVisible).toBe(true);

    useAppStore.setState({ commandPaletteOpen: true });
    fireEvent.click(await screen.findByText('Terminal'));
    expect(useAppStore.getState().projectTab).toBe('terminal');

    useAppStore.setState({ commandPaletteOpen: true });
    fireEvent.click(await screen.findByText('Pull Requests'));
    expect(useAppStore.getState().projectTab).toBe('pull-requests');

    useAppStore.setState({ commandPaletteOpen: true });
    fireEvent.click(await screen.findByText('Settings'));
    expect(useAppStore.getState().settingsVisible).toBe(true);

    useAppStore.setState({ commandPaletteOpen: true });
    fireEvent.click(await screen.findByText('Add Repository…'));
    expect(useAppStore.getState().addProjectExplorerOpen).toBe(true);

    useAppStore.setState({ commandPaletteOpen: true, activeIssue: null });
    fireEvent.click(await screen.findByText('Toggle Sidebar'));
    expect(useAppStore.getState().sidebarCollapsed).toBe(true);

    useAppStore.setState({ commandPaletteOpen: true, activeIssue: makeIssue() });
    fireEvent.click(await screen.findByText('Close Issue'));
    expect(useAppStore.getState().activeIssue).toBeNull();

    useAppStore.setState({ commandPaletteOpen: true });
    fireEvent.click(await screen.findByText('Toggle Terminal'));
    expect(useAppStore.getState().terminalVisible).toBe(true);

    useAppStore.setState({ commandPaletteOpen: true });
    fireEvent.click(await screen.findByText('Commit Changes'));
    expect(invokeMock).toHaveBeenCalledWith('git:commit', {
      projectId: 'project-1',
      message: '',
    });

    useAppStore.setState({ commandPaletteOpen: true });
    fireEvent.click(await screen.findByText('Push to Remote'));
    expect(invokeMock).toHaveBeenCalledWith('git:push', { projectId: 'project-1' });
  });
});
