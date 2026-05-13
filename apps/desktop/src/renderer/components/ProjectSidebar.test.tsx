// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
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
import { useToastStore } from '../stores/toast-store';
import {
  makeProviderUsageStatus as makeUsage,
  makeProviderUsageMap as makeUsageMap,
} from '../test/provider-usage';
import { renderWithQueryClient } from '../test/render';
import { ProjectSidebar } from './ProjectSidebar';

function renderWithProviders() {
  return renderWithQueryClient(<ProjectSidebar />);
}

function mockSidebarData(
  invokeMock: ReturnType<typeof vi.fn>,
  overrides: {
    projects?: Project[];
    settings?: typeof DEFAULT_SETTINGS;
    stats?: Partial<DashboardStats>;
    notifications?: NotificationRecord[];
    integrations?: IntegrationStatus;
  } = {},
) {
  invokeMock.mockImplementation(async (channel) => {
    if (channel === 'projects-visible' || channel === 'project:list-visible') {
      return overrides.projects ?? [project];
    }
    if (channel === 'settings:get') return overrides.settings ?? DEFAULT_SETTINGS;
    if (channel === 'dashboard:get-stats') {
      return {
        agentsRunning: 0,
        agentsRunningByProject: {},
        ...overrides.stats,
      } satisfies Partial<DashboardStats>;
    }
    if (channel === 'notification:list') {
      return overrides.notifications ?? ([] satisfies NotificationRecord[]);
    }
    if (channel === 'integrations:check') return overrides.integrations ?? integrations;
    if (channel === 'provider-usage:check') return makeUsageMap();
    if (
      channel === 'project:open-path' ||
      channel === 'settings:set' ||
      channel === 'project:pin' ||
      channel === 'project:archive' ||
      channel === 'project:remove' ||
      channel === 'github:refresh-issues'
    ) {
      return undefined;
    }
    if (channel === 'dialog:open-directory') return '/tmp/relinked';
    if (channel === 'project:relink-path') return { ...project, path: '/tmp/relinked' };
    return [];
  });
}

async function openProjectActionsMenu() {
  fireEvent.pointerDown(await screen.findByRole('button', { name: 'More actions for ShipCode' }));
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
    document.body.classList.remove('cursor-col-resize', 'select-none');
    window.shipcode = {
      invoke: invokeMock as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };

    useAppStore.setState({
      activeProjectId: project.id,
      viewMode: 'project',
      settingsVisible: false,
      sidebarCollapsed: false,
    });
    useToastStore.setState({ toasts: [] });
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

  it('routes top-level navigation, create issue, add repository, and project tabs through the app store', async () => {
    mockSidebarData(invokeMock, {
      stats: { agentsRunning: 2 },
      notifications: [
        {
          id: 'notification-1',
          threadId: 'thread-1',
          projectId: project.id,
          kind: 'failed',
          title: 'Failed',
          body: 'Needs attention',
          createdAt: '2026-05-09T00:00:00.000Z',
          dismissedAt: null,
        },
      ],
    });

    renderWithProviders();

    expect(await screen.findByText('2 live')).toBeInTheDocument();
    expect(await screen.findByText('1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /New Issue/i }));
    expect(useAppStore.getState().createIssueModalOpen).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Search/i }));
    expect(useAppStore.getState().commandPaletteOpen).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Activity/i }));
    expect(useAppStore.getState().viewMode).toBe('activity');

    fireEvent.click(screen.getByRole('button', { name: /Overview/i }));
    expect(useAppStore.getState().viewMode).toBe('overview');

    fireEvent.click(screen.getByRole('button', { name: /Inbox/i }));
    expect(useAppStore.getState().viewMode).toBe('inbox');

    fireEvent.click(screen.getByRole('button', { name: /Skills/i }));
    expect(useAppStore.getState().viewMode).toBe('skills');

    fireEvent.click(screen.getByRole('button', { name: /Automations/i }));
    expect(useAppStore.getState().viewMode).toBe('automations');

    fireEvent.click(screen.getByRole('button', { name: /Costs/i }));
    expect(useAppStore.getState().viewMode).toBe('costs');

    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }));
    expect(useAppStore.getState().addProjectExplorerOpen).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'ShipCode' }));
    expect(useAppStore.getState().viewMode).toBe('project');

    fireEvent.click(screen.getByRole('button', { name: 'Git' }));
    expect(useAppStore.getState().projectTab).toBe('git');
  });

  it('sorts pinned projects first and applies alpha and added ordering', async () => {
    const alphaProject = {
      ...project,
      id: 'project-alpha',
      name: 'Alpha',
      pinned: false,
      createdAt: '2026-04-12T00:00:00.000Z',
      updatedAt: '2026-04-16T00:00:00.000Z',
    };
    const betaProject = {
      ...project,
      id: 'project-beta',
      name: 'Beta',
      pinned: false,
      createdAt: '2026-04-11T00:00:00.000Z',
      updatedAt: '2026-04-15T00:00:00.000Z',
    };
    const pinnedProject = {
      ...project,
      id: 'project-pinned',
      name: 'Pinned',
      pinned: true,
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z',
    };

    mockSidebarData(invokeMock, {
      projects: [betaProject, pinnedProject, alphaProject],
      settings: { ...DEFAULT_SETTINGS, projectSortOrder: 'alpha' },
    });

    const { unmount } = renderWithProviders();

    const pinnedButton = await screen.findByRole('button', { name: 'Pinned' });
    const alphaButton = screen.getByRole('button', { name: 'Alpha' });
    const betaButton = screen.getByRole('button', { name: 'Beta' });

    expect(
      pinnedButton.compareDocumentPosition(alphaButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      alphaButton.compareDocumentPosition(betaButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    unmount();
    cleanup();
    invokeMock.mockReset();
    mockSidebarData(invokeMock, {
      projects: [alphaProject, betaProject],
      settings: { ...DEFAULT_SETTINGS, projectSortOrder: 'added' },
    });

    renderWithProviders();

    const olderButton = await screen.findByRole('button', { name: 'Beta' });
    const newerButton = screen.getByRole('button', { name: 'Alpha' });
    expect(
      olderButton.compareDocumentPosition(newerButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('updates sort order and resizes the sidebar from the drag handle', async () => {
    mockSidebarData(invokeMock);
    renderWithProviders();

    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Sort projects' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Alphabetical/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('settings:set', { projectSortOrder: 'alpha' });
    });

    const sidebarElement = document.querySelector('[data-project-sidebar]')?.parentElement ?? null;
    if (!(sidebarElement instanceof HTMLElement)) {
      throw new Error('Expected project sidebar wrapper');
    }

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Resize project sidebar' }), {
      clientX: 256,
    });
    fireEvent.mouseMove(document, { clientX: 100 });
    expect(document.body).toHaveClass('cursor-col-resize', 'select-none');
    await waitFor(() => {
      expect(sidebarElement).toHaveStyle({ width: '220px' });
    });
    fireEvent.mouseUp(document);
    expect(document.body).not.toHaveClass('cursor-col-resize', 'select-none');
  });

  it('handles missing project relink, pin, archive, remove confirmation, and unavailable open target', async () => {
    const missingProject: Project = {
      ...project,
      pathExists: false,
      setupStatus: 'invalid',
      pinned: true,
    };
    const unavailableIntegrations: IntegrationStatus = {
      ...integrations,
      desktopApps: {
        ...integrations.desktopApps,
        cursor: { ...integrations.desktopApps.cursor, available: false },
      },
    };
    mockSidebarData(invokeMock, {
      projects: [missingProject],
      integrations: unavailableIntegrations,
    });
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);

    renderWithProviders();

    expect(await screen.findByText('Missing')).toBeInTheDocument();
    expect(screen.getByTitle(`Project folder missing: ${project.path}`)).toBeInTheDocument();

    await openProjectActionsMenu();
    expect(screen.queryByText(/^Open in /)).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('menuitem', { name: /Relink folder/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('dialog:open-directory');
      expect(invokeMock).toHaveBeenCalledWith('project:relink-path', {
        projectId: project.id,
        path: '/tmp/relinked',
      });
    });

    await openProjectActionsMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Unpin' }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('project:pin', {
        projectId: project.id,
        pinned: false,
      });
    });

    await openProjectActionsMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('project:archive', { projectId: project.id });
    });

    await openProjectActionsMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalledWith('project:remove', { projectId: project.id });

    await openProjectActionsMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('project:remove', { projectId: project.id });
    });
  });

  it('shows mutation failure toasts for project actions', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'projects-visible' || channel === 'project:list-visible') {
        return [{ ...project, pathExists: false }];
      }
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'dashboard:get-stats') {
        return { agentsRunning: 0, agentsRunningByProject: {} } satisfies Partial<DashboardStats>;
      }
      if (channel === 'notification:list') return [] satisfies NotificationRecord[];
      if (channel === 'integrations:check') return integrations;
      if (channel === 'provider-usage:check') return makeUsageMap();
      if (channel === 'dialog:open-directory') return '/tmp/relinked';
      if (channel === 'project:archive') throw new Error('archive failed');
      if (channel === 'project:remove') throw new Error('remove failed');
      if (channel === 'project:relink-path') throw new Error('relink failed');
      if (channel === 'project:open-path') throw new Error('open failed');
      return [];
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderWithProviders();

    await openProjectActionsMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: /Relink folder/i }));
    await waitFor(() => {
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        title: 'Failed to relink project',
        body: 'relink failed',
      });
    });

    await openProjectActionsMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => {
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        title: 'Failed to archive project',
        body: 'archive failed',
      });
    });

    await openProjectActionsMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    await waitFor(() => {
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        title: 'Failed to remove project',
        body: 'remove failed',
      });
    });
  });

  it('handles notification callbacks, collapsed state, and recent ordering', async () => {
    const listeners: Record<string, () => void> = {};
    window.shipcode.on = vi.fn((channel: string, callback: () => void) => {
      listeners[channel] = callback;
      return () => {};
    }) as unknown as typeof window.shipcode.on;
    const staleProject = {
      ...project,
      id: 'project-stale',
      name: 'Stale',
      updatedAt: '',
    };
    const freshProject = {
      ...project,
      id: 'project-fresh',
      name: 'Fresh',
      updatedAt: '2026-04-15T00:00:00.000Z',
    };
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'projects-visible' || channel === 'project:list-visible') {
        return [staleProject, freshProject];
      }
      if (channel === 'settings:get') {
        return { ...DEFAULT_SETTINGS, projectSortOrder: 'recent' };
      }
      if (channel === 'dashboard:get-stats') {
        return { agentsRunning: 0, agentsRunningByProject: {} } satisfies Partial<DashboardStats>;
      }
      if (channel === 'notification:list') return [] satisfies NotificationRecord[];
      if (channel === 'integrations:check') return integrations;
      if (channel === 'provider-usage:check') return makeUsageMap();
      return [];
    });
    useAppStore.setState({ activeProjectId: null, viewMode: 'overview', sidebarCollapsed: true });

    renderWithProviders();

    const freshButton = await screen.findByRole('button', { name: 'Fresh' });
    const staleButton = screen.getByRole('button', { name: 'Stale' });
    expect(
      freshButton.compareDocumentPosition(staleButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(document.querySelector('[data-project-sidebar]')?.parentElement).toHaveStyle({
      width: '0px',
    });

    listeners['notification:fire']?.();
    listeners['notification:dismiss']?.();
  });

  it('handles active removal, relink cancellation, setup/settings shortcuts, warning inbox, and date fallbacks', async () => {
    const invalidProject = {
      ...project,
      setupStatus: 'invalid' satisfies Project['setupStatus'],
      createdAt: '',
      updatedAt: '',
    };
    const olderProject = {
      ...project,
      id: 'project-older',
      name: 'Older',
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '',
    };
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'projects-visible' || channel === 'project:list-visible') {
        return [invalidProject, olderProject];
      }
      if (channel === 'settings:get') {
        return { ...DEFAULT_SETTINGS, projectSortOrder: 'added' };
      }
      if (channel === 'dashboard:get-stats') {
        return { agentsRunning: 0, agentsRunningByProject: {} } satisfies Partial<DashboardStats>;
      }
      if (channel === 'notification:list') {
        return [
          {
            id: 'notification-approval',
            threadId: 'thread-1',
            projectId: project.id,
            kind: 'approval',
            title: 'Approval needed',
            body: 'Waiting',
            createdAt: '2026-05-09T00:00:00.000Z',
            dismissedAt: null,
          },
        ] satisfies NotificationRecord[];
      }
      if (channel === 'integrations:check') return integrations;
      if (channel === 'provider-usage:check') return makeUsageMap();
      if (channel === 'project:remove') return undefined;
      return [];
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderWithProviders();

    const invalidButton = (await screen.findAllByRole('button', { name: /ShipCode/ }))[0];
    const olderButton = screen.getByRole('button', { name: 'Older' });
    expect(
      invalidButton.compareDocumentPosition(olderButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText('Setup!')).toBeInTheDocument();
    expect(await screen.findByText('1')).toBeInTheDocument();

    await openProjectActionsMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Settings' }));
    expect(useAppStore.getState().projectSettingsModalOpen).toBe(true);

    useAppStore.setState({ projectSettingsModalOpen: false, projectSettingsModalInitialTab: null });
    await openProjectActionsMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Setup' }));
    expect(useAppStore.getState().projectSettingsModalOpen).toBe(true);
    expect(useAppStore.getState().projectSettingsModalInitialTab).toBe('setup');

    await openProjectActionsMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    await waitFor(() => {
      expect(useAppStore.getState().activeProjectId).toBeNull();
      expect(useAppStore.getState().viewMode).toBe('overview');
    });
  });

  it('handles cancelled relinks and ignores refresh failures after a successful relink', async () => {
    const missingProject = { ...project, pathExists: false };
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'projects-visible' || channel === 'project:list-visible')
        return [missingProject];
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'dashboard:get-stats') {
        return { agentsRunning: 0, agentsRunningByProject: {} } satisfies Partial<DashboardStats>;
      }
      if (channel === 'notification:list') return [] satisfies NotificationRecord[];
      if (channel === 'integrations:check') return integrations;
      if (channel === 'provider-usage:check') return makeUsageMap();
      if (channel === 'dialog:open-directory') return null;
      return [];
    });

    const { unmount } = renderWithProviders();

    await openProjectActionsMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: /Relink folder/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('dialog:open-directory');
    });
    expect(invokeMock).not.toHaveBeenCalledWith('project:relink-path', expect.anything());

    unmount();
    cleanup();
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'projects-visible' || channel === 'project:list-visible')
        return [missingProject];
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'dashboard:get-stats') {
        return { agentsRunning: 0, agentsRunningByProject: {} } satisfies Partial<DashboardStats>;
      }
      if (channel === 'notification:list') return [] satisfies NotificationRecord[];
      if (channel === 'integrations:check') return integrations;
      if (channel === 'provider-usage:check') return makeUsageMap();
      if (channel === 'dialog:open-directory') return '/tmp/relinked';
      if (channel === 'project:relink-path') return { ...project, path: '/tmp/relinked' };
      if (channel === 'github:refresh-issues') throw new Error('refresh failed');
      return [];
    });

    renderWithProviders();

    await openProjectActionsMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: /Relink folder/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:refresh-issues', {
        projectId: project.id,
        force: true,
      });
    });
  });

  it('archives inactive projects without changing the active view', async () => {
    mockSidebarData(invokeMock, {
      projects: [{ ...project, id: 'project-inactive', name: 'Inactive' }],
    });
    useAppStore.setState({ activeProjectId: project.id, viewMode: 'project' });

    renderWithProviders();

    fireEvent.pointerDown(await screen.findByRole('button', { name: 'More actions for Inactive' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('project:archive', { projectId: 'project-inactive' });
    });
    expect(useAppStore.getState().activeProjectId).toBe(project.id);
    expect(useAppStore.getState().viewMode).toBe('project');
  });
});
