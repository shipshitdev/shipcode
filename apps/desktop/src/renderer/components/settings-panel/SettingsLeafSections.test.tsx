// @vitest-environment jsdom

import type { GitHubIssueCacheRecord, IntegrationStatus, Project } from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArchivedSettingsSection } from './ArchivedSettingsSection';
import { AutoCommitSettingsSection } from './AutoCommitSettingsSection';
import { GithubSettingsSection } from './GithubSettingsSection';
import { IntegrationsSettingsSection } from './IntegrationsSettingsSection';
import { NotificationsSettingsSection } from './NotificationsSettingsSection';
import { ShortcutsSection } from './ShortcutsSection';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'ShipCode',
    path: '/tmp/shipcode',
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
    hidden: false,
    notifyGithubUser: null,
    archived: true,
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
    ...overrides,
  };
}

function makeIssue(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 19,
    title: 'Fix the board',
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
    fetchedAt: '2026-04-16T00:00:00.000Z',
    priorityRank: null,
    priorityRaw: null,
    priorityFetchedAt: null,
    isQuickMode: false,
    ...overrides,
  };
}

const integrationStatus: IntegrationStatus = {
  system: {
    claude: {
      available: false,
      version: null,
      path: null,
      error: 'Claude CLI missing',
      authenticated: false,
    },
    codex: {
      available: true,
      version: 'codex 0.1.0\nextra line',
      path: '/usr/local/bin/codex',
      error: null,
      authenticated: false,
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
  modelCapabilities: {
    claude: {
      provider: 'claude',
      source: 'fallback',
      models: [],
      error: 'No Claude models reported',
      checkedAt: '2026-05-08T10:00:00.000Z',
    },
    codex: {
      provider: 'codex',
      source: 'catalog',
      models: [
        {
          value: 'gpt-5.4-mini',
          label: 'GPT-5.4 mini',
          description: null,
          defaultReasoningEffort: 'medium',
          supportedReasoningEfforts: ['low', 'medium', 'high'],
        },
      ],
      error: null,
      checkedAt: '2026-05-08T10:00:00.000Z',
    },
    gemini: {
      provider: 'gemini',
      source: 'fallback',
      models: [],
      error: 'No Gemini models reported',
      checkedAt: '2026-05-08T10:00:00.000Z',
    },
  },
  ghAuth: {
    installed: true,
    authenticated: true,
    username: 'decod3rs',
    version: '2.40.1',
    error: null,
    hasProjectScope: false,
  },
  openrouter: {
    enabled: true,
    keyPresent: false,
    authStatus: 'missing_key',
    message: 'OpenRouter key is missing',
    label: null,
    modelChecks: [
      {
        key: 'planner',
        label: 'Planner model',
        modelId: null,
        status: 'unverified',
        message: 'Skipped without a key',
      },
    ],
  },
  discord: {
    enabled: true,
    configured: true,
    destinationConfigured: true,
    validationStatus: 'invalid',
    message: 'Discord webhook failed validation',
    lastDeliveryStatus: {
      provider: 'discord',
      destination: 'https://discord.test/webhook',
      lastAttemptAt: '2026-05-08T09:00:00.000Z',
      lastSuccessAt: null,
      lastError: 'HTTP 401',
    },
  },
  telegram: {
    enabled: true,
    configured: true,
    destinationConfigured: true,
    validationStatus: 'valid',
    message: null,
    lastDeliveryStatus: {
      provider: 'telegram',
      destination: '-100',
      lastAttemptAt: '2026-05-08T10:00:00.000Z',
      lastSuccessAt: '2026-05-08T10:00:00.000Z',
      lastError: null,
    },
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
      available: false,
      path: null,
      error: 'T3 Code is not installed',
    },
  },
};

afterEach(() => {
  cleanup();
});

describe('settings leaf sections', () => {
  it('renders the keyboard shortcuts reference grouped by category', () => {
    render(<ShortcutsSection />);

    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Navigation')).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('Command Palette')).toBeInTheDocument();
    expect(screen.getByText('Toggle Terminal')).toBeInTheDocument();
  });

  it('updates GitHub settings values through the provided callback', () => {
    const onUpdate = vi.fn();

    render(<GithubSettingsSection settings={DEFAULT_SETTINGS} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByRole('switch', { name: 'Polling enabled' }));
    fireEvent.change(screen.getByLabelText('Poll interval (ms)'), {
      target: { value: '45000' },
    });
    fireEvent.click(screen.getByRole('switch', { name: 'P0 — Critical' }));

    expect(onUpdate).toHaveBeenCalledWith({ githubPollingEnabled: true });
    expect(onUpdate).toHaveBeenCalledWith({ githubPollingIntervalMs: 45000 });
    expect(onUpdate).toHaveBeenCalledWith({ autoRunPriorities: ['p0'] });
  });

  it('updates auto-commit and cleanup settings', () => {
    const onUpdate = vi.fn();
    const settings = {
      ...DEFAULT_SETTINGS,
      autoCommitEnabled: false,
      autoCommitProvider: 'codex' as const,
      autoCommitModel: 'openrouter/auto',
      cleanupCriteria: {
        ...DEFAULT_SETTINGS.cleanupCriteria,
        worktreeMergedPr: false,
        localBranchNoRemote: false,
      },
    };

    render(
      <AutoCommitSettingsSection
        settings={settings}
        integrationStatus={integrationStatus}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }));
    fireEvent.change(screen.getByLabelText('Custom model'), {
      target: { value: 'gpt-5.4-mini' },
    });
    fireEvent.blur(screen.getByLabelText('Custom model'));
    fireEvent.click(screen.getByRole('switch', { name: 'Worktrees with merged PR' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Local branches with no remote' }));

    expect(onUpdate).toHaveBeenCalledWith({ autoCommitEnabled: true });
    expect(onUpdate).toHaveBeenCalledWith({ autoCommitModel: 'gpt-5.4-mini' });
    expect(onUpdate).toHaveBeenCalledWith({
      cleanupCriteria: { ...settings.cleanupCriteria, worktreeMergedPr: true },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      cleanupCriteria: { ...settings.cleanupCriteria, localBranchNoRemote: true },
    });
  });

  it('updates notification toggles and disables children when notifications are off', () => {
    const onUpdate = vi.fn();

    render(
      <NotificationsSettingsSection
        settings={{ ...DEFAULT_SETTINGS, notificationsEnabled: false }}
        onUpdate={onUpdate}
      />,
    );

    expect(screen.getByRole('switch', { name: 'OS notifications' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Pipeline completed' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Chat alert: Pipeline completed' })).toBeEnabled();

    cleanup();

    render(<NotificationsSettingsSection settings={DEFAULT_SETTINGS} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByRole('switch', { name: 'Enable notifications' }));
    fireEvent.click(screen.getByRole('switch', { name: 'OS notifications' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Dock badge count' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Play sound' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Needs approval' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Pipeline failed' }));
    fireEvent.click(screen.getByRole('switch', { name: 'CI blocked' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Pipeline completed' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Verification retries exhausted' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Chat alert: Needs approval' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Chat alert: Pipeline failed' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Chat alert: CI blocked' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Chat alert: Pipeline completed' }));
    fireEvent.click(
      screen.getByRole('switch', { name: 'Chat alert: Verification retries exhausted' }),
    );

    expect(onUpdate).toHaveBeenCalledWith({ notificationsEnabled: false });
    expect(onUpdate).toHaveBeenCalledWith({ notificationOsEnabled: false });
    expect(onUpdate).toHaveBeenCalledWith({ notificationBadgeEnabled: false });
    expect(onUpdate).toHaveBeenCalledWith({ notificationSoundEnabled: false });
    expect(onUpdate).toHaveBeenCalledWith({
      notificationEvents: { ...DEFAULT_SETTINGS.notificationEvents, approval: false },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      notificationEvents: { ...DEFAULT_SETTINGS.notificationEvents, failed: false },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      notificationEvents: { ...DEFAULT_SETTINGS.notificationEvents, ciBlocked: false },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      notificationEvents: { ...DEFAULT_SETTINGS.notificationEvents, completed: false },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      notificationEvents: {
        ...DEFAULT_SETTINGS.notificationEvents,
        verificationExhausted: false,
      },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      chatNotificationEvents: {
        ...DEFAULT_SETTINGS.chatNotificationEvents,
        approval: false,
      },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      chatNotificationEvents: {
        ...DEFAULT_SETTINGS.chatNotificationEvents,
        failed: false,
      },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      chatNotificationEvents: {
        ...DEFAULT_SETTINGS.chatNotificationEvents,
        ciBlocked: false,
      },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      chatNotificationEvents: {
        ...DEFAULT_SETTINGS.chatNotificationEvents,
        completed: true,
      },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      chatNotificationEvents: {
        ...DEFAULT_SETTINGS.chatNotificationEvents,
        verificationExhausted: false,
      },
    });
  });

  it('renders archived projects and issues and forwards restore actions', async () => {
    const onUnarchiveProject = vi.fn();
    const onUnarchiveIssue = vi.fn();

    render(
      <ArchivedSettingsSection
        archivedProjects={[makeProject({ id: 'project-2', name: 'Archive Me' })]}
        archivedIssues={[makeIssue({ id: 'issue-2', issueNumber: 42, title: 'Restore issue' })]}
        unarchiveProjectPending={false}
        unarchiveIssuePending={false}
        onUnarchiveProject={onUnarchiveProject}
        onUnarchiveIssue={onUnarchiveIssue}
      />,
    );

    expect(screen.getByText('Archive Me')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onUnarchiveProject).toHaveBeenCalledWith('project-2');

    const issuesTab = screen.getByRole('tab', { name: 'Issues' });
    fireEvent.click(issuesTab);
    fireEvent.keyDown(issuesTab, { key: 'Enter' });

    await waitFor(() => {
      expect(issuesTab).toHaveAttribute('aria-selected', 'true');
    });

    expect(screen.getByText('#42 Restore issue')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onUnarchiveIssue).toHaveBeenCalledWith('issue-2');
  });

  it('renders empty archived lists and disables restore actions while pending', async () => {
    const empty = render(
      <ArchivedSettingsSection
        archivedProjects={[]}
        archivedIssues={[]}
        unarchiveProjectPending={false}
        unarchiveIssuePending={false}
        onUnarchiveProject={vi.fn()}
        onUnarchiveIssue={vi.fn()}
      />,
    );

    expect(screen.getByText('No archived projects.')).toBeInTheDocument();
    const emptyIssuesTab = screen.getByRole('tab', { name: 'Issues' });
    fireEvent.click(emptyIssuesTab);
    fireEvent.keyDown(emptyIssuesTab, { key: 'Enter' });
    await waitFor(() => {
      expect(emptyIssuesTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('No archived issues.')).toBeInTheDocument();
    });
    empty.unmount();

    render(
      <ArchivedSettingsSection
        archivedProjects={[makeProject({ id: 'project-2', name: 'Archive Me' })]}
        archivedIssues={[makeIssue({ id: 'issue-2', issueNumber: 42, title: 'Restore issue' })]}
        unarchiveProjectPending={true}
        unarchiveIssuePending={true}
        onUnarchiveProject={vi.fn()}
        onUnarchiveIssue={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();
    const pendingIssuesTab = screen.getByRole('tab', { name: 'Issues' });
    fireEvent.click(pendingIssuesTab);
    fireEvent.keyDown(pendingIssuesTab, { key: 'Enter' });
    await waitFor(() => {
      expect(pendingIssuesTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();
    });
  });

  it('renders integration status branches and forwards chat setting actions', async () => {
    const onUpdate = vi.fn();
    const onRefetch = vi.fn();
    const onTestChat = vi.fn(async (provider: 'discord' | 'telegram') => `${provider} ok`);

    render(
      <IntegrationsSettingsSection
        integrationStatus={undefined}
        integrationsFetching={true}
        settings={DEFAULT_SETTINGS}
        onUpdate={onUpdate}
        onRefetch={onRefetch}
        onTestChat={onTestChat}
      />,
    );

    expect(screen.getByText(/Loading integration status/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-check' })).toBeDisabled();

    cleanup();

    render(
      <IntegrationsSettingsSection
        integrationStatus={integrationStatus}
        integrationsFetching={false}
        settings={{
          ...DEFAULT_SETTINGS,
          discordWebhookUrl: 'https://discord.test/webhook',
          telegramBotToken: 'token',
          telegramDefaultChatId: '-100',
        }}
        onUpdate={onUpdate}
        onRefetch={onRefetch}
        onTestChat={onTestChat}
      />,
    );

    expect(screen.getByText('Claude CLI missing')).toBeInTheDocument();
    expect(screen.getByText('No Claude models reported')).toBeInTheDocument();
    expect(screen.getByText('codex 0.1.0')).toBeInTheDocument();
    expect(screen.getByText('project scope missing')).toBeInTheDocument();
    expect(screen.getByText(/gh auth refresh -s project/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }));
    expect(onRefetch).toHaveBeenCalledTimes(1);

    const apiKeysTab = screen.getByRole('tab', { name: 'API Keys' });
    fireEvent.mouseDown(apiKeysTab, { button: 0 });
    fireEvent.click(apiKeysTab);

    expect(screen.getByText('OPENROUTER_API_KEY missing')).toBeInTheDocument();
    expect(screen.getByText('OpenRouter key is missing')).toBeInTheDocument();
    expect(screen.getByText('disabled')).toBeInTheDocument();
    expect(screen.getByText('Last delivery: HTTP 401')).toBeInTheDocument();
    expect(screen.getByText(/Last delivery succeeded at/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Enable Discord chat alerts'));
    fireEvent.change(screen.getByPlaceholderText('https://discord.com/api/webhooks/...'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Send test message' })[0]);

    await waitFor(() => {
      expect(screen.getByText('discord ok')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Enable Telegram chat alerts'));
    fireEvent.change(screen.getByPlaceholderText('Bot token'), { target: { value: '' } });
    fireEvent.change(screen.getByPlaceholderText('Default chat ID'), {
      target: { value: '-200' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Send test message' })[1]);

    await waitFor(() => {
      expect(screen.getByText('telegram ok')).toBeInTheDocument();
    });

    expect(onUpdate).toHaveBeenCalledWith({ discordEnabled: true });
    expect(onUpdate).toHaveBeenCalledWith({ discordWebhookUrl: null });
    expect(onUpdate).toHaveBeenCalledWith({ telegramEnabled: true });
    expect(onUpdate).toHaveBeenCalledWith({ telegramBotToken: null });
    expect(onUpdate).toHaveBeenCalledWith({ telegramDefaultChatId: '-200' });
    expect(onTestChat).toHaveBeenCalledWith('discord');
    expect(onTestChat).toHaveBeenCalledWith('telegram');
  });
});
