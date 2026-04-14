import { DEFAULT_SETTINGS, type IntegrationStatus } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { SettingsPanel } from './SettingsPanel';

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
      <SettingsPanel />
    </QueryClientProvider>,
  );
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
  } as const;
}

describe('SettingsPanel', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    cleanup();
    invokeMock.mockReset();
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;

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
    expect(screen.getByRole('tab', { name: 'API Keys' })).toBeInTheDocument();
    expect(screen.getByText('Project opener')).toBeInTheDocument();
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
    expect(screen.getByRole('tab', { name: 'Labels' })).toBeInTheDocument();
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

    expect(await screen.findByText('Project opener')).toBeInTheDocument();
    expect(screen.getByLabelText('Default app')).toBeInTheDocument();
    expect(screen.getByText('Visual Studio Code')).toBeInTheDocument();
    expect(screen.getByText('Ghostty')).toBeInTheDocument();
  });
});
