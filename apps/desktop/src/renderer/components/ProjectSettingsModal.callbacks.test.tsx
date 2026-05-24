// @vitest-environment jsdom

import { DEFAULT_SETTINGS, type IntegrationStatus, type Project } from '@shipcode/shared';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { renderWithQueryClient } from '../test/render';

vi.mock('electron-log/renderer', () => ({
  default: {
    error: vi.fn(),
  },
}));

vi.mock('./SettingsNavigation', () => ({
  SettingsNavigation: ({
    items,
    activeKey,
    onSelect,
  }: {
    items: Array<{ key: string; label: string }>;
    activeKey: string;
    onSelect: (key: string) => void;
  }) => (
    <nav aria-label="settings navigation">
      {items.map((item) => (
        <button
          aria-pressed={activeKey === item.key}
          key={item.key}
          onClick={() => onSelect(item.key)}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </nav>
  ),
}));

vi.mock('./project-settings-modal/ProjectSettingsGeneralTab', () => ({
  ProjectSettingsGeneralTab: (props: {
    setNameInput: (value: string) => void;
    setUrlInput: (value: string) => void;
    setTouched: (value: boolean) => void;
    onRelink: () => void;
    onSync: () => void;
    onSetDefaultBranch: (branch: string) => void;
    onRefreshBranches: () => void;
    onRefreshGitRemote: () => void;
  }) => (
    <div>
      <button onClick={() => props.setNameInput('Renamed')} type="button">
        set name
      </button>
      <button
        onClick={() => props.setUrlInput('https://github.com/orgs/acme/projects/2')}
        type="button"
      >
        set url
      </button>
      <button onClick={() => props.setTouched(true)} type="button">
        touch
      </button>
      <button onClick={props.onRelink} type="button">
        relink
      </button>
      <button onClick={props.onSync} type="button">
        sync
      </button>
      <button onClick={() => props.onSetDefaultBranch('develop')} type="button">
        set branch
      </button>
      <button onClick={props.onRefreshBranches} type="button">
        refresh branches
      </button>
      <button onClick={props.onRefreshGitRemote} type="button">
        refresh remote
      </button>
    </div>
  ),
}));

vi.mock('./project-settings-modal/ProjectSettingsSetupTab', () => ({
  ProjectSettingsSetupTab: (props: {
    setSetupCommandsText: (value: string) => void;
    setVerifyCommandsText: (value: string) => void;
    setTestingContext: (value: string) => void;
    setRuntimeQaServerCommand: (value: string) => void;
    setRuntimeQaReadinessUrl: (value: string) => void;
    setRuntimeQaStartupTimeoutMs: (value: number) => void;
    setRuntimeQaPortEnvVar: (value: string) => void;
    setRuntimeQaTestCommandsText: (value: string) => void;
    setRuntimeQaDiscoverAgentTests: (value: boolean) => void;
    setSetupBeforeVerify: (value: boolean) => void;
    addEnvFile: () => void;
    updateEnvFile: (
      id: string,
      patch: { source?: string; target?: string; required?: boolean },
    ) => void;
    removeEnvFile: (id: string) => void;
    onRedetect: () => void;
    onApplyDetectedProfile: (profile: {
      suggestedContract: {
        version: 1;
        setupCommands: string[];
        verifyCommands: string[];
        envFiles: [];
        setupBeforeVerify: boolean;
        testingContext: string | null;
      };
    }) => void;
  }) => (
    <div>
      <button
        onClick={() => {
          props.setSetupCommandsText('bun install');
          props.setVerifyCommandsText('bun test');
          props.setTestingContext('Use Bun.');
          props.setRuntimeQaServerCommand('bun dev');
          props.setRuntimeQaReadinessUrl('http://127.0.0.1:$PORT');
          props.setRuntimeQaStartupTimeoutMs(1200);
          props.setRuntimeQaPortEnvVar('APP_PORT');
          props.setRuntimeQaTestCommandsText('bun e2e');
          props.setRuntimeQaDiscoverAgentTests(false);
          props.setSetupBeforeVerify(true);
        }}
        type="button"
      >
        edit setup
      </button>
      <button
        onClick={() => {
          props.addEnvFile();
          props.updateEnvFile('missing-id', { source: '.env.local', required: false });
          props.removeEnvFile('missing-id');
        }}
        type="button"
      >
        edit env files
      </button>
      <button
        onClick={() =>
          props.onApplyDetectedProfile({
            suggestedContract: {
              version: 1,
              setupCommands: ['npm install'],
              verifyCommands: ['npm test'],
              envFiles: [],
              setupBeforeVerify: true,
              testingContext: 'Node profile',
            },
          })
        }
        type="button"
      >
        apply profile
      </button>
      <button onClick={props.onRedetect} type="button">
        redetect
      </button>
    </div>
  ),
}));

vi.mock('./project-settings-modal/ProjectSettingsPipelineTab', () => ({
  ProjectSettingsPipelineTab: (props: { onResetIssueOverrides: () => void }) => (
    <button onClick={props.onResetIssueOverrides} type="button">
      reset issue overrides
    </button>
  ),
}));

vi.mock('./project-settings-modal/ProjectSettingsModelsTab', () => ({
  ProjectSettingsModelsTab: (props: {
    onApplyPreset: (preset: 'claude') => void;
    setModelValidation: (
      updater: (current: Record<string, unknown>) => Record<string, unknown>,
    ) => void;
  }) => (
    <div>
      <button onClick={() => props.onApplyPreset('claude')} type="button">
        apply model preset
      </button>
      <button
        onClick={() => props.setModelValidation((current) => ({ ...current, planner: null }))}
        type="button"
      >
        update validation
      </button>
    </div>
  ),
}));

vi.mock('./project-settings-modal/ProjectSettingsGitHubTab', () => ({
  ProjectSettingsGitHubTab: () => <div>github tab</div>,
}));

vi.mock('./project-settings-modal/ProjectSettingsContextTab', () => ({
  ProjectSettingsContextTab: (props: {
    setContextGeneratorCli: (value: 'claude' | 'codex') => void;
    onGenerateContext: () => void;
    contextError: string | null;
  }) => (
    <div>
      <button onClick={() => props.setContextGeneratorCli('codex')} type="button">
        use codex
      </button>
      <button onClick={props.onGenerateContext} type="button">
        generate context
      </button>
      {props.contextError ? <div>{props.contextError}</div> : null}
    </div>
  ),
}));

vi.mock('./project-settings-modal/ProjectSettingsNotificationsTab', () => ({
  ProjectSettingsNotificationsTab: (props: {
    onDiscordRoutingChange: (value: 'custom') => void;
    onDiscordWebhookChange: (value: string) => void;
    onTelegramRoutingChange: (value: 'custom') => void;
    onTelegramChatIdChange: (value: string) => void;
    onNotifyGithubUserChange: (value: string) => void;
  }) => (
    <div>
      <button onClick={() => props.onDiscordRoutingChange('custom')} type="button">
        discord custom
      </button>
      <button
        onClick={() => props.onDiscordWebhookChange('https://discord.test/webhook')}
        type="button"
      >
        discord webhook
      </button>
      <button onClick={() => props.onTelegramRoutingChange('custom')} type="button">
        telegram custom
      </button>
      <button onClick={() => props.onTelegramChatIdChange('-200')} type="button">
        telegram chat
      </button>
      <button onClick={() => props.onNotifyGithubUserChange('decod3rs')} type="button">
        notify user
      </button>
    </div>
  ),
}));

const { ProjectSettingsModal } = await import('./ProjectSettingsModal');

describe('ProjectSettingsModal callback surfaces', () => {
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
  const integrationStatus: IntegrationStatus = {
    system: {
      claude: {
        available: true,
        version: 'claude',
        path: '/bin/claude',
        error: null,
        authenticated: true,
      },
      codex: {
        available: true,
        version: 'codex',
        path: '/bin/codex',
        error: null,
        authenticated: true,
      },
      git: { available: true, version: 'git', path: '/bin/git', error: null, authenticated: false },
      gh: { available: true, version: 'gh', path: '/bin/gh', error: null, authenticated: true },
    },
    ghAuth: {
      installed: true,
      authenticated: true,
      username: 'decod3rs',
      version: '2.0.0',
      error: null,
      hasProjectScope: true,
    },
    openrouter: {
      enabled: false,
      keyPresent: false,
      authStatus: 'missing_key',
      message: null,
      label: null,
      modelChecks: [],
    },
    discord: {
      enabled: false,
      configured: false,
      destinationConfigured: false,
      validationStatus: 'missing',
      message: null,
      lastDeliveryStatus: null,
    },
    telegram: {
      enabled: false,
      configured: false,
      destinationConfigured: false,
      validationStatus: 'missing',
      message: null,
      lastDeliveryStatus: null,
    },
    desktopApps: {},
  } as unknown as IntegrationStatus;

  beforeEach(() => {
    cleanup();
    invokeMock.mockReset();
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return project;
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'integrations:check') return integrationStatus;
      if (channel === 'memory:list') return { files: [] };
      if (channel === 'git:list-branches') return ['main', 'develop'];
      if (channel === 'project:get-setup') {
        return {
          inspection: {
            status: 'missing',
            path: '/tmp/shipcode/.shipcode/setup.json',
            contract: null,
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
        };
      }
      if (channel === 'dialog:open-directory') return '/tmp/relinked';
      if (channel === 'project:relink-path') return { ...project, path: '/tmp/relinked' };
      if (channel === 'github:sync-to-project-board')
        return { attached: 1, alreadyPresent: 0, failed: 0, errors: [] };
      if (channel === 'project:set-default-branch') return { ...project, defaultBranch: 'develop' };
      if (channel === 'project:refresh-git-remote')
        return { project, remote: project.gitRemote, changed: false };
      if (channel === 'github:clear-all-phase-overrides-for-project') return { clearedCount: 0 };
      if (channel === 'memory:generate') return { success: false };
      if (channel === 'project:set-name') return project;
      if (channel === 'project:set-github-project-url') return project;
      if (channel === 'project:set-notification-routing') return project;
      if (channel === 'project:set-notify-github-user') return project;
      if (channel === 'project:set-model-overrides') return project;
      if (channel === 'project:save-setup') return undefined;
      return null;
    });
    useAppStore.setState({
      projectSettingsModalOpen: true,
      projectSettingsModalProjectId: project.id,
      projectSettingsModalInitialTab: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderModal() {
    return renderWithQueryClient(<ProjectSettingsModal />);
  }

  it('exercises general tab mutation callbacks', async () => {
    renderModal();

    fireEvent.click(await screen.findByRole('button', { name: 'set branch' }));
    fireEvent.click(screen.getByRole('button', { name: 'refresh branches' }));
    fireEvent.click(screen.getByRole('button', { name: 'refresh remote' }));
    fireEvent.click(screen.getByRole('button', { name: 'relink' }));
    fireEvent.click(screen.getByRole('button', { name: 'sync' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('project:set-default-branch', {
        projectId: project.id,
        branch: 'develop',
      });
      expect(invokeMock).toHaveBeenCalledWith('git:list-branches', {
        projectId: project.id,
        fetch: true,
      });
      expect(invokeMock).toHaveBeenCalledWith('project:refresh-git-remote', {
        projectId: project.id,
      });
      expect(invokeMock).toHaveBeenCalledWith('project:relink-path', {
        projectId: project.id,
        path: '/tmp/relinked',
      });
      expect(invokeMock).toHaveBeenCalledWith('github:sync-to-project-board', {
        projectId: project.id,
      });
    });
  });

  it('exercises setup, model, context, notification, and save callbacks', async () => {
    renderModal();

    fireEvent.click(await screen.findByRole('button', { name: 'Setup' }));
    fireEvent.click(screen.getByRole('button', { name: 'edit setup' }));
    fireEvent.click(screen.getByRole('button', { name: 'edit env files' }));
    fireEvent.click(screen.getByRole('button', { name: 'apply profile' }));
    fireEvent.click(screen.getByRole('button', { name: 'redetect' }));

    fireEvent.click(screen.getByRole('button', { name: 'Models' }));
    fireEvent.click(screen.getByRole('button', { name: 'apply model preset' }));
    fireEvent.click(screen.getByRole('button', { name: 'update validation' }));

    fireEvent.click(screen.getByRole('button', { name: 'Memory' }));
    fireEvent.click(screen.getByRole('button', { name: 'use codex' }));
    fireEvent.click(screen.getByRole('button', { name: 'generate context' }));
    expect(await screen.findByText('Generation failed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    fireEvent.click(screen.getByRole('button', { name: 'discord custom' }));
    fireEvent.click(screen.getByRole('button', { name: 'discord webhook' }));
    fireEvent.click(screen.getByRole('button', { name: 'telegram custom' }));
    fireEvent.click(screen.getByRole('button', { name: 'telegram chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'notify user' }));

    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('memory:generate', {
        projectId: project.id,
        cli: 'codex',
      });
      expect(invokeMock).toHaveBeenCalledWith('project:set-notification-routing', {
        projectId: project.id,
        routing: {
          discordRouting: 'custom',
          discordWebhookUrlOverride: 'https://discord.test/webhook',
          telegramRouting: 'custom',
          telegramChatIdOverride: '-200',
        },
      });
      expect(invokeMock).toHaveBeenCalledWith('project:set-notify-github-user', {
        projectId: project.id,
        handle: 'decod3rs',
      });
      expect(invokeMock).toHaveBeenCalledWith('project:save-setup', expect.any(Object));
    });
  });

  it('evaluates Codex memory generator unavailable state', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return project;
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'integrations:check') {
        return {
          ...integrationStatus,
          system: {
            ...integrationStatus.system,
            codex: {
              ...integrationStatus.system.codex,
              available: false,
              authenticated: false,
            },
          },
        };
      }
      if (channel === 'memory:list') return { files: [] };
      if (channel === 'git:list-branches') return ['main'];
      if (channel === 'project:get-setup') {
        return {
          inspection: {
            status: 'missing',
            path: '/tmp/shipcode/.shipcode/setup.json',
            contract: null,
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
        };
      }
      return null;
    });
    useAppStore.setState({ projectSettingsModalInitialTab: 'context' });

    renderModal();

    fireEvent.click(await screen.findByRole('button', { name: 'use codex' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'generate context' })).toBeInTheDocument();
    });
  });

  it('handles reset confirmation and Escape through the mocked pipeline tab', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    useAppStore.setState({ projectSettingsModalInitialTab: 'pipeline' });
    renderModal();

    fireEvent.click(await screen.findByRole('button', { name: 'reset issue overrides' }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:clear-all-phase-overrides-for-project', {
        projectId: project.id,
      });
    });

    fireEvent.keyDown(screen.getByText('Project Settings'), { key: 'Escape' });
    expect(useAppStore.getState().projectSettingsModalOpen).toBe(false);
    confirmSpy.mockRestore();
  });
});
