import {
  DEFAULT_SETTINGS,
  type GitHubIssueCacheRecord,
  type IntegrationStatus,
  type Project,
} from '@shipcode/shared';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { renderWithQueryClient } from '../test/render';
import { SettingsPanel } from './SettingsPanel';

function renderWithProviders() {
  return renderWithQueryClient(<SettingsPanel />);
}

function makeDesktopApps() {
  return {
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
  } as const;
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Archived repo',
    path: '/repo/archived',
    pathExists: true,
    gitRemote: null,
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
    archived: true,
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
    issueNumber: 19,
    title: 'Archived issue',
    body: null,
    labels: [],
    assignee: null,
    state: 'closed',
    pipelineStatus: 'closed',
    threadId: null,
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
    fetchedAt: '2026-05-09T00:00:00.000Z',
    priorityRank: null,
    priorityRaw: null,
    priorityFetchedAt: null,
    isQuickMode: false,
    ...overrides,
  };
}

describe('SettingsPanel', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    cleanup();
    invokeMock.mockReset();
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    window.shipcode.on = vi.fn(() => () => {}) as unknown as typeof window.shipcode.on;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    useAppStore.setState({
      settingsVisible: true,
      settingsSection: 'integrations',
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the integrations section shell', async () => {
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
        enabled: true,
        keyPresent: true,
        authStatus: 'valid',
        message: null,
        label: 'shipcode-dev',
        modelChecks: [
          {
            key: 'default_paid',
            label: 'Default paid model',
            modelId: 'openrouter/auto',
            status: 'valid',
            message: null,
          },
        ],
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
      desktopApps: makeDesktopApps(),
    };

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'integrations:check') return integrations;
      return [];
    });

    renderWithProviders();

    expect(await screen.findByText('Integrations')).toBeInTheDocument();
    expect(screen.getByText('Claude CLI')).toBeInTheDocument();
    expect(screen.getByText('Codex CLI')).toBeInTheDocument();
    expect(screen.getByText('GitHub CLI')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'CLI' })).toBeInTheDocument();
    const apiKeysTab = screen.getByRole('tab', { name: 'API Keys' });
    expect(apiKeysTab).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'IDE' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('integrations:check', { force: true });
    });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'integrations:check') return integrations;
      if (channel === 'integrations:test-chat') return { ok: true, message: 'test sent' };
      return [];
    });
    fireEvent.mouseDown(apiKeysTab, { button: 0 });
    fireEvent.click(apiKeysTab);
    await waitFor(() => {
      expect(apiKeysTab).toHaveAttribute('aria-selected', 'true');
    });
    fireEvent.click(screen.getAllByText('Send test message')[0]);
    expect(await screen.findByText('test sent')).toBeInTheDocument();
  });

  it('renders the pipeline section shell', async () => {
    useAppStore.setState({ settingsSection: 'pipeline' });

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
        enabled: true,
        keyPresent: true,
        authStatus: 'valid',
        message: null,
        label: 'shipcode-dev',
        modelChecks: [
          {
            key: 'planner',
            label: 'Planner model',
            modelId: 'openrouter/auto',
            status: 'valid',
            message: null,
          },
          {
            key: 'reviewer',
            label: 'Reviewer model',
            modelId: 'openrouter/auto',
            status: 'valid',
            message: null,
          },
          {
            key: 'executor',
            label: 'Executor model',
            modelId: 'openrouter/auto',
            status: 'valid',
            message: null,
          },
          {
            key: 'verifier',
            label: 'Verifier model',
            modelId: 'openrouter/auto',
            status: 'valid',
            message: null,
          },
        ],
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
      desktopApps: makeDesktopApps(),
    };

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'integrations:check') return integrations;
      return [];
    });

    renderWithProviders();

    expect(await screen.findByText('Pipeline')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Runtime' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Models' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Testing' })).toBeInTheDocument();
    expect(screen.getByText('Require approval before execution')).toBeInTheDocument();
    expect(screen.getByText('Max concurrent pipelines')).toBeInTheDocument();
  });

  it('renders the shortcuts section', async () => {
    useAppStore.setState({ settingsSection: 'shortcuts' });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      return [];
    });

    renderWithProviders();

    expect(await screen.findByText('Keyboard Shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Navigation')).toBeInTheDocument();
  });

  it('renders the project opener integration settings', async () => {
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
        enabled: true,
        keyPresent: true,
        authStatus: 'valid',
        message: null,
        label: 'shipcode-dev',
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
      desktopApps: makeDesktopApps(),
    };

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'integrations:check') return integrations;
      return [];
    });

    renderWithProviders();

    const ideTab = await screen.findByRole('tab', { name: 'IDE' });
    fireEvent.mouseDown(ideTab, { button: 0 });
    fireEvent.click(ideTab);

    expect(await screen.findByText('Terminal opener')).toBeInTheDocument();
    expect(screen.getByLabelText('Default terminal')).toBeInTheDocument();
    expect(screen.getByText('Project opener')).toBeInTheDocument();
    expect(screen.getByLabelText('Default app')).toBeInTheDocument();
    expect(screen.getByText('Visual Studio Code')).toBeInTheDocument();
    expect(screen.getAllByText('Ghostty').length).toBeGreaterThan(0);
  });

  it('renders nothing until settings load', () => {
    invokeMock.mockResolvedValue(null);

    renderWithProviders();

    expect(screen.queryByText('Integrations')).not.toBeInTheDocument();
  });

  it('shows and clears worktree validation errors from the general section', async () => {
    useAppStore.setState({ settingsSection: 'general' });
    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'telemetry:get-status') {
        return { enabled: true, envDisabled: false, dsnConfigured: true };
      }
      if (channel === 'settings:set') {
        if ((args as { worktreeRoot?: string }).worktreeRoot === 'relative') {
          throw new Error('Worktree root must be absolute');
        }
        return DEFAULT_SETTINGS;
      }
      return [];
    });

    renderWithProviders();

    const input = await screen.findByLabelText('Worktree root');
    fireEvent.change(input, { target: { value: 'relative' } });
    fireEvent.blur(input);

    expect(await screen.findByText('Worktree root must be absolute')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '/tmp/worktrees' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.queryByText('Worktree root must be absolute')).not.toBeInTheDocument();
    });
  });

  it('loads archived projects and issues and wires restore mutations', async () => {
    useAppStore.setState({ settingsSection: 'archived' });
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'project:list-archived') return [makeProject()];
      if (channel === 'github:list-archived') return [makeIssue()];
      return [];
    });

    renderWithProviders();

    expect(await screen.findByText('Archived repo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('project:unarchive', { projectId: 'project-1' });
    });

    const issuesTab = screen.getByRole('tab', { name: 'Issues' });
    fireEvent.mouseDown(issuesTab, { button: 0 });
    fireEvent.click(issuesTab);
    await waitFor(() => {
      expect(issuesTab).toHaveAttribute('aria-selected', 'true');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:unarchive-issue', { issueId: 'issue-1' });
    });
  });

  it('wires about and developer actions through the parent panel', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'developer:get-info') {
        return {
          appVersion: '1.2.3',
          electronVersion: '40.0.0',
          nodeVersion: '24.0.0',
          platform: 'darwin',
          osRelease: '25.0.0',
          cliVersions: {
            claude: 'claude 1',
            codex: null,
            git: 'git 2',
            gh: 'gh 3',
          },
        };
      }
      if (channel === 'update:get-status' || channel === 'update:check-now') {
        return {
          state: 'up-to-date',
          current: '1.2.3',
          latest: '1.2.3',
          hasUpdate: false,
          checkedAt: '2026-05-09T00:00:00.000Z',
          error: null,
        };
      }
      return [];
    });

    useAppStore.setState({ settingsSection: 'about' });
    renderWithProviders();

    expect(await screen.findByText('About')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Check now|Up to date/ }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('update:check-now');
    });

    cleanup();
    useAppStore.setState({ settingsSection: 'developer' });
    renderWithProviders();

    expect(await screen.findByText('Developer')).toBeInTheDocument();
    expect(await screen.findByText('1.2.3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('ShipCode v1.2.3'),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open DevTools' }));
    expect(invokeMock).toHaveBeenCalledWith('developer:open-devtools');

    fireEvent.click(screen.getByRole('button', { name: 'Open in Finder' }));
    expect(invokeMock).toHaveBeenCalledWith('developer:open-log-directory');
  });
});
