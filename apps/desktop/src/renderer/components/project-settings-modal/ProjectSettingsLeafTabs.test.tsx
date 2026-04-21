// @vitest-environment jsdom

import type { AppSettings, ContextFileInfo, IntegrationStatus, Project } from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectSettingsContextTab } from './ProjectSettingsContextTab';
import { ProjectSettingsGeneralTab } from './ProjectSettingsGeneralTab';
import { ProjectSettingsModelsTab } from './ProjectSettingsModelsTab';

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
  },
};

describe('project settings leaf tabs', () => {
  it('renders context file status and generator states', () => {
    const setContextGeneratorCli = vi.fn();
    const onGenerateContext = vi.fn();
    const contextFiles: ContextFileInfo[] = [
      { name: 'GOAL.md', exists: true, size: 1200 },
      { name: 'TECH-STACK.md', exists: true, size: 900 },
      { name: 'ARCHITECTURE.md', exists: false },
      { name: 'CONSTRAINTS.md', exists: false },
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

    expect(screen.getByText('Context Files')).toBeInTheDocument();
    expect(screen.getByText('GOAL.md')).toBeInTheDocument();
    expect(screen.getByText('1.2 KB')).toBeInTheDocument();
    expect(screen.getByText('900 B')).toBeInTheDocument();
    expect(screen.getByText('Generator failed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Generate Context' }));
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

    expect(screen.getByRole('button', { name: 'Generating...' })).toBeDisabled();
  });

  it('renders general project state and forwards input and button actions', () => {
    const setUrlInput = vi.fn();
    const setTouched = vi.fn();
    const onRelink = vi.fn();
    const onSync = vi.fn();

    render(
      <ProjectSettingsGeneralTab
        project={makeProject()}
        urlInput="https://github.com/orgs/shipshitdev/projects/1"
        setUrlInput={setUrlInput}
        setTouched={setTouched}
        showInlineError={true}
        validationOk={false}
        validationReason="Not a valid project URL"
        relinkPending={false}
        relinkError="Folder lookup failed"
        onRelink={onRelink}
        canSync={true}
        syncPending={false}
        syncResult={{
          attached: 2,
          alreadyPresent: 1,
          failed: 1,
          errors: ['Issue #19 failed'],
        }}
        syncError="Sync partially failed"
        hasSavedUrl={true}
        inputMatchesSaved={true}
        onSync={onSync}
      />,
    );

    expect(screen.getByText(/This path is missing\./)).toBeInTheDocument();
    expect(screen.getByText('Folder lookup failed')).toBeInTheDocument();
    expect(screen.getByText('Not a valid project URL')).toBeInTheDocument();
    expect(screen.getByText(/Attached 2, already present 1, failed 1/)).toBeInTheDocument();
    expect(screen.getByText(/Issue #19 failed/)).toBeInTheDocument();
    expect(screen.getByText('Sync partially failed')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('GitHub Projects board URL'), {
      target: { value: 'https://github.com/orgs/shipshitdev/projects/2' },
    });
    fireEvent.blur(screen.getByLabelText('GitHub Projects board URL'));

    fireEvent.click(screen.getByRole('button', { name: 'Change folder...' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sync existing issues to board' }));

    expect(setUrlInput).toHaveBeenCalledWith('https://github.com/orgs/shipshitdev/projects/2');
    expect(setTouched).toHaveBeenCalledWith(true);
    expect(onRelink).toHaveBeenCalledTimes(1);
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it('renders model preset actions and forwards the apply/reset callbacks', () => {
    const onApplyPreset = vi.fn();
    const onResetIssueOverrides = vi.fn();
    const setOverrides = vi.fn();
    const setModelValidation = vi.fn();
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      openrouterDefaultPaidModel: 'openrouter/auto',
    };

    render(
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
        onResetIssueOverrides={onResetIssueOverrides}
        issueOverrideResetPending={false}
        issueOverrideResetResult="Reset issue overrides on 2 issues."
        issueOverrideResetError={null}
      />,
    );

    expect(screen.getByText('Reset issue overrides on 2 issues.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Claude' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply Codex' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply Hybrid' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset All Issue Overrides' }));

    expect(onApplyPreset).toHaveBeenNthCalledWith(1, 'claude');
    expect(onApplyPreset).toHaveBeenNthCalledWith(2, 'codex');
    expect(onApplyPreset).toHaveBeenNthCalledWith(3, 'hybrid');
    expect(onResetIssueOverrides).toHaveBeenCalledTimes(1);
  });
});
