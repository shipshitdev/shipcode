// @vitest-environment jsdom

import {
  type ContextFileInfo,
  DEFAULT_SETTINGS,
  type IntegrationStatus,
  type Project,
  type ProjectSetupDraft,
} from '@shipcode/shared';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { renderWithQueryClient } from '../test/render';
import { ProjectSettingsModal } from './ProjectSettingsModal';

vi.mock('electron-log/renderer', () => ({
  default: {
    error: vi.fn(),
  },
}));

function renderWithProviders() {
  return renderWithQueryClient(<ProjectSettingsModal />);
}

describe('ProjectSettingsModal', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  const project: Project = {
    id: 'project-1',
    name: 'ShipCode',
    path: '/tmp/shipcode',
    pathExists: true,
    gitRemote: 'git@github.com:shipshitdev/shipcode.git',
    githubRepoId: null,
    githubRepoFullName: null,
    starterIssueNumber: null,
    starterIssueCreatedAt: null,
    githubProjectUrl: 'https://github.com/orgs/shipshitdev/projects/1',
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
    discordRouting: 'inherit',
    discordWebhookUrlOverride: null,
    telegramRouting: 'inherit',
    telegramChatIdOverride: null,
    defaultBranch: 'main',
    pinned: false,
    archived: false,
    hidden: false,
    notifyGithubUser: null,
    createdAt: '2026-04-13T00:00:00.000Z',
    updatedAt: '2026-04-13T00:00:00.000Z',
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

  const contextFiles: ContextFileInfo[] = [
    { name: 'goal.md', exists: true, size: 512 },
    { name: 'architecture.md', exists: true, size: 256 },
    { name: 'constraints.md', exists: false },
    { name: 'do-dont.md', exists: false },
  ];

  function makeProjectSetup(kind: 'unknown' | 'bun' = 'unknown'): ProjectSetupDraft {
    const suggestedContract =
      kind === 'bun'
        ? {
            version: 1 as const,
            setupCommands: ['bun install --frozen-lockfile'],
            verifyCommands: ['bun run typecheck'],
            envFiles: [],
            setupBeforeVerify: false,
            testingContext: 'Detected bun package scripts for verification.',
          }
        : {
            version: 1 as const,
            setupCommands: [],
            verifyCommands: [],
            envFiles: [],
            setupBeforeVerify: false,
            testingContext: null,
          };

    return {
      inspection: {
        status: 'missing',
        path: '/tmp/shipcode/.shipcode/setup.json',
        contract: null,
        error: null,
      },
      profiles: [
        {
          kind,
          label: kind === 'bun' ? 'Bun' : 'Unknown',
          recommended: true,
          evidence:
            kind === 'bun' ? ['package.json', 'bun.lock'] : ['No supported repo markers detected'],
          suggestedContract,
        },
      ],
      suggestedContract,
    };
  }

  function mockProjectSettingsInvoke(
    handlers: Record<string, unknown | ((args: unknown) => unknown | Promise<unknown>)> = {},
  ) {
    invokeMock.mockImplementation(async (channel, args) => {
      if (channel in handlers) {
        const handler = handlers[channel];
        return typeof handler === 'function' ? handler(args) : handler;
      }
      if (channel === 'project:get') return project;
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'integrations:check') return integrations;
      if (channel === 'memory:list') {
        return { files: contextFiles, hasObsoleteContextDirectory: false };
      }
      if (channel === 'git:list-branches') return ['main', 'feature/settings'];
      if (channel === 'project:get-setup') return makeProjectSetup('unknown');
      if (channel === 'project:set-name') return project;
      if (channel === 'project:set-github-project-url') return project;
      if (channel === 'project:set-notification-routing') return project;
      if (channel === 'project:set-notify-github-user') return project;
      if (channel === 'project:set-model-overrides') return project;
      if (channel === 'project:save-setup') return undefined;
      return null;
    });
  }

  beforeEach(() => {
    cleanup();
    invokeMock.mockReset();
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;

    useAppStore.setState({
      projectSettingsModalOpen: true,
      projectSettingsModalProjectId: project.id,
      projectSettingsModalInitialTab: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the modal shell and general tab content', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return project;
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'integrations:check') return integrations;
      if (channel === 'memory:list') {
        return { files: contextFiles, hasObsoleteContextDirectory: false };
      }
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Project Settings')).toBeInTheDocument();
    expect(await screen.findByText('Repository folder')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pipeline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Models' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Memory' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to project' })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue(project.githubProjectUrl ?? '')).toBeInTheDocument();

    const scrollRegion = document.body.querySelector('[data-project-settings-scroll-region]');
    expect(scrollRegion).toContainElement(screen.getByText('Repository folder'));
  });

  it('applies a clicked detected setup profile into the setup form', async () => {
    useAppStore.setState({
      projectSettingsModalOpen: true,
      projectSettingsModalProjectId: project.id,
      projectSettingsModalInitialTab: 'setup',
    });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return project;
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'integrations:check') return integrations;
      if (channel === 'memory:list') {
        return { files: contextFiles, hasObsoleteContextDirectory: false };
      }
      if (channel === 'project:get-setup') {
        return {
          inspection: {
            status: 'missing',
            path: '/tmp/shipcode/.shipcode/setup.json',
            contract: null,
            error: null,
          },
          profiles: [
            {
              kind: 'xcode',
              label: 'Xcode',
              recommended: true,
              evidence: ['Demo.xcodeproj', 'Package.swift'],
              suggestedContract: {
                version: 1,
                setupCommands: ['xcodebuild -resolvePackageDependencies'],
                verifyCommands: [],
                envFiles: [],
                setupBeforeVerify: false,
                testingContext: 'Detected an Xcode project.',
              },
            },
            {
              kind: 'swiftpm',
              label: 'Swift Package Manager',
              recommended: false,
              evidence: ['Package.swift'],
              suggestedContract: {
                version: 1,
                setupCommands: [],
                verifyCommands: ['swift test'],
                envFiles: [],
                setupBeforeVerify: false,
                testingContext: 'Detected a Swift Package Manager repo.',
              },
            },
          ],
          suggestedContract: {
            version: 1,
            setupCommands: ['xcodebuild -resolvePackageDependencies'],
            verifyCommands: [],
            envFiles: [],
            setupBeforeVerify: false,
            testingContext: 'Detected an Xcode project.',
          },
        };
      }
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Project Settings')).toBeInTheDocument();
    expect(await screen.findByLabelText('Setup commands')).toHaveValue(
      'xcodebuild -resolvePackageDependencies',
    );
    expect(screen.getByLabelText('Verify commands')).toHaveValue('');

    fireEvent.click(screen.getByRole('button', { name: 'Swift Package Manager' }));

    expect(screen.getByLabelText('Setup commands')).toHaveValue('');
    expect(screen.getByLabelText('Verify commands')).toHaveValue('swift test');
    expect(screen.getByLabelText('Testing context')).toHaveValue(
      'Detected a Swift Package Manager repo.',
    );
  });

  it('refetches setup detection when Re-detect is clicked', async () => {
    useAppStore.setState({
      projectSettingsModalOpen: true,
      projectSettingsModalProjectId: project.id,
      projectSettingsModalInitialTab: 'setup',
    });
    let setupCalls = 0;

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return project;
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'integrations:check') return integrations;
      if (channel === 'memory:list') {
        return { files: contextFiles, hasObsoleteContextDirectory: false };
      }
      if (channel === 'project:get-setup') {
        setupCalls += 1;
        return setupCalls === 1 ? makeProjectSetup('unknown') : makeProjectSetup('bun');
      }
      return null;
    });

    renderWithProviders();

    expect(await screen.findByRole('button', { name: 'Unknown recommended' })).toBeInTheDocument();

    const redetectButton = screen.getByRole('button', { name: 'Re-detect' });
    fireEvent.click(redetectButton);

    expect(redetectButton).toBeDisabled();
    await waitFor(() => expect(setupCalls).toBe(2));
    expect(await screen.findByRole('button', { name: 'Bun recommended' })).toBeInTheDocument();
  });

  it('refreshes setup detection after relinking the repository folder', async () => {
    let setupCalls = 0;
    const relinkedProject = { ...project, path: '/tmp/relinked-shipcode' };

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return project;
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'integrations:check') return integrations;
      if (channel === 'memory:list') {
        return { files: contextFiles, hasObsoleteContextDirectory: false };
      }
      if (channel === 'project:get-setup') {
        setupCalls += 1;
        return setupCalls === 1 ? makeProjectSetup('unknown') : makeProjectSetup('bun');
      }
      if (channel === 'dialog:open-directory') return relinkedProject.path;
      if (channel === 'project:relink-path') return relinkedProject;
      if (channel === 'github:refresh-issues') return [];
      return null;
    });

    renderWithProviders();

    await waitFor(() => expect(setupCalls).toBe(1));
    fireEvent.click(await screen.findByRole('button', { name: /Change folder/ }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('project:relink-path', {
        projectId: project.id,
        path: relinkedProject.path,
      });
      expect(setupCalls).toBe(2);
    });
  });

  it('does not relink when directory selection is cancelled', async () => {
    mockProjectSettingsInvoke({
      'dialog:open-directory': null,
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: /Change folder/ }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('dialog:open-directory');
    });
    expect(invokeMock).not.toHaveBeenCalledWith('project:relink-path', expect.anything());
  });

  it('shows relink failures without refreshing issues', async () => {
    mockProjectSettingsInvoke({
      'dialog:open-directory': '/tmp/relinked-shipcode',
      'project:relink-path': () => {
        throw new Error('Folder is not a git repository\nfull trace');
      },
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: /Change folder/ }));

    expect(await screen.findByText('Folder is not a git repository')).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith('github:refresh-issues', expect.anything());
  });

  it('refreshes branches and git remote from the general tab controls', async () => {
    mockProjectSettingsInvoke({
      'git:list-branches': ['main', 'develop', 'origin/main'],
      'project:refresh-git-remote': { project, remote: project.gitRemote, changed: false },
    });

    renderWithProviders();

    fireEvent.click(await screen.findByTitle('Refresh branches'));
    fireEvent.click(screen.getByTitle('Re-read origin URL from local git config'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('git:list-branches', {
        projectId: project.id,
        fetch: true,
      });
      expect(invokeMock).toHaveBeenCalledWith('project:refresh-git-remote', {
        projectId: project.id,
      });
    });
  });

  it('logs branch and git remote refresh failures without closing settings', async () => {
    let branchCalls = 0;
    mockProjectSettingsInvoke({
      'git:list-branches': () => {
        branchCalls += 1;
        if (branchCalls === 1) return ['main', 'develop'];
        throw new Error('branch refresh failed');
      },
      'project:refresh-git-remote': () => {
        throw new Error('remote refresh failed\nfull trace');
      },
    });

    renderWithProviders();

    fireEvent.click(await screen.findByTitle('Refresh branches'));
    fireEvent.click(screen.getByTitle('Re-read origin URL from local git config'));

    expect(await screen.findByText('remote refresh failed')).toBeInTheDocument();
    expect(useAppStore.getState().projectSettingsModalOpen).toBe(true);
  });

  it('saves a renamed project through project:set-name', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return project;
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'integrations:check') return integrations;
      if (channel === 'memory:list') {
        return { files: contextFiles, hasObsoleteContextDirectory: false };
      }
      if (channel === 'project:set-name') return { ...project, name: 'Gateway Remastered' };
      if (channel === 'project:set-github-project-url') return project;
      if (channel === 'project:set-notification-routing') return project;
      if (channel === 'project:set-notify-github-user') return project;
      if (channel === 'project:set-model-overrides') return project;
      return null;
    });

    renderWithProviders();

    fireEvent.change(await screen.findByLabelText('Name'), {
      target: { value: 'Gateway Remastered' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('project:set-name', {
        projectId: project.id,
        name: 'Gateway Remastered',
      });
    });
  });

  it('shows general save failures without closing the modal', async () => {
    mockProjectSettingsInvoke({
      'project:set-name': () => {
        throw new Error('name update failed\nfull trace');
      },
    });

    renderWithProviders();

    fireEvent.change(await screen.findByLabelText('Name'), {
      target: { value: 'Broken rename' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));

    expect(await screen.findByText('name update failed')).toBeInTheDocument();
    expect(useAppStore.getState().projectSettingsModalOpen).toBe(true);
  });

  it('keeps the modal open when saving with a blank project name', async () => {
    mockProjectSettingsInvoke();

    renderWithProviders();

    fireEvent.change(await screen.findByLabelText('Name'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));

    await waitFor(() => {
      expect(invokeMock).not.toHaveBeenCalledWith('project:set-name', expect.anything());
    });
    expect(useAppStore.getState().projectSettingsModalOpen).toBe(true);
  });

  it('closes on Escape when no modal operation is busy', async () => {
    mockProjectSettingsInvoke();

    renderWithProviders();

    fireEvent.keyDown(await screen.findByText('Project Settings'), { key: 'Escape' });

    expect(useAppStore.getState().projectSettingsModalOpen).toBe(false);
  });

  it('disables board sync after a failed attach result', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return project;
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'integrations:check') return integrations;
      if (channel === 'memory:list') {
        return { files: contextFiles, hasObsoleteContextDirectory: false };
      }
      if (channel === 'github:sync-to-project-board') {
        return {
          attached: 0,
          alreadyPresent: 0,
          failed: 1,
          errors: ['#20: resource not found'],
        };
      }
      return null;
    });

    renderWithProviders();

    const syncButton = await screen.findByRole('button', { name: 'Sync existing issues to board' });
    fireEvent.click(syncButton);

    await waitFor(() => {
      expect(screen.getByText(/#20: resource not found/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sync existing issues to board' })).toBeDisabled();
    });
  });

  it('does not render content when the modal is closed', () => {
    useAppStore.setState({
      projectSettingsModalOpen: false,
      projectSettingsModalProjectId: project.id,
      projectSettingsModalInitialTab: null,
    });
    mockProjectSettingsInvoke();

    renderWithProviders();

    expect(screen.queryByText('Project Settings')).not.toBeInTheDocument();
  });

  it('shows the loading state when project data is unavailable', async () => {
    mockProjectSettingsInvoke({ 'project:get': null });

    renderWithProviders();

    expect(await screen.findByText('Loading project…')).toBeInTheDocument();
  });

  it('blocks saving and shows validation for an invalid GitHub Projects URL', async () => {
    mockProjectSettingsInvoke();

    renderWithProviders();

    const urlInput = await screen.findByLabelText('GitHub Projects board URL');
    fireEvent.change(urlInput, { target: { value: 'https://github.com/not-a-project' } });
    fireEvent.blur(urlInput);
    fireEvent.keyDown(screen.getByText('Project Settings'), { key: 'Enter', metaKey: true });

    expect(
      await screen.findByText(
        'URL must point to a GitHub Project (e.g. https://github.com/orgs/acme/projects/3)',
      ),
    ).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith(
      'project:set-github-project-url',
      expect.anything(),
    );
  });

  it('shows thrown board sync errors and locks the sync button', async () => {
    mockProjectSettingsInvoke({
      'github:sync-to-project-board': () => {
        throw new Error('Board scope missing\nfull trace');
      },
    });

    renderWithProviders();

    const syncButton = await screen.findByRole('button', { name: 'Sync existing issues to board' });
    fireEvent.click(syncButton);

    expect(await screen.findByText('Board scope missing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync existing issues to board' })).toBeDisabled();
  });

  it('shows successful board sync totals', async () => {
    mockProjectSettingsInvoke({
      'github:sync-to-project-board': {
        attached: 2,
        alreadyPresent: 1,
        failed: 0,
        errors: [],
      },
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Sync existing issues to board' }));

    expect(await screen.findByText('Attached 2, already present 1')).toBeInTheDocument();
  });

  it('respects cancellation before resetting issue overrides', async () => {
    useAppStore.setState({
      projectSettingsModalOpen: true,
      projectSettingsModalProjectId: project.id,
      projectSettingsModalInitialTab: 'pipeline',
    });
    mockProjectSettingsInvoke();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Reset All Issue Overrides' }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith(
      'github:clear-all-phase-overrides-for-project',
      expect.anything(),
    );

    confirmSpy.mockRestore();
  });

  it('resets issue overrides after confirmation', async () => {
    useAppStore.setState({
      projectSettingsModalOpen: true,
      projectSettingsModalProjectId: project.id,
      projectSettingsModalInitialTab: 'pipeline',
    });
    mockProjectSettingsInvoke({
      'github:clear-all-phase-overrides-for-project': { clearedCount: 2 },
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Reset All Issue Overrides' }));

    expect(await screen.findByText('Reset issue overrides on 2 issues.')).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith('github:clear-all-phase-overrides-for-project', {
      projectId: project.id,
    });

    confirmSpy.mockRestore();
  });

  it('renders zero and singular issue override reset results', async () => {
    useAppStore.setState({
      projectSettingsModalOpen: true,
      projectSettingsModalProjectId: project.id,
      projectSettingsModalInitialTab: 'pipeline',
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    let clearedCount = 0;
    mockProjectSettingsInvoke({
      'github:clear-all-phase-overrides-for-project': () => ({ clearedCount }),
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Reset All Issue Overrides' }));
    expect(await screen.findByText('No issue overrides were set.')).toBeInTheDocument();

    clearedCount = 1;
    fireEvent.click(screen.getByRole('button', { name: 'Reset All Issue Overrides' }));
    expect(await screen.findByText('Reset issue overrides on 1 issue.')).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it('shows reset issue override failures', async () => {
    useAppStore.setState({
      projectSettingsModalOpen: true,
      projectSettingsModalProjectId: project.id,
      projectSettingsModalInitialTab: 'pipeline',
    });
    mockProjectSettingsInvoke({
      'github:clear-all-phase-overrides-for-project': () => {
        throw new Error('Unable to reset issue overrides\nfull trace');
      },
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Reset All Issue Overrides' }));

    expect(await screen.findByText('Unable to reset issue overrides')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('shows memory generation failures on the Memory tab', async () => {
    useAppStore.setState({
      projectSettingsModalOpen: true,
      projectSettingsModalProjectId: project.id,
      projectSettingsModalInitialTab: 'context',
    });
    mockProjectSettingsInvoke({
      'memory:generate': { success: false, error: 'No repo docs found' },
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Generate Memory' }));

    expect(await screen.findByText('No repo docs found')).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith('memory:generate', {
      projectId: project.id,
      cli: 'claude',
    });
  });

  it('clamps thrown memory generation errors on the Memory tab', async () => {
    useAppStore.setState({
      projectSettingsModalOpen: true,
      projectSettingsModalProjectId: project.id,
      projectSettingsModalInitialTab: 'context',
    });
    mockProjectSettingsInvoke({
      'memory:generate': () => {
        throw new Error('context command failed\nstack trace');
      },
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Generate Memory' }));

    expect(await screen.findByText('context command failed')).toBeInTheDocument();
  });

  it('disables memory generation when the selected CLI is unavailable', async () => {
    useAppStore.setState({
      projectSettingsModalOpen: true,
      projectSettingsModalProjectId: project.id,
      projectSettingsModalInitialTab: 'context',
    });
    mockProjectSettingsInvoke({
      'integrations:check': {
        ...integrations,
        system: {
          ...integrations.system,
          claude: {
            ...integrations.system.claude,
            authenticated: false,
          },
        },
      },
    });

    renderWithProviders();

    expect(await screen.findByRole('button', { name: 'Generate Memory' })).toBeDisabled();
    expect(invokeMock).not.toHaveBeenCalledWith('memory:generate', expect.anything());
  });

  it('saves edited setup contract values', async () => {
    useAppStore.setState({
      projectSettingsModalOpen: true,
      projectSettingsModalProjectId: project.id,
      projectSettingsModalInitialTab: 'setup',
    });
    mockProjectSettingsInvoke({
      'project:get-setup': {
        inspection: {
          status: 'valid',
          path: '/tmp/shipcode/.shipcode/setup.json',
          contract: {
            version: 1,
            setupCommands: ['bun install'],
            verifyCommands: ['bun test'],
            envFiles: [],
            setupBeforeVerify: false,
            testingContext: 'Existing context',
          },
          error: null,
        },
        profiles: [],
        suggestedContract: {
          version: 1,
          setupCommands: [],
          verifyCommands: [],
          envFiles: [],
          setupBeforeVerify: false,
          testingContext: null,
        },
      },
    });

    renderWithProviders();

    fireEvent.change(await screen.findByLabelText('Setup commands'), {
      target: { value: ' bun install \n\n bun run build ' },
    });
    fireEvent.change(screen.getByLabelText('Verify commands'), {
      target: { value: ' bun test \n bun run typecheck ' },
    });
    fireEvent.change(screen.getByLabelText('Testing context'), {
      target: { value: ' Use Bun only. ' },
    });
    fireEvent.change(screen.getByLabelText('Start command'), {
      target: { value: ' bun run dev --port $PORT ' },
    });
    fireEvent.change(screen.getByLabelText('Readiness URL'), {
      target: { value: ' http://127.0.0.1:$PORT ' },
    });
    fireEvent.change(screen.getByLabelText('Runtime test commands'), {
      target: { value: ' bun run e2e ' },
    });
    fireEvent.change(screen.getByLabelText('Startup timeout ms'), {
      target: { value: '500' },
    });
    fireEvent.change(screen.getByLabelText('Port env var'), {
      target: { value: ' APP_PORT ' },
    });
    fireEvent.click(screen.getByLabelText('Discover agent runtime tests'));
    fireEvent.click(screen.getByLabelText('Setup before verification'));
    fireEvent.click(screen.getByRole('button', { name: 'Add env file' }));
    fireEvent.change(await screen.findByLabelText('Source'), {
      target: { value: ' .env.local ' },
    });
    fireEvent.change(screen.getByLabelText('Target'), {
      target: { value: ' .env.test ' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('project:save-setup', {
        projectId: project.id,
        contract: {
          version: 1,
          setupCommands: ['bun install', 'bun run build'],
          verifyCommands: ['bun test', 'bun run typecheck'],
          envFiles: [{ source: '.env.local', target: '.env.test', required: true }],
          setupBeforeVerify: true,
          testingContext: 'Use Bun only.',
          runtimeQa: {
            server: {
              command: 'bun run dev --port $PORT',
              readinessUrl: 'http://127.0.0.1:$PORT',
              startupTimeoutMs: 1000,
              portEnvVar: 'APP_PORT',
            },
            testCommands: ['bun run e2e'],
            discoverAgentTests: false,
          },
        },
      });
    });
  });

  it('removes setup env files before saving the setup contract', async () => {
    useAppStore.setState({
      projectSettingsModalOpen: true,
      projectSettingsModalProjectId: project.id,
      projectSettingsModalInitialTab: 'setup',
    });
    mockProjectSettingsInvoke({
      'project:get-setup': {
        inspection: {
          status: 'valid',
          path: '/tmp/shipcode/.shipcode/setup.json',
          contract: {
            version: 1,
            setupCommands: [],
            verifyCommands: ['bun test'],
            envFiles: [{ source: '.env.local', target: '.env.test', required: true }],
            setupBeforeVerify: false,
            testingContext: null,
          },
          error: null,
        },
        profiles: [],
        suggestedContract: {
          version: 1,
          setupCommands: [],
          verifyCommands: [],
          envFiles: [],
          setupBeforeVerify: false,
          testingContext: null,
        },
      },
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('project:save-setup', {
        projectId: project.id,
        contract: expect.objectContaining({
          envFiles: [],
          verifyCommands: ['bun test'],
        }),
      });
    });
  });

  it('saves notification override fields from the notifications tab', async () => {
    useAppStore.setState({
      projectSettingsModalOpen: true,
      projectSettingsModalProjectId: project.id,
      projectSettingsModalInitialTab: 'notifications',
    });
    const notificationProject = {
      ...project,
      discordRouting: 'custom' as const,
      discordWebhookUrlOverride: 'https://discord.com/api/webhooks/old',
      telegramRouting: 'custom' as const,
      telegramChatIdOverride: '-100',
      notifyGithubUser: 'old-user',
    };
    mockProjectSettingsInvoke({
      'project:get': notificationProject,
    });

    renderWithProviders();

    fireEvent.change(await screen.findByPlaceholderText('https://discord.com/api/webhooks/...'), {
      target: { value: 'https://discord.com/api/webhooks/new' },
    });
    fireEvent.change(screen.getByPlaceholderText('-1001234567890'), {
      target: { value: '-200' },
    });
    fireEvent.change(screen.getByLabelText('Issue rewrite @mention'), {
      target: { value: 'decod3rs' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('project:set-notification-routing', {
        projectId: project.id,
        routing: {
          discordRouting: 'custom',
          discordWebhookUrlOverride: 'https://discord.com/api/webhooks/new',
          telegramRouting: 'custom',
          telegramChatIdOverride: '-200',
        },
      });
      expect(invokeMock).toHaveBeenCalledWith('project:set-notify-github-user', {
        projectId: project.id,
        handle: 'decod3rs',
      });
    });
  });

  it('shows setup save failures when setup persistence rejects', async () => {
    useAppStore.setState({
      projectSettingsModalOpen: true,
      projectSettingsModalProjectId: project.id,
      projectSettingsModalInitialTab: 'setup',
    });
    mockProjectSettingsInvoke({
      'project:get-setup': {
        inspection: {
          status: 'valid',
          path: '/tmp/shipcode/.shipcode/setup.json',
          contract: {
            version: 1,
            setupCommands: ['bun install'],
            verifyCommands: ['bun test'],
            envFiles: [],
            setupBeforeVerify: false,
            testingContext: 'Existing context',
          },
          error: null,
        },
        profiles: [],
        suggestedContract: {
          version: 1,
          setupCommands: [],
          verifyCommands: [],
          envFiles: [],
          setupBeforeVerify: false,
          testingContext: null,
        },
      },
      'project:save-setup': () => {
        throw new Error('setup file is read only\nfull trace');
      },
    });

    renderWithProviders();

    fireEvent.change(await screen.findByLabelText('Setup commands'), {
      target: { value: 'bun install' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));

    expect(await screen.findAllByText('setup file is read only')).toHaveLength(2);
  });

  it('renders the triage rules editor when the Triage rules tab is selected', async () => {
    mockProjectSettingsInvoke({ 'project:list-triage-rules': [] });

    renderWithProviders();
    await screen.findByText('Project Settings');

    fireEvent.click(await screen.findByRole('button', { name: 'Triage rules' }));

    expect(
      await screen.findByText(/Rules run once for each newly discovered GitHub issue/i),
    ).toBeInTheDocument();
  });
});
