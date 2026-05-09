import {
  type DashboardStats,
  DEFAULT_SETTINGS,
  type IntegrationStatus,
  type NotificationRecord,
  type Project,
} from '@shipcode/shared';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import {
  makeProviderUsageStatus as makeUsage,
  makeProviderUsageMap as makeUsageMap,
} from '../test/provider-usage';
import { renderWithQueryClient } from '../test/render';
import { ProjectSidebar } from './ProjectSidebar';

function renderWithProviders() {
  return renderWithQueryClient(<ProjectSidebar />);
}

async function openProjectActionsMenu() {
  fireEvent.pointerDown(await screen.findByRole('button', { name: 'More actions for ShipCode' }));
}

async function openProjectActionsAndFindOpener() {
  await openProjectActionsMenu();
  return screen.findByText(/^Open in /);
}

const project: Project = {
  id: 'project-1',
  name: 'ShipCode',
  path: '/tmp/shipcode',
  pathExists: true,
  setupStatus: 'configured',
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
    t3code: {
      key: 't3code',
      label: 'T3 Code',
      available: true,
      path: '/Applications/T3 Code.app',
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

  it('shows a single open-in item using the default target', async () => {
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

    const openInItem = await openProjectActionsAndFindOpener();
    expect(openInItem.textContent).toBe('Open in Cursor');
  });

  it('opens in default target when clicked', async () => {
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

    const openInItem = await openProjectActionsAndFindOpener();
    fireEvent.click(openInItem);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('project:open-path', {
        projectId: project.id,
        target: 'cursor',
      });
    });
  });

  it('shows a setup shortcut in the project actions menu when setup is missing', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'projects-visible' || channel === 'project:list-visible')
        return [{ ...project, setupStatus: 'missing' satisfies Project['setupStatus'] }];
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

    await openProjectActionsMenu();

    expect(await screen.findByRole('menuitem', { name: 'Setup' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Configure setup...' })).not.toBeInTheDocument();
  });

  it('hides the setup shortcut in the project actions menu when setup is already configured', async () => {
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

    await openProjectActionsMenu();

    expect(screen.queryByRole('menuitem', { name: 'Setup' })).not.toBeInTheDocument();
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

    // Multiple "live" badges may exist (global in Overview + per-project in row).
    // We want the per-project one which is last in DOM order.
    const [approvalBadge, liveBadges] = await Promise.all([
      screen.findByText('1 approval'),
      screen.findAllByText('1 live'),
    ]);
    // findAllByText throws if nothing found, so the last element is always defined
    const liveBadge = liveBadges[liveBadges.length - 1] as HTMLElement;

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

  it('adds a hover title to the low warning badge trigger', async () => {
    const warnedProject: Project = {
      ...project,
      plannerModelOverride: 'codex',
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
            state: 'warning',
            windows: [
              {
                key: 'session',
                label: 'Session',
                usedPercent: 88,
                leftPercent: 12,
                resetsAt: null,
                resetDescription: 'in 45m',
              },
            ],
          }),
        });
      }
      return [];
    });

    renderWithProviders();

    const warningButton = await screen.findByRole('button', {
      name: 'Project model warnings for ShipCode',
    });

    expect(warningButton).toHaveAttribute(
      'title',
      expect.stringContaining('Project model usage running low: Codex CLI session running low'),
    );
  });
});
