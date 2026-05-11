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

  it('still closes after adding when the issue refresh fails', async () => {
    invoke.mockImplementation(async (channel, args) => {
      if (channel === 'fs:resolve-start-dir') return { resolvedPath: '/Users/vincent' };
      if (channel === 'fs:list-directories') return { entries: [], error: null };
      if (channel === 'project:add') return project;
      if (channel === 'github:refresh-issues')
        throw new Error(`Refresh failed ${(args as { projectId?: string })?.projectId}`);
      return null;
    });

    renderExplorer();

    expect(await screen.findByDisplayValue('/Users/vincent')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Repository' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('github:refresh-issues', {
        projectId: 'project-1',
        force: true,
      });
    });
    expect(useAppStore.getState().addProjectExplorerOpen).toBe(false);
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

  it('disables parent navigation at the filesystem root', async () => {
    invoke.mockImplementation(async (channel) => {
      if (channel === 'fs:resolve-start-dir') return { resolvedPath: '/' };
      if (channel === 'fs:list-directories') return { entries: [], error: null };
      return null;
    });

    renderExplorer();

    expect(await screen.findByDisplayValue('/')).toBeInTheDocument();
    expect(screen.getByTitle('Go up (Backspace)')).toBeDisabled();
  });

  it('navigates single-segment paths up to the filesystem root', async () => {
    invoke.mockImplementation(async (channel, args) => {
      if (channel === 'fs:resolve-start-dir') return { resolvedPath: '/Users' };
      if (channel === 'fs:list-directories') {
        if (args?.dirPath === '/Users') return { entries: [], error: null };
        if (args?.dirPath === '/') return { entries: [], error: null };
      }
      return null;
    });

    renderExplorer();

    expect(await screen.findByDisplayValue('/Users')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Go up (Backspace)'));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('fs:list-directories', { dirPath: '/' });
    });
    expect(screen.getByDisplayValue('/')).toBeInTheDocument();
  });

  it('submits edited paths and keeps Backspace scoped to the path input', async () => {
    renderExplorer();

    const pathInput = await screen.findByDisplayValue('/Users/vincent');
    fireEvent.focus(pathInput);
    fireEvent.change(pathInput, { target: { value: '/private' } });
    fireEvent.keyDown(pathInput, { key: 'Backspace' });
    expect(invoke).not.toHaveBeenCalledWith('fs:list-directories', { dirPath: '/Users' });

    fireEvent.keyDown(pathInput, { key: 'Enter' });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('fs:list-directories', { dirPath: '/private' });
    });
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    fireEvent.blur(pathInput);
  });

  it('blurs edited paths back to cwd and ignores empty or same-path submissions', async () => {
    renderExplorer();

    const pathInput = await screen.findByDisplayValue('/Users/vincent');
    fireEvent.focus(pathInput);
    fireEvent.change(pathInput, { target: { value: '   ' } });
    fireEvent.keyDown(pathInput, { key: 'Enter' });
    expect(screen.getByDisplayValue('/Users/vincent')).toBeInTheDocument();

    fireEvent.focus(pathInput);
    fireEvent.change(pathInput, { target: { value: '/Users/vincent' } });
    fireEvent.keyDown(pathInput, { key: 'Enter' });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('fs:list-directories', { dirPath: '/Users/vincent' });
    });
    expect(
      invoke.mock.calls.filter(
        ([channel, args]) =>
          channel === 'fs:list-directories' && args?.dirPath === '/Users/vincent',
      ),
    ).toHaveLength(1);
  });

  it('supports keyboard directory selection and Backspace parent navigation', async () => {
    invoke.mockImplementation(async (channel, args) => {
      if (channel === 'fs:resolve-start-dir') return { resolvedPath: '/Users/vincent' };
      if (channel === 'fs:list-directories') {
        if (args?.dirPath === '/Users/vincent') {
          return {
            entries: [
              { name: 'repo-one', absolutePath: '/Users/vincent/repo-one' },
              { name: 'repo-two', absolutePath: '/Users/vincent/repo-two' },
            ],
            error: null,
          };
        }
        return { entries: [], error: null };
      }
      return null;
    });

    renderExplorer();

    const dialog = screen.getByRole('dialog', { name: 'Add Repository' });
    expect(await screen.findByText('repo-one')).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    fireEvent.keyDown(dialog, { key: 'ArrowUp' });
    fireEvent.keyDown(dialog, { key: 'Enter' });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('fs:list-directories', {
        dirPath: '/Users/vincent/repo-one',
      });
    });

    fireEvent.keyDown(dialog, { key: 'Backspace' });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('fs:list-directories', { dirPath: '/Users/vincent' });
    });
  });

  it('keeps keyboard selection bounded and adds when no directory is selected', async () => {
    renderExplorer();

    const dialog = screen.getByRole('dialog', { name: 'Add Repository' });
    expect(await screen.findByText('repo-one')).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: 'z' });
    fireEvent.keyDown(dialog, { key: 'ArrowUp' });
    fireEvent.keyDown(dialog, { key: 'Enter' });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('project:add', { path: '/Users/vincent' });
    });
  });

  it('ignores modal navigation and add shortcuts before the start directory resolves', async () => {
    let resolveStartDir: (value: { resolvedPath: string }) => void = () => {};
    invoke.mockImplementation((channel, args) => {
      if (channel === 'fs:resolve-start-dir') {
        return new Promise((resolve) => {
          resolveStartDir = resolve as (value: { resolvedPath: string }) => void;
        });
      }
      if (channel === 'fs:list-directories' && args?.dirPath === '/Users/vincent') {
        return Promise.resolve({
          entries: [{ name: 'repo-one', absolutePath: '/Users/vincent/repo-one' }],
          error: null,
        });
      }
      return Promise.resolve(null);
    });

    renderExplorer();

    const dialog = screen.getByRole('dialog', { name: 'Add Repository' });
    fireEvent.keyDown(dialog, { key: 'Backspace' });
    fireEvent.keyDown(dialog, { key: 'Enter' });

    expect(invoke).not.toHaveBeenCalledWith('project:add', expect.anything());
    expect(invoke).not.toHaveBeenCalledWith('fs:list-directories', expect.anything());

    resolveStartDir({ resolvedPath: '/Users/vincent' });
    expect(await screen.findByText('repo-one')).toBeInTheDocument();
  });

  it('submits the focused path input from the modal keyboard handler', async () => {
    renderExplorer();

    const pathInput = await screen.findByDisplayValue('/Users/vincent');
    fireEvent.focus(pathInput);
    fireEvent.change(pathInput, { target: { value: '/private' } });
    const activeElementSpy = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(pathInput);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Add Repository' }), { key: 'Enter' });
    activeElementSpy.mockRestore();

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('fs:list-directories', { dirPath: '/private' });
    });
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
  });

  it('does not navigate above empty cwd and resets state when cancelled', async () => {
    useAppStore.setState({ addProjectExplorerOpen: false } as never);
    const { rerender } = renderExplorer();

    expect(screen.queryByRole('dialog', { name: 'Add Repository' })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Backspace' });

    useAppStore.setState({ addProjectExplorerOpen: true } as never);
    rerender(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
          })
        }
      >
        <AddProjectExplorer />
      </QueryClientProvider>,
    );

    expect(await screen.findByDisplayValue('/Users/vincent')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useAppStore.getState().addProjectExplorerOpen).toBe(false);
  });
});
