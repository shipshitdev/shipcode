import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type IntegrationStatus } from '@shipcode/shared';
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

  it('renders CLI and OpenRouter integration status', async () => {
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
    };

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'integrations:check') return integrations;
      return [];
    });

    renderWithProviders();

    expect(await screen.findByText('CLI Integrations')).toBeInTheDocument();
    expect(screen.getByText('Claude CLI')).toBeInTheDocument();
    expect(screen.getByText('Codex CLI')).toBeInTheDocument();
    expect(screen.getByText('GitHub CLI')).toBeInTheDocument();
    expect(screen.getByText('OpenRouter')).toBeInTheDocument();
    expect(screen.getByText('OPENROUTER_API_KEY detected')).toBeInTheDocument();
    expect(screen.getByText('Default paid model')).toBeInTheDocument();
  });
});
