import {
  type CliProviderUsageMap,
  type CliProviderUsageStatus,
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

async function openProjectOpenerSubmenu() {
  fireEvent.pointerDown(await screen.findByRole('button', { name: 'More actions for ShipCode' }));
  const openInTrigger = await screen.findByText('Open in');
  openInTrigger.focus();
  fireEvent.keyDown(openInTrigger, { key: 'ArrowRight' });
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
  discordRouting: 'inherit',
  discordWebhookUrlOverride: null,
  telegramRouting: 'inherit',
  telegramChatIdOverride: null,
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

function makeUsage(
  provider: 'claude' | 'codex',
  overrides: Partial<CliProviderUsageStatus>,
): CliProviderUsageStatus {
  return {
    provider,
    available: true,
    stale: false,
    state: 'ready',
    source: 'cli',
    version: '1.0.0',
    accountEmail: 'vincent@shipshit.dev',
    loginMethod: 'pro',
    updatedAt: '2026-04-16T16:00:00.000Z',
    checkedAt: '2026-04-16T16:01:00.000Z',
    message: null,
    creditsRemaining: null,
    windows:
      provider === 'claude'
        ? [
            {
              key: 'session',
              label: 'Session',
              usedPercent: 10,
              leftPercent: 90,
              resetsAt: null,
              resetDescription: null,
            },
            {
              key: 'weekly',
              label: 'Weekly',
              usedPercent: 20,
              leftPercent: 80,
              resetsAt: null,
              resetDescription: null,
            },
            {
              key: 'model',
              label: 'Sonnet',
              usedPercent: 30,
              leftPercent: 70,
              resetsAt: null,
              resetDescription: null,
            },
          ]
        : [
            {
              key: 'session',
              label: 'Session',
              usedPercent: 10,
              leftPercent: 90,
              resetsAt: null,
              resetDescription: null,
            },
            {
              key: 'weekly',
              label: 'Weekly',
              usedPercent: 20,
              leftPercent: 80,
              resetsAt: null,
              resetDescription: null,
            },
          ],
    ...overrides,
  };
}

function makeUsageMap(overrides: Partial<CliProviderUsageMap> = {}): CliProviderUsageMap {
  return {
    claude: makeUsage('claude', {}),
    codex: makeUsage('codex', {}),
    ...overrides,
  };
}

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

  it('does not render a dedicated open-folder button beside the project row', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'projects-visible' || channel === 'project:list-visible') return [project];
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'dashboard:get-stats')
        return {
          agentsRunning: 0,
          agentsRunningByProject: {},
        } satisfies Partial<DashboardStats>;
      if (channel === 'notification:list') return [] satisfies NotificationRecord[];
      if (channel === 'integrations:check') return integrations;
      if (channel === 'provider-usage:check') return makeUsageMap();
      if (channel === 'project:open-path') return undefined;
      return [];
    });

    renderWithProviders();

    expect(screen.queryByRole('button', { name: 'Open ShipCode folder' })).not.toBeInTheDocument();
  });

  it('shows available opener targets inside a nested project actions submenu and marks the default target', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'projects-visible' || channel === 'project:list-visible') return [project];
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'dashboard:get-stats')
        return {
          agentsRunning: 0,
          agentsRunningByProject: {},
        } satisfies Partial<DashboardStats>;
      if (channel === 'notification:list') return [] satisfies NotificationRecord[];
      if (channel === 'integrations:check') return integrations;
      if (channel === 'provider-usage:check') return makeUsageMap();
      return [];
    });

    renderWithProviders();

    await openProjectOpenerSubmenu();

    expect(await screen.findByText('Cursor')).toBeInTheDocument();
    expect(screen.getByText('Finder')).toBeInTheDocument();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('Visual Studio Code')).toBeInTheDocument();
    expect(screen.queryByText('Ghostty')).not.toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('opens the selected target from the project actions menu', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'projects-visible' || channel === 'project:list-visible') return [project];
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'dashboard:get-stats')
        return {
          agentsRunning: 0,
          agentsRunningByProject: {},
        } satisfies Partial<DashboardStats>;
      if (channel === 'notification:list') return [] satisfies NotificationRecord[];
      if (channel === 'integrations:check') return integrations;
      if (channel === 'provider-usage:check') return makeUsageMap();
      if (channel === 'project:open-path') return undefined;
      return [];
    });

    renderWithProviders();

    await openProjectOpenerSubmenu();
    fireEvent.click(await screen.findByText('Finder'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('project:open-path', {
        projectId: project.id,
        target: 'finder',
      });
    });
  });

  it('shows an approval badge when pendingApprovalsByProject has a count > 0', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'projects-visible' || channel === 'project:list-visible') return [project];
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'dashboard:get-stats')
        return {
          agentsRunning: 0,
          agentsRunningByProject: {},
          pendingApprovalsByProject: { [project.id]: 2 },
        } satisfies Partial<DashboardStats>;
      if (channel === 'notification:list') return [] satisfies NotificationRecord[];
      if (channel === 'integrations:check') return integrations;
      if (channel === 'provider-usage:check') return makeUsageMap();
      return [];
    });

    renderWithProviders();

    expect(await screen.findByText('2 approvals')).toBeInTheDocument();
  });

  it('hides the approval badge when pendingApprovalsByProject count is 0', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'projects-visible' || channel === 'project:list-visible') return [project];
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'dashboard:get-stats')
        return {
          agentsRunning: 0,
          agentsRunningByProject: {},
          pendingApprovalsByProject: { [project.id]: 0 },
        } satisfies Partial<DashboardStats>;
      if (channel === 'notification:list') return [] satisfies NotificationRecord[];
      if (channel === 'integrations:check') return integrations;
      if (channel === 'provider-usage:check') return makeUsageMap();
      return [];
    });

    renderWithProviders();
    await screen.findByText('ShipCode');

    expect(screen.queryByText(/approval/)).not.toBeInTheDocument();
  });

  it('does not crash when agentsRunningByProject is missing from stats', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'projects-visible' || channel === 'project:list-visible') return [project];
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'dashboard:get-stats')
        return {
          agentsRunning: 0,
          pendingApprovalsByProject: {},
        } satisfies Partial<DashboardStats>;
      if (channel === 'notification:list') return [] satisfies NotificationRecord[];
      if (channel === 'integrations:check') return integrations;
      if (channel === 'provider-usage:check') return makeUsageMap();
      return [];
    });

    renderWithProviders();

    expect(await screen.findByText('ShipCode')).toBeInTheDocument();
  });

  it('does not crash when pendingApprovalsByProject is missing from stats', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'projects-visible' || channel === 'project:list-visible') return [project];
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'dashboard:get-stats')
        return {
          agentsRunning: 0,
          agentsRunningByProject: {},
        } satisfies Partial<DashboardStats>;
      if (channel === 'notification:list') return [] satisfies NotificationRecord[];
      if (channel === 'integrations:check') return integrations;
      if (channel === 'provider-usage:check') return makeUsageMap();
      return [];
    });

    renderWithProviders();

    expect(await screen.findByText('ShipCode')).toBeInTheDocument();
  });

  it('does not crash when both agentsRunningByProject and pendingApprovalsByProject are missing', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'projects-visible' || channel === 'project:list-visible') return [project];
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'dashboard:get-stats')
        return { agentsRunning: 0 } satisfies Partial<DashboardStats>;
      if (channel === 'notification:list') return [] satisfies NotificationRecord[];
      if (channel === 'integrations:check') return integrations;
      if (channel === 'provider-usage:check') return makeUsageMap();
      return [];
    });

    renderWithProviders();

    expect(await screen.findByText('ShipCode')).toBeInTheDocument();
  });

  it('renders approval badge before live badge when both are present', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'projects-visible' || channel === 'project:list-visible') return [project];
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'dashboard:get-stats')
        return {
          agentsRunning: 1,
          agentsRunningByProject: { [project.id]: 1 },
          pendingApprovalsByProject: { [project.id]: 1 },
        } satisfies Partial<DashboardStats>;
      if (channel === 'notification:list') return [] satisfies NotificationRecord[];
      if (channel === 'integrations:check') return integrations;
      if (channel === 'provider-usage:check') return makeUsageMap();
      return [];
    });

    renderWithProviders();

    const approvalBadge = await screen.findByText('1 approval');
    // Multiple "live" badges may exist (global in Overview + per-project in row).
    // We want the per-project one which is last in DOM order.
    const liveBadges = await screen.findAllByText('1 live');
    const liveBadge = liveBadges[liveBadges.length - 1]!;

    expect(approvalBadge).toBeInTheDocument();
    expect(liveBadge).toBeInTheDocument();

    // Approval badge should come before live badge in the DOM
    const approvalPosition = approvalBadge.compareDocumentPosition(liveBadge);
    expect(approvalPosition & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows a warning popover with selected phases and current CLI status', async () => {
    const warnedProject: Project = {
      ...project,
      plannerModelOverride: 'codex',
      executorModelOverride: 'codex',
    };

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'projects-visible' || channel === 'project:list-visible')
        return [warnedProject];
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'dashboard:get-stats')
        return {
          agentsRunning: 0,
          agentsRunningByProject: {},
        } satisfies Partial<DashboardStats>;
      if (channel === 'notification:list') return [] satisfies NotificationRecord[];
      if (channel === 'integrations:check') return integrations;
      if (channel === 'provider-usage:check') {
        return makeUsageMap({
          codex: makeUsage('codex', {
            state: 'blocked',
            windows: [
              {
                key: 'session',
                label: 'Session',
                usedPercent: 100,
                leftPercent: 0,
                resetsAt: null,
                resetDescription: 'in 2h',
              },
              {
                key: 'weekly',
                label: 'Weekly',
                usedPercent: 40,
                leftPercent: 60,
                resetsAt: null,
                resetDescription: null,
              },
            ],
          }),
        });
      }
      return [];
    });

    renderWithProviders();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Project model warnings for ShipCode' }),
    );

    expect(await screen.findByText('Selected models vs CLI status')).toBeInTheDocument();
    expect(screen.getByText('Codex CLI session exhausted')).toBeInTheDocument();
    expect(screen.getByText('Planner')).toBeInTheDocument();
  });
});
