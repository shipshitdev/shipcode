// @vitest-environment jsdom

import type { Project } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../stores/app-store';
import { AddProjectExplorer } from '../AddProjectExplorer';

const project: Project = {
  id: 'project-1',
  name: 'Repo One',
  path: '/Users/vincent/repo-one',
  pathExists: true,
  setupStatus: 'configured',
  setupError: null,
  gitRemote: 'git@github.com:shipshit/repo-one.git',
  githubRepoId: 'repo-1',
  githubRepoFullName: 'shipshit/repo-one',
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
  requireApprovalOverride: null,
  pipelineSpeedProfileOverride: null,
  prdQualityGate: null,
  discordRouting: 'inherit',
  discordWebhookUrlOverride: null,
  telegramRouting: 'inherit',
  telegramChatIdOverride: null,
  defaultBranch: 'main',
  pinned: false,
  archived: false,
  hidden: false,
  notifyGithubUser: null,
  createdAt: '2026-05-08T00:00:00.000Z',
  updatedAt: '2026-05-08T00:00:00.000Z',
};

function renderExplorer() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AddProjectExplorer />
    </QueryClientProvider>,
  );
}

describe('AddProjectExplorer', () => {
  const invoke =
    vi.fn<(channel: string, args?: { dirPath?: string; path?: string }) => Promise<unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    window.shipcode = {
      invoke: invoke as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };
    invoke.mockImplementation(async (channel, args) => {
      if (channel === 'fs:resolve-start-dir') return { resolvedPath: '/Users/vincent' };
      if (channel === 'fs:list-directories') {
        if (args?.dirPath === '/Users/vincent') {
          return {
            entries: [{ name: 'repo-one', absolutePath: '/Users/vincent/repo-one' }],
            error: null,
          };
        }
        if (args?.dirPath === '/missing') return { entries: [], error: 'not-found' };
        if (args?.dirPath === '/private') return { entries: [], error: 'permission-denied' };
        return { entries: [], error: null };
      }
      if (channel === 'project:add') return project;
      if (channel === 'github:refresh-issues') return undefined;
      return null;
    });
    useAppStore.setState({
      addProjectExplorerOpen: true,
      activeProjectId: null,
      projectSettingsModalOpen: false,
      projectSettingsModalProjectId: null,
      projectSettingsModalInitialTab: null,
    } as never);
  });

  afterEach(() => {
    cleanup();
  });

  it('initializes from the resolved start directory and navigates into an empty child directory', async () => {
    renderExplorer();

    await screen.findByText('repo-one');
    expect(screen.getByDisplayValue('/Users/vincent')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /repo-one/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('fs:list-directories', {
        dirPath: '/Users/vincent/repo-one',
      });
    });
    expect(await screen.findByText('No folders here')).toBeInTheDocument();
  });

  it('renders directory listing errors from the start directory query', async () => {
    invoke.mockImplementation(async (channel) => {
      if (channel === 'fs:resolve-start-dir') return { resolvedPath: '/missing' };
      if (channel === 'fs:list-directories') return { entries: [], error: 'not-found' };
      return null;
    });

    const { unmount } = renderExplorer();

    expect(await screen.findByText('Directory not found')).toBeInTheDocument();
    unmount();
    cleanup();

    invoke.mockImplementation(async (channel) => {
      if (channel === 'fs:resolve-start-dir') return { resolvedPath: '/private' };
      if (channel === 'fs:list-directories') return { entries: [], error: 'permission-denied' };
      return null;
    });
    useAppStore.setState({ addProjectExplorerOpen: true } as never);
    renderExplorer();
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
  });

  it('adds the current directory, closes the explorer, selects the project, opens setup, and refreshes issues', async () => {
    renderExplorer();

    await screen.findByText('repo-one');
    const addButtons = screen.getAllByRole('button', { name: 'Add Repository' });
    fireEvent.click(addButtons[addButtons.length - 1]);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('project:add', { path: '/Users/vincent' });
    });
    expect(useAppStore.getState().addProjectExplorerOpen).toBe(false);
    expect(useAppStore.getState().activeProjectId).toBe('project-1');
    expect(useAppStore.getState().projectSettingsModalProjectId).toBe('project-1');
    expect(useAppStore.getState().projectSettingsModalInitialTab).toBe('setup');
    expect(invoke).toHaveBeenCalledWith('github:refresh-issues', {
      projectId: 'project-1',
      force: true,
    });
  });

  it('keeps the explorer open and shows add errors when project creation fails', async () => {
    invoke.mockImplementation(async (channel, args) => {
      if (channel === 'fs:resolve-start-dir') return { resolvedPath: '/Users/vincent' };
      if (channel === 'fs:list-directories') return { entries: [], error: null };
      if (channel === 'project:add') throw new Error(`Cannot add ${args?.path}`);
      return null;
    });

    renderExplorer();

    expect(await screen.findByDisplayValue('/Users/vincent')).toBeInTheDocument();
    expect(await screen.findByText('No folders here')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Add Repository' }), { key: 'Enter' });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('project:add', { path: '/Users/vincent' });
    });
    expect(await screen.findByText('Cannot add /Users/vincent')).toBeInTheDocument();
    expect(useAppStore.getState().addProjectExplorerOpen).toBe(true);
  });
});
