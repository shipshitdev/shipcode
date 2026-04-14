import {
  type DashboardStats,
  DEFAULT_SETTINGS,
  type IntegrationStatus,
  type NotificationRecord,
  type Project,
} from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { ProjectSidebar } from './ProjectSidebar';

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
      <ProjectSidebar />
    </QueryClientProvider>,
  );
}

const project: Project = {
  id: 'project-1',
  name: 'ShipCode',
  path: '/tmp/shipcode',
  pathExists: true,
  gitRemote: 'git@github.com:shipshitdev/shipcode.git',
  githubProjectUrl: null,
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
  defaultBranch: 'main',
  pinned: false,
  archived: false,
  createdAt: '2026-04-14T00:00:00.000Z',
  updatedAt: '2026-04-14T00:00:00.000Z',
};

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
      version: 'codex 0.1.0',
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
    username: 'decod3r',
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

describe('ProjectSidebar', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    cleanup();
    invokeMock.mockReset();
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    window.shipcode.on = vi.fn(() => () => {}) as typeof window.shipcode.on;

    useAppStore.setState({
      activeProjectId: project.id,
      viewMode: 'project',
      settingsVisible: false,
      sidebarCollapsed: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('opens the project folder with the default target from the dedicated sidebar action', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'projects-visible' || channel === 'project:list-visible') return [project];
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'dashboard:get-stats')
        return {
          agentsRunning: 0,
          agentsRunningByProject: {},
          inboxCount: 0,
        } satisfies Partial<DashboardStats>;
      if (channel === 'notification:list') return [] satisfies NotificationRecord[];
      if (channel === 'integrations:check') return integrations;
      if (channel === 'project:open-path') return undefined;
      return [];
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Open ShipCode folder' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('project:open-path', {
        projectId: project.id,
        target: 'default',
      });
    });
  });

  it('shows explicit opener targets in the project actions menu', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'projects-visible' || channel === 'project:list-visible') return [project];
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'dashboard:get-stats')
        return {
          agentsRunning: 0,
          agentsRunningByProject: {},
          inboxCount: 0,
        } satisfies Partial<DashboardStats>;
      if (channel === 'notification:list') return [] satisfies NotificationRecord[];
      if (channel === 'integrations:check') return integrations;
      return [];
    });

    renderWithProviders();

    fireEvent.pointerDown(await screen.findByRole('button', { name: 'More actions for ShipCode' }));

    expect(await screen.findByText('Open in Cursor')).toBeInTheDocument();
    expect(screen.getByText('Open in Finder')).toBeInTheDocument();
    expect(screen.getByText('Open in Terminal')).toBeInTheDocument();
    expect(screen.getByText('Open in Ghostty')).toBeInTheDocument();
    expect(screen.getByText('Open in Visual Studio Code')).toBeInTheDocument();
  });
});
