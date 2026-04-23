import {
  type ContextFileInfo,
  DEFAULT_SETTINGS,
  type IntegrationStatus,
  type Project,
} from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { ProjectSettingsModal } from './ProjectSettingsModal';

vi.mock('electron-log/renderer', () => ({
  default: {
    error: vi.fn(),
  },
}));

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
      <ProjectSettingsModal />
    </QueryClientProvider>,
  );
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
    },
  };

  const contextFiles: ContextFileInfo[] = [
    { name: 'goal.md', exists: true, size: 512 },
    { name: 'architecture.md', exists: true, size: 256 },
    { name: 'constraints.md', exists: false },
    { name: 'do-dont.md', exists: false },
  ];

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
    expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pipeline' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Models' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Memory' })).toBeInTheDocument();
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
});
