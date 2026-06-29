// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type {
  AppSettings,
  ContextFileInfo,
  IntegrationStatus,
  OpenRouterModelValidation,
  Project,
  ProjectReadinessReport,
} from '@shipcode/shared';
import {
  buildProjectModelPresetOverrides,
  DEFAULT_SETTINGS,
  PIPELINE_EXECUTOR_PROVIDERS,
  SHIPCODE_DEFAULT_LABELS,
} from '@shipcode/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithQueryClient } from '../../test/render';
import { ProjectPhaseSettingsRow } from './ProjectPhaseSettingsRow';
import { ProjectSettingsContextTab } from './ProjectSettingsContextTab';
import { ProjectSettingsGeneralTab } from './ProjectSettingsGeneralTab';
import { ProjectSettingsGitHubTab } from './ProjectSettingsGitHubTab';
import { ProjectSettingsModelsTab } from './ProjectSettingsModelsTab';
import { ProjectSettingsNotificationsTab } from './ProjectSettingsNotificationsTab';
import { ProjectSettingsPipelineTab } from './ProjectSettingsPipelineTab';
import { ProjectSettingsSetupTab } from './ProjectSettingsSetupTab';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'ShipCode',
    path: '/tmp/shipcode',
    pathExists: false,
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
    discordRouting: 'inherit',
    discordWebhookUrlOverride: null,
    telegramRouting: 'inherit',
    telegramChatIdOverride: null,
    defaultBranch: 'main',
    pinned: false,
    archived: false,
    hidden: false,
    notifyGithubUser: null,
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

const integrationStatus: IntegrationStatus = {
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
      authenticated: true,
    },
    gh: {
      available: true,
      version: 'gh version 2.40.1',
      path: '/usr/local/bin/gh',
      error: null,
      authenticated: true,
    },
  },
  ghAuth: {
    installed: true,
    authenticated: true,
    username: 'decod3rs',
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

describe('project settings leaf tabs', () => {
  it('renders context file status and generator states', () => {
    const setContextGeneratorCli = vi.fn();
    const onGenerateContext = vi.fn();
    const contextFiles: ContextFileInfo[] = [
      { name: 'goal.md', exists: true, size: 1200 },
      { name: 'architecture.md', exists: true, size: 900 },
      { name: 'constraints.md', exists: false },
      { name: 'do-dont.md', exists: false },
    ];

    render(
      <ProjectSettingsContextTab
        contextFiles={contextFiles}
        contextGeneratorCli="claude"
        setContextGeneratorCli={setContextGeneratorCli}
        contextGenerating={false}
        contextCliUnavailableReason={null}
        contextError="Generator failed"
        cliOptions={[
          { value: 'claude', label: 'Claude CLI', disabledReason: null },
          { value: 'codex', label: 'Codex CLI', disabledReason: 'Not installed' },
        ]}
        onGenerateContext={onGenerateContext}
      />,
    );

    expect(screen.getByText('Memory Files')).toBeInTheDocument();
    expect(screen.getByText('goal.md')).toBeInTheDocument();
    expect(screen.getByText('1.2 KB')).toBeInTheDocument();
    expect(screen.getByText('900 B')).toBeInTheDocument();
    expect(screen.getByText('Generator failed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Generate Memory' }));
    expect(onGenerateContext).toHaveBeenCalledTimes(1);

    cleanup();

    render(
      <ProjectSettingsContextTab
        contextFiles={contextFiles}
        contextGeneratorCli="codex"
        setContextGeneratorCli={setContextGeneratorCli}
        contextGenerating={true}
        contextCliUnavailableReason="Codex unavailable"
        contextError={null}
        cliOptions={[
          { value: 'claude', label: 'Claude CLI', disabledReason: null },
          { value: 'codex', label: 'Codex CLI', disabledReason: 'Not installed' },
        ]}
        onGenerateContext={onGenerateContext}
      />,
    );

    expect(screen.getByRole('button', { name: 'Generate Memory' })).toBeDisabled();
  });

  it('renders general project state and forwards input and button actions', () => {
    const setNameInput = vi.fn();
    const setUrlInput = vi.fn();
    const setTouched = vi.fn();
    const onRelink = vi.fn();
    const onSync = vi.fn();

    render(
      <ProjectSettingsGeneralTab
        project={makeProject()}
        nameInput="ShipCode"
        setNameInput={setNameInput}
        urlInput="https://github.com/orgs/shipshitdev/projects/1"
        setUrlInput={setUrlInput}
        setTouched={setTouched}
        nameError={null}
        showInlineError={true}
        validationOk={false}
        validationReason="Not a valid project URL"
        relinkPending={false}
        relinkError="Folder lookup failed"
        onRelink={onRelink}
        canSync={true}
        syncLocked={false}
        syncPending={false}
        syncResult={{
          attached: 2,
          alreadyPresent: 1,
          failed: 0,
          errors: [],
        }}
        syncError={null}
        hasSavedUrl={true}
        inputMatchesSaved={true}
        onSync={onSync}
        branches={[]}
        onSetDefaultBranch={vi.fn()}
        setDefaultBranchPending={false}
        onRefreshBranches={vi.fn()}
        refreshBranchesPending={false}
        onRefreshGitRemote={vi.fn()}
        refreshGitRemotePending={false}
      />,
    );

    expect(screen.getByText(/This path is missing\./)).toBeInTheDocument();
    expect(screen.getByText('Folder lookup failed')).toBeInTheDocument();
    expect(screen.getByText('Not a valid project URL')).toBeInTheDocument();
    expect(screen.getByText(/Attached 2, already present 1/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Gateway Remastered' },
    });
    fireEvent.change(screen.getByLabelText('GitHub Projects board URL'), {
      target: { value: 'https://github.com/orgs/shipshitdev/projects/2' },
    });
    fireEvent.blur(screen.getByLabelText('GitHub Projects board URL'));

    fireEvent.click(screen.getByRole('button', { name: /Change folder/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Sync existing issues to board' }));

    expect(setNameInput).toHaveBeenCalledWith('Gateway Remastered');
    expect(setUrlInput).toHaveBeenCalledWith('https://github.com/orgs/shipshitdev/projects/2');
    expect(setTouched).toHaveBeenCalledWith(true);
    expect(onRelink).toHaveBeenCalledTimes(1);
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it('disables board sync after a failed attach result', () => {
    render(
      <ProjectSettingsGeneralTab
        project={makeProject()}
        nameInput="ShipCode"
        setNameInput={vi.fn()}
        urlInput="https://github.com/orgs/shipshitdev/projects/1"
        setUrlInput={vi.fn()}
        setTouched={vi.fn()}
        nameError={null}
        showInlineError={false}
        validationOk={true}
        validationReason={null}
        relinkPending={false}
        relinkError={null}
        onRelink={vi.fn()}
        canSync={false}
        syncLocked={true}
        syncPending={false}
        syncResult={{
          attached: 0,
          alreadyPresent: 0,
          failed: 1,
          errors: ['#20: resource not found'],
        }}
        syncError={null}
        hasSavedUrl={true}
        inputMatchesSaved={true}
        onSync={vi.fn()}
        branches={[]}
        onSetDefaultBranch={vi.fn()}
        setDefaultBranchPending={false}
        onRefreshBranches={vi.fn()}
        refreshBranchesPending={false}
        onRefreshGitRemote={vi.fn()}
        refreshGitRemotePending={false}
      />,
    );

    const syncButton = screen.getByRole('button', { name: 'Sync existing issues to board' });
    expect(syncButton).toBeDisabled();
    expect(syncButton).toHaveAttribute(
      'title',
      'Board sync is disabled after a failed attach. Fix the repo or board config, then reopen Project Settings to retry.',
    );
    expect(screen.getByText(/Attached 0, already present 0, failed 1/)).toBeInTheDocument();
    expect(screen.getByText(/#20: resource not found/)).toBeInTheDocument();
  });

  it('renders detected setup profiles as apply buttons', () => {
    const setSetupCommandsText = vi.fn();
    const setVerifyCommandsText = vi.fn();
    const setTestingContext = vi.fn();
    const setRuntimeQaServerCommand = vi.fn();
    const setRuntimeQaReadinessUrl = vi.fn();
    const setRuntimeQaStartupTimeoutMs = vi.fn();
    const setRuntimeQaPortEnvVar = vi.fn();
    const setRuntimeQaTestCommandsText = vi.fn();
    const setRuntimeQaDiscoverAgentTests = vi.fn();
    const setSetupBeforeVerify = vi.fn();
    const addEnvFile = vi.fn();
    const updateEnvFile = vi.fn();
    const removeEnvFile = vi.fn();
    const onRedetect = vi.fn();
    const onApplyDetectedProfile = vi.fn();

    render(
      <ProjectSettingsSetupTab
        setupCommandsText=""
        setSetupCommandsText={setSetupCommandsText}
        verifyCommandsText=""
        setVerifyCommandsText={setVerifyCommandsText}
        testingContext=""
        setTestingContext={setTestingContext}
        runtimeQaServerCommand=""
        setRuntimeQaServerCommand={setRuntimeQaServerCommand}
        runtimeQaReadinessUrl=""
        setRuntimeQaReadinessUrl={setRuntimeQaReadinessUrl}
        runtimeQaStartupTimeoutMs={60_000}
        setRuntimeQaStartupTimeoutMs={setRuntimeQaStartupTimeoutMs}
        runtimeQaPortEnvVar="PORT"
        setRuntimeQaPortEnvVar={setRuntimeQaPortEnvVar}
        runtimeQaTestCommandsText=""
        setRuntimeQaTestCommandsText={setRuntimeQaTestCommandsText}
        runtimeQaDiscoverAgentTests={true}
        setRuntimeQaDiscoverAgentTests={setRuntimeQaDiscoverAgentTests}
        setupBeforeVerify={false}
        setSetupBeforeVerify={setSetupBeforeVerify}
        envFiles={[]}
        addEnvFile={addEnvFile}
        updateEnvFile={updateEnvFile}
        removeEnvFile={removeEnvFile}
        detectedProfiles={[
          {
            kind: 'bun',
            label: 'Bun',
            recommended: true,
            evidence: ['package.json', 'bun.lock'],
            suggestedContract: {
              version: 1,
              setupCommands: ['bun install --frozen-lockfile'],
              verifyCommands: ['bun run test'],
              envFiles: [],
              setupBeforeVerify: false,
              testingContext: 'Detected bun scripts.',
            },
          },
          {
            kind: 'npm',
            label: 'npm',
            recommended: false,
            evidence: ['package.json'],
            suggestedContract: {
              version: 1,
              setupCommands: ['npm ci'],
              verifyCommands: ['npm run test'],
              envFiles: [],
              setupBeforeVerify: false,
              testingContext: 'Detected npm scripts.',
            },
          },
        ]}
        inspection={{
          status: 'missing',
          path: '/tmp/shipcode/.shipcode/setup.json',
          contract: null,
          error: null,
        }}
        projectPath="/tmp/shipcode"
        pathExists={true}
        submitError={null}
        onRedetect={onRedetect}
        onApplyDetectedProfile={onApplyDetectedProfile}
        detectPending={false}
      />,
    );

    expect(
      screen.getByText(/Click a detected profile to fill the commands below/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Bun recommended' }));
    fireEvent.click(screen.getByRole('button', { name: 'Re-detect' }));

    expect(onApplyDetectedProfile).toHaveBeenCalledTimes(1);
    expect(onApplyDetectedProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'bun',
      }),
    );
    expect(onRedetect).toHaveBeenCalledTimes(1);
  });

  it('renders setup missing-folder and env-file editing branches', () => {
    const baseProps = {
      setupCommandsText: 'bun install',
      setSetupCommandsText: vi.fn(),
      verifyCommandsText: 'bun test',
      setVerifyCommandsText: vi.fn(),
      testingContext: 'Use vitest.',
      setTestingContext: vi.fn(),
      runtimeQaServerCommand: 'bun dev',
      setRuntimeQaServerCommand: vi.fn(),
      runtimeQaReadinessUrl: 'http://127.0.0.1:$PORT',
      setRuntimeQaReadinessUrl: vi.fn(),
      runtimeQaStartupTimeoutMs: 60_000,
      setRuntimeQaStartupTimeoutMs: vi.fn(),
      runtimeQaPortEnvVar: 'PORT',
      setRuntimeQaPortEnvVar: vi.fn(),
      runtimeQaTestCommandsText: 'bun e2e',
      setRuntimeQaTestCommandsText: vi.fn(),
      runtimeQaDiscoverAgentTests: false,
      setRuntimeQaDiscoverAgentTests: vi.fn(),
      setupBeforeVerify: true,
      setSetupBeforeVerify: vi.fn(),
      envFiles: [
        {
          id: 'env-1',
          source: '.env.example',
          target: '.env',
          required: false,
        },
      ],
      addEnvFile: vi.fn(),
      updateEnvFile: vi.fn(),
      removeEnvFile: vi.fn(),
      detectedProfiles: [],
      inspection: {
        status: 'invalid' as const,
        path: '/tmp/shipcode/.shipcode/setup.json',
        contract: null,
        error: 'bad json',
      },
      projectPath: '/tmp/shipcode',
      pathExists: true,
      submitError: 'Save failed',
      onRedetect: vi.fn(),
      onApplyDetectedProfile: vi.fn(),
      detectPending: true,
    };

    const { rerender } = render(<ProjectSettingsSetupTab {...baseProps} pathExists={false} />);
    expect(screen.getByText(/repository folder is missing/)).toBeInTheDocument();

    rerender(<ProjectSettingsSetupTab {...baseProps} />);

    expect(screen.getByText('Existing setup file is invalid: bad json')).toBeInTheDocument();
    expect(screen.getByText('Save failed')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Setup commands'), { target: { value: 'bun i' } });
    fireEvent.change(screen.getByLabelText('Verify commands'), { target: { value: 'bun check' } });
    fireEvent.change(screen.getByLabelText('Testing context'), {
      target: { value: 'Run unit tests first.' },
    });
    fireEvent.change(screen.getByLabelText('Start command'), { target: { value: 'bun preview' } });
    fireEvent.change(screen.getByLabelText('Readiness URL'), {
      target: { value: 'http://localhost:3000' },
    });
    fireEvent.change(screen.getByLabelText('Runtime test commands'), {
      target: { value: 'bun playwright' },
    });
    fireEvent.change(screen.getByLabelText('Startup timeout ms'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Port env var'), { target: { value: 'APP_PORT' } });
    fireEvent.click(screen.getByLabelText('Discover agent runtime tests'));
    fireEvent.change(screen.getByDisplayValue('.env.example'), { target: { value: '.env.local' } });
    fireEvent.change(screen.getByDisplayValue('.env'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Required'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add env file' }));
    fireEvent.click(screen.getByLabelText('Setup before verification'));

    expect(baseProps.setSetupCommandsText).toHaveBeenCalledWith('bun i');
    expect(baseProps.setVerifyCommandsText).toHaveBeenCalledWith('bun check');
    expect(baseProps.setTestingContext).toHaveBeenCalledWith('Run unit tests first.');
    expect(baseProps.setRuntimeQaServerCommand).toHaveBeenCalledWith('bun preview');
    expect(baseProps.setRuntimeQaReadinessUrl).toHaveBeenCalledWith('http://localhost:3000');
    expect(baseProps.setRuntimeQaTestCommandsText).toHaveBeenCalledWith('bun playwright');
    expect(baseProps.setRuntimeQaStartupTimeoutMs).toHaveBeenCalledWith(60_000);
    expect(baseProps.setRuntimeQaPortEnvVar).toHaveBeenCalledWith('APP_PORT');
    expect(baseProps.setRuntimeQaDiscoverAgentTests).toHaveBeenCalledWith(true);
    expect(baseProps.updateEnvFile).toHaveBeenCalledWith('env-1', { source: '.env.local' });
    expect(baseProps.updateEnvFile).toHaveBeenCalledWith('env-1', { target: undefined });
    expect(baseProps.updateEnvFile).toHaveBeenCalledWith('env-1', { required: true });
    expect(baseProps.removeEnvFile).toHaveBeenCalledWith('env-1');
    expect(baseProps.addEnvFile).toHaveBeenCalledTimes(1);
    expect(baseProps.setSetupBeforeVerify).toHaveBeenCalledWith(false);
  });

  it('renders pipeline overrides and forwards the reset callback', () => {
    const onResetIssueOverrides = vi.fn();
    const setOverrides = vi.fn();
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      openrouterDefaultPaidModel: 'openrouter/auto',
    };

    render(
      <ProjectSettingsPipelineTab
        settings={settings}
        overrides={{
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
          prdQualityGate: null,
          discordRouting: 'inherit',
          discordWebhookUrlOverride: null,
          telegramRouting: 'inherit',
          telegramChatIdOverride: null,
        }}
        setOverrides={setOverrides}
        onResetIssueOverrides={onResetIssueOverrides}
        issueOverrideResetPending={false}
        issueOverrideResetResult="Reset issue overrides on 2 issues."
        issueOverrideResetError={null}
      />,
    );

    expect(screen.getByText('Runtime Capacity')).toBeInTheDocument();
    expect(screen.getByText(/Execution slots are per project/)).toBeInTheDocument();
    expect(screen.getByText(/3 execution slots\/project/i)).toBeInTheDocument();
    expect(screen.getByText('Human Approval')).toBeInTheDocument();
    expect(screen.getByText('PRD Quality Gate')).toBeInTheDocument();
    expect(screen.getByText('Reset issue overrides on 2 issues.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset All Issue Overrides' }));

    expect(onResetIssueOverrides).toHaveBeenCalledTimes(1);
  });

  it('renders pipeline singular capacity, explicit overrides, pending reset, and reset errors', () => {
    const onResetIssueOverrides = vi.fn();
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      maxConcurrentPipelines: 1,
      maxConcurrentExecutions: 1,
      requireApproval: false,
      pipelineSpeedProfile: 'thorough',
      revisionCount: 0,
    };

    render(
      <ProjectSettingsPipelineTab
        settings={settings}
        overrides={{
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
          pipelineSpeedProfileOverride: 'smart_fast',
          revisionCountOverride: 5,
          requireApprovalOverride: true,
          prdQualityGate: false,
          discordRouting: 'inherit',
          discordWebhookUrlOverride: null,
          telegramRouting: 'inherit',
          telegramChatIdOverride: null,
        }}
        setOverrides={vi.fn()}
        onResetIssueOverrides={onResetIssueOverrides}
        issueOverrideResetPending={true}
        issueOverrideResetResult={null}
        issueOverrideResetError="Reset failed"
      />,
    );

    expect(screen.getByText('1 pipeline')).toBeInTheDocument();
    expect(screen.getByText(/1 execution slot\/project/i)).toBeInTheDocument();
    expect(screen.getByText('Reset failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reset All Issue Overrides/ })).toBeDisabled();
  });

  it('renders notification routing overrides and forwards edits', () => {
    const onDiscordRoutingChange = vi.fn();
    const onDiscordWebhookChange = vi.fn();
    const onTelegramRoutingChange = vi.fn();
    const onTelegramChatIdChange = vi.fn();
    const onNotifyGithubUserChange = vi.fn();

    render(
      <ProjectSettingsNotificationsTab
        discordRouting="custom"
        discordWebhookUrlOverride="https://discord.test/webhook"
        telegramRouting="custom"
        telegramChatIdOverride="-100"
        notifyGithubUser="decod3rs"
        onDiscordRoutingChange={onDiscordRoutingChange}
        onDiscordWebhookChange={onDiscordWebhookChange}
        onTelegramRoutingChange={onTelegramRoutingChange}
        onTelegramChatIdChange={onTelegramChatIdChange}
        onNotifyGithubUserChange={onNotifyGithubUserChange}
      />,
    );

    expect(screen.getByText(/ShipCode pipeline events/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('https://discord.com/api/webhooks/...'), {
      target: { value: 'https://discord.test/next' },
    });
    fireEvent.change(screen.getByPlaceholderText('-1001234567890'), {
      target: { value: '-200' },
    });
    fireEvent.change(screen.getByPlaceholderText('github-handle'), {
      target: { value: 'shipcode-bot' },
    });

    expect(onDiscordWebhookChange).toHaveBeenCalledWith('https://discord.test/next');
    expect(onTelegramChatIdChange).toHaveBeenCalledWith('-200');
    expect(onNotifyGithubUserChange).toHaveBeenCalledWith('shipcode-bot');
  });

  it('renders GitHub readiness and non-label metadata requirements', async () => {
    const readiness: ProjectReadinessReport = {
      ok: false,
      checkedAt: '2026-05-08T00:00:00.000Z',
      projectUrl: 'https://github.com/orgs/shipshitdev/projects/1',
      labelSync: {
        created: ['shipcode:agent:frontend'],
        alreadyPresent: [],
        failed: [],
      },
      labelNames: SHIPCODE_DEFAULT_LABELS.map((label) => label.name),
      statusMapping: null,
      items: [
        {
          key: 'shipcode-labels',
          kind: 'labels',
          label: 'ShipCode labels',
          required: true,
          status: 'ready',
          message: 'All ShipCode labels are present.',
        },
        {
          key: 'project-field:priority',
          kind: 'project-field',
          label: 'Priority',
          required: true,
          status: 'missing',
          message: 'Priority is missing options ShipCode writes.',
          missing: ['P0', 'P1', 'P2', 'P3'],
        },
      ],
    };
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'github:check-project-readiness') return readiness;
      return null;
    });
    window.shipcode = {
      ...window.shipcode,
      invoke: invoke as typeof window.shipcode.invoke,
    };

    renderWithQueryClient(
      <ProjectSettingsGitHubTab
        pathExists
        projectId="project-1"
        isActive
        statusMapping={null}
        hasProjectUrl
      />,
    );

    expect(await screen.findByText('Project readiness')).toBeInTheDocument();
    expect(screen.getByText('Priority')).toBeInTheDocument();
    expect(screen.getByText('P0')).toBeInTheDocument();
    expect(screen.getByText('Created 1 missing ShipCode label.')).toBeInTheDocument();
    expect(screen.getAllByText(/issue types and Projects fields/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  });

  it('renders detected and unmapped GitHub board status columns', async () => {
    const readiness: ProjectReadinessReport = {
      ok: true,
      checkedAt: '2026-05-08T00:00:00.000Z',
      projectUrl: 'https://github.com/orgs/shipshitdev/projects/1',
      labelSync: { created: [], alreadyPresent: [], failed: [] },
      labelNames: SHIPCODE_DEFAULT_LABELS.map((label) => label.name),
      statusMapping: {
        todo: { name: 'Backlog', color: null },
        inProgress: { name: 'In Progress', color: null },
        humanReview: null,
        done: { name: 'Done', color: null },
        deferred: null,
      },
      items: [
        {
          key: 'shipcode-labels',
          kind: 'labels',
          label: 'ShipCode labels',
          required: true,
          status: 'ready',
          message: 'All ShipCode labels are present.',
        },
      ],
    };
    window.shipcode = {
      ...window.shipcode,
      invoke: vi.fn(async () => readiness) as typeof window.shipcode.invoke,
    };

    renderWithQueryClient(
      <ProjectSettingsGitHubTab
        pathExists
        projectId="project-1"
        isActive
        statusMapping={null}
        hasProjectUrl
      />,
    );

    await waitFor(() => expect(screen.getAllByText('Backlog').length).toBeGreaterThan(1));
    expect(screen.getAllByText('In Progress').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Done').length).toBeGreaterThan(1);
    expect(screen.getAllByText('not mapped')).toHaveLength(2);
  });

  it('renders GitHub readiness disabled, error, and label sync states', async () => {
    const disabledInvoke = vi.fn();
    window.shipcode = {
      ...window.shipcode,
      invoke: disabledInvoke as typeof window.shipcode.invoke,
    };

    const missingPath = renderWithQueryClient(
      <ProjectSettingsGitHubTab
        pathExists={false}
        projectId="project-1"
        isActive={true}
        statusMapping={null}
        hasProjectUrl={true}
      />,
    );

    expect(screen.getByText(/repository folder is missing/i)).toBeInTheDocument();
    expect(disabledInvoke).not.toHaveBeenCalled();
    missingPath.unmount();

    const inactive = renderWithQueryClient(
      <ProjectSettingsGitHubTab
        pathExists={true}
        projectId="project-1"
        isActive={false}
        statusMapping={null}
        hasProjectUrl={true}
      />,
    );

    expect(screen.getByText(/Status field mapping not detected/)).toBeInTheDocument();
    expect(disabledInvoke).not.toHaveBeenCalled();
    inactive.unmount();

    const failedReadiness: ProjectReadinessReport = {
      ok: false,
      checkedAt: '2026-05-08T00:00:00.000Z',
      projectUrl: null,
      labelSync: {
        created: ['shipcode:agent:frontend', 'shipcode:agent:backend'],
        alreadyPresent: [],
        failed: [{ name: 'shipcode:agent:backend', error: 'permission denied' }],
      },
      labelNames: SHIPCODE_DEFAULT_LABELS.slice(0, -1).map((label) => label.name),
      statusMapping: null,
      items: [
        {
          key: 'shipcode-labels',
          kind: 'labels',
          label: 'ShipCode labels',
          required: true,
          status: 'warning',
          message: 'Some labels were repaired.',
          missing: ['shipcode:agent:backend'],
        },
        {
          key: 'project-field:priority',
          kind: 'project-field',
          label: 'Priority',
          required: false,
          status: 'missing',
          message: 'Optional priority metadata is missing.',
        },
      ],
    };
    window.shipcode = {
      ...window.shipcode,
      invoke: vi.fn(async () => failedReadiness) as typeof window.shipcode.invoke,
    };

    renderWithQueryClient(
      <ProjectSettingsGitHubTab
        pathExists={true}
        projectId="project-1"
        isActive={true}
        statusMapping={null}
        hasProjectUrl={false}
      />,
    );

    expect(await screen.findByText('Some labels were repaired.')).toBeInTheDocument();
    expect(screen.getByText('Optional priority metadata is missing.')).toBeInTheDocument();
    expect(screen.getByText(/Set a GitHub Project URL/)).toBeInTheDocument();
    expect(screen.getByText('Created 2 missing ShipCode labels.')).toBeInTheDocument();
    expect(screen.getByText('Failed labels:')).toBeInTheDocument();
    expect(screen.getByText('shipcode:agent:backend: permission denied')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sync 1 missing label' }));
    await waitFor(() => {
      expect(window.shipcode.invoke).toHaveBeenCalledTimes(2);
    });
  });

  it('renders GitHub readiness query failures', async () => {
    window.shipcode = {
      ...window.shipcode,
      invoke: vi.fn(async () => {
        throw new Error('readiness failed');
      }) as typeof window.shipcode.invoke,
    };

    renderWithQueryClient(
      <ProjectSettingsGitHubTab
        pathExists={true}
        projectId="project-1"
        isActive={true}
        statusMapping={null}
        hasProjectUrl={true}
      />,
    );

    expect(await screen.findAllByText('Error: readiness failed')).toHaveLength(2);
    expect(screen.getByText(/Status field mapping not detected/)).toBeInTheDocument();
  });

  it('renders model preset actions and forwards the apply callback', () => {
    const onApplyPreset = vi.fn();
    const setOverrides = vi.fn();
    const setModelValidation = vi.fn();
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      openrouterDefaultPaidModel: 'openrouter/auto',
    };

    const { rerender } = render(
      <ProjectSettingsModelsTab
        settings={settings}
        projectDraft={makeProject()}
        overrides={{
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
          prdQualityGate: null,
          discordRouting: 'inherit',
          discordWebhookUrlOverride: null,
          telegramRouting: 'inherit',
          telegramChatIdOverride: null,
        }}
        setOverrides={setOverrides}
        integrationStatus={integrationStatus}
        modelValidation={{}}
        setModelValidation={setModelValidation}
        onApplyPreset={onApplyPreset}
      />,
    );

    expect(screen.getByText('Model Presets')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply Preset' })).toBeInTheDocument();
    expect(screen.getByText('Planner')).toBeInTheDocument();
    expect(screen.getByText('Verifier')).toBeInTheDocument();

    expect(PIPELINE_EXECUTOR_PROVIDERS).toContain('gemini');

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Apply Preset' }));
    fireEvent.click(screen.getByText('Claude'));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Apply Preset' }));
    fireEvent.click(screen.getByText('Codex'));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Apply Preset' }));
    fireEvent.click(screen.getByText('Hybrid'));

    expect(onApplyPreset).toHaveBeenNthCalledWith(1, 'claude');
    expect(onApplyPreset).toHaveBeenNthCalledWith(2, 'codex');
    expect(onApplyPreset).toHaveBeenNthCalledWith(3, 'hybrid');

    rerender(
      <ProjectSettingsModelsTab
        settings={settings}
        projectDraft={makeProject()}
        overrides={{
          ...buildProjectModelPresetOverrides('codex'),
          revisionCountOverride: null,
          requireApprovalOverride: null,
          pipelineSpeedProfileOverride: null,
          prdQualityGate: null,
          discordRouting: 'inherit',
          discordWebhookUrlOverride: null,
          telegramRouting: 'inherit',
          telegramChatIdOverride: null,
        }}
        setOverrides={setOverrides}
        integrationStatus={integrationStatus}
        modelValidation={{}}
        setModelValidation={setModelValidation}
        onApplyPreset={onApplyPreset}
      />,
    );

    expect(screen.getByRole('button', { name: 'Codex' })).toBeInTheDocument();
  });

  it('renders project phase OpenRouter warnings and validates custom slugs on blur', async () => {
    const setOverrides = vi.fn();
    const setModelValidation = vi.fn();
    const validation: OpenRouterModelValidation = {
      modelId: 'anthropic/claude-opus-4.1',
      status: 'invalid',
      message: 'Model is not available to this key',
    };
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'integrations:validate-openrouter-model') return validation;
      return null;
    });
    window.shipcode = {
      ...window.shipcode,
      invoke: invoke as typeof window.shipcode.invoke,
    };
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      plannerModel: 'codex',
      plannerReasoningEffort: 'xhigh',
    };
    const overrides = {
      plannerModelOverride: 'openrouter' as const,
      reviewerModelOverride: null,
      executorModelOverride: null,
      verifierModelOverride: null,
      plannerModelIdOverride: 'legacy/model',
      reviewerModelIdOverride: null,
      executorModelIdOverride: null,
      verifierModelIdOverride: null,
      plannerReasoningEffortOverride: 'xhigh' as const,
      reviewerReasoningEffortOverride: null,
      executorReasoningEffortOverride: null,
      verifierReasoningEffortOverride: null,
      revisionCountOverride: null,
      requireApprovalOverride: null,
      pipelineSpeedProfileOverride: null,
      prdQualityGate: null,
      discordRouting: 'inherit' as const,
      discordWebhookUrlOverride: null,
      telegramRouting: 'inherit' as const,
      telegramChatIdOverride: null,
    };

    render(
      <ProjectPhaseSettingsRow
        phase="planner"
        label="Planner"
        validProviders={['claude', 'codex', 'openrouter']}
        settings={settings}
        projectDraft={makeProject()}
        overrides={overrides}
        setOverrides={setOverrides}
        integrationStatus={{
          ...integrationStatus,
          openrouter: {
            ...integrationStatus.openrouter,
            authStatus: 'missing_key',
            message: 'OpenRouter key is missing',
          },
        }}
        modelValidation={{ planner: validation }}
        setModelValidation={setModelValidation}
      />,
    );

    expect(screen.getByText('OpenRouter key is missing')).toBeInTheDocument();
    expect(screen.getByText('Model is not available to this key')).toBeInTheDocument();
    expect(screen.getByText(/may remap unsupported effort levels/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Custom OpenRouter slug'), {
      target: { value: '  anthropic/claude-opus-4.1  ' },
    });
    fireEvent.blur(screen.getByLabelText('Custom OpenRouter slug'));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('integrations:validate-openrouter-model', {
        modelId: 'anthropic/claude-opus-4.1',
      });
    });

    const overrideUpdater = setOverrides.mock.calls.at(-1)?.[0];
    expect(typeof overrideUpdater).toBe('function');
    expect(overrideUpdater(overrides)).toMatchObject({
      plannerModelIdOverride: 'anthropic/claude-opus-4.1',
    });

    const validationUpdater = setModelValidation.mock.calls.at(-1)?.[0];
    expect(typeof validationUpdater).toBe('function');
    expect(validationUpdater({})).toEqual({ planner: validation });
  });
});
