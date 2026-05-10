// @vitest-environment jsdom

import type { Project, SystemHealth } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import log from 'electron-log/renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { HealthBanner } from './HealthBanner';
import { ProjectMissingView } from './ProjectMissingView';
import { ProjectPathBanner } from './ProjectPathBanner';

vi.mock('electron-log/renderer', () => ({
  default: {
    error: vi.fn(),
  },
}));

const baseHealth: SystemHealth = {
  claude: {
    available: true,
    authenticated: true,
    version: '1.0.0',
    path: '/usr/local/bin/claude',
    error: null,
  },
  codex: {
    available: true,
    authenticated: true,
    version: '1.0.0',
    path: '/usr/local/bin/codex',
    error: null,
  },
  git: {
    available: true,
    authenticated: false,
    version: '2.0.0',
    path: '/usr/bin/git',
    error: null,
  },
  gh: {
    available: true,
    authenticated: false,
    version: '2.0.0',
    path: '/usr/local/bin/gh',
    error: null,
  },
};

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'ShipCode',
    path: '/tmp/shipcode',
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderWithClient(element: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
}

describe('system shell components', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    window.shipcode.invoke = vi.fn(async (channel: string, args?: Record<string, unknown>) => {
      if (channel === 'health:check') return baseHealth;
      if (channel === 'onboarding:check-auth') {
        return {
          ...baseHealth,
          ghAuth: {
            installed: true,
            authenticated: true,
            username: 'decod3rs',
            version: '2.0.0',
            error: null,
            hasProjectScope: false,
          },
        };
      }
      if (channel === 'settings:set') return undefined;
      if (channel === 'dialog:open-directory') return '/tmp/relinked';
      if (channel === 'project:relink-path') {
        return makeProject({ id: String(args?.projectId ?? 'project-1'), path: '/tmp/relinked' });
      }
      if (channel === 'github:refresh-issues') return undefined;
      return null;
    }) as typeof window.shipcode.invoke;

    useAppStore.setState({
      activeProjectId: null,
      activeThreadId: null,
      activeIssue: null,
      viewMode: 'overview',
      sidebarCollapsed: false,
      terminalVisible: false,
      terminalMaximized: false,
      settingsVisible: false,
      settingsSection: 'general',
      currentPlan: null,
      currentReview: null,
      pipelinePhase: 'idle',
      systemHealth: null,
      currentVerification: null,
      githubIssues: [],
      agentOutputs: {},
      processToThread: {},
      terminalEvents: [],
      terminalThreadId: null,
      terminalEventsByThread: {},
      lastActivityByThread: {},
      currentModels: {},
      canonicalTerminalStream: {},
      notifications: [],
      commandPaletteOpen: false,
      createIssueModalOpen: false,
      editingPrd: null,
      projectSettingsModalOpen: false,
      projectSettingsModalProjectId: null,
      projectSettingsModalInitialTab: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('surfaces missing health issues and can reset onboarding', async () => {
    const degradedHealth: SystemHealth = {
      ...baseHealth,
      claude: {
        available: false,
        authenticated: false,
        version: null,
        path: null,
        error: 'Claude CLI not found',
      },
      codex: {
        available: true,
        authenticated: false,
        version: '1.0.0',
        path: '/usr/local/bin/codex',
        error: null,
      },
      git: {
        available: false,
        authenticated: false,
        version: null,
        path: null,
        error: 'git not found',
      },
    };

    window.shipcode.invoke = vi.fn(async (channel: string) => {
      if (channel === 'health:check') return degradedHealth;
      if (channel === 'onboarding:check-auth') {
        return {
          ...degradedHealth,
          ghAuth: {
            installed: true,
            authenticated: true,
            username: 'decod3rs',
            version: '2.0.0',
            error: null,
            hasProjectScope: false,
          },
        };
      }
      if (channel === 'settings:set') return undefined;
      return null;
    }) as typeof window.shipcode.invoke;

    renderWithClient(<HealthBanner />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Claude CLI not found');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Re-run Setup' }));

    await waitFor(() => {
      expect(window.shipcode.invoke).toHaveBeenCalledWith('settings:set', { onboardingVersion: 0 });
    });
  });

  it('shows the missing-path warning banner only when the project path is gone', () => {
    const project = makeProject({ pathExists: false, path: '/tmp/missing-project' });

    const shown = renderWithClient(<ProjectPathBanner project={project} />);
    expect(shown.getByRole('alert').textContent).toContain(
      'points to a folder that no longer exists',
    );
    expect(shown.getByRole('alert').textContent).toContain('/tmp/missing-project');
    shown.unmount();

    useAppStore.setState({ settingsVisible: true });
    const hidden = renderWithClient(<ProjectPathBanner project={project} />);
    expect(hidden.container.textContent).toBe('');
  });

  it('relinks a missing project and opens project settings from the fallback view', async () => {
    const project = makeProject({ path: '/tmp/missing-project' });
    const openProjectSettingsModalMock = vi.fn();
    useAppStore.setState({ openProjectSettingsModal: openProjectSettingsModalMock });

    renderWithClient(<ProjectMissingView project={project} />);

    fireEvent.click(screen.getByRole('button', { name: 'Locate moved folder' }));

    await waitFor(() => {
      expect(window.shipcode.invoke).toHaveBeenCalledWith('dialog:open-directory');
      expect(window.shipcode.invoke).toHaveBeenCalledWith('project:relink-path', {
        projectId: project.id,
        path: '/tmp/relinked',
      });
      expect(window.shipcode.invoke).toHaveBeenCalledWith('github:refresh-issues', {
        projectId: project.id,
        force: true,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Project settings' }));
    expect(openProjectSettingsModalMock).toHaveBeenCalledWith(project.id);
  });

  it('keeps relink success when refreshing issues after relink fails', async () => {
    const project = makeProject({ path: '/tmp/missing-project' });
    vi.mocked(window.shipcode.invoke).mockImplementation(
      async (channel: string, args?: Record<string, unknown>) => {
        if (channel === 'dialog:open-directory') return '/tmp/relinked';
        if (channel === 'project:relink-path') {
          return makeProject({ id: String(args?.projectId ?? project.id), path: '/tmp/relinked' });
        }
        if (channel === 'github:refresh-issues') throw new Error('refresh failed');
        return undefined;
      },
    );

    renderWithClient(<ProjectMissingView project={project} />);

    fireEvent.click(screen.getByRole('button', { name: 'Locate moved folder' }));

    await waitFor(() => {
      expect(window.shipcode.invoke).toHaveBeenCalledWith('github:refresh-issues', {
        projectId: project.id,
        force: true,
      });
    });
    expect(log.error).not.toHaveBeenCalledWith(
      '[ProjectMissingView] relink failed',
      expect.any(Error),
    );
  });

  it('does not relink when folder selection is cancelled', async () => {
    vi.mocked(window.shipcode.invoke).mockImplementation(async (channel: string) => {
      if (channel === 'dialog:open-directory') return null;
      return undefined;
    });

    renderWithClient(
      <ProjectMissingView project={makeProject({ path: '/tmp/missing-project' })} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Locate moved folder' }));

    await waitFor(() => {
      expect(window.shipcode.invoke).toHaveBeenCalledWith('dialog:open-directory');
    });
    expect(window.shipcode.invoke).not.toHaveBeenCalledWith(
      'project:relink-path',
      expect.anything(),
    );
  });

  it('logs relink failures from the fallback view', async () => {
    const failure = new Error('permission denied');
    vi.mocked(window.shipcode.invoke).mockImplementation(async (channel: string) => {
      if (channel === 'dialog:open-directory') return '/tmp/relinked';
      if (channel === 'project:relink-path') throw failure;
      return undefined;
    });

    renderWithClient(
      <ProjectMissingView project={makeProject({ path: '/tmp/missing-project' })} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Locate moved folder' }));

    await waitFor(() => {
      expect(log.error).toHaveBeenCalledWith('[ProjectMissingView] relink failed', failure);
    });
  });
});
