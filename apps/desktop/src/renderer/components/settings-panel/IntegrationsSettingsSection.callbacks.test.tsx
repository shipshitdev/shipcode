// @vitest-environment jsdom

import { DEFAULT_SETTINGS, type IntegrationStatus } from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntegrationsSettingsSection } from './IntegrationsSettingsSection';

vi.mock('@shipshitdev/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipshitdev/ui')>();
  const selectValues = ['terminal', 'ghostty', 'cursor', 'finder', 'vscode', 't3code'];

  return {
    ...actual,
    Select: ({
      children,
      onValueChange,
      value,
    }: {
      children: ReactNode;
      onValueChange: (value: string) => void;
      value: string;
    }) => (
      <div data-select-value={value}>
        {children}
        {selectValues.map((next) => (
          <button
            key={next}
            type="button"
            data-testid={`select-${value}-${next}`}
            onClick={() => onValueChange(next)}
          >
            select {next}
          </button>
        ))}
      </div>
    ),
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children }: { children: ReactNode; disabled?: boolean; value: string }) => (
      <div>{children}</div>
    ),
    SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectValue: () => <span />,
    Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TabsContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
    TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TabsTrigger: ({ children }: { children: ReactNode; value: string }) => (
      <button type="button">{children}</button>
    ),
  };
});

const status: IntegrationStatus = {
  system: {
    claude: {
      available: true,
      version: 'claude 2.0\nextra',
      path: '/usr/local/bin/claude',
      error: null,
      authenticated: true,
    },
    codex: {
      available: true,
      version: null,
      path: null,
      error: null,
      authenticated: false,
    },
    git: {
      available: true,
      version: 'git version 2.45.0',
      path: '/usr/bin/git',
      error: null,
      authenticated: true,
    },
    gh: {
      available: true,
      version: 'gh version 2.50.0',
      path: '/opt/homebrew/bin/gh',
      error: null,
      authenticated: true,
    },
    gemini: {
      available: true,
      version: 'gemini 1.0',
      path: '/usr/local/bin/gemini',
      error: null,
      authenticated: false,
    },
  },
  modelCapabilities: undefined,
  ghAuth: {
    installed: true,
    authenticated: true,
    username: 'decod3rs',
    version: '2.50.0',
    error: null,
    hasProjectScope: true,
  },
  openrouter: {
    enabled: true,
    keyPresent: true,
    authStatus: 'valid',
    message: null,
    label: 'shipcode-key',
    modelChecks: [
      {
        key: 'planner',
        label: 'Planner model',
        modelId: 'openrouter/auto',
        status: 'valid',
        message: null,
      },
      {
        key: 'executor',
        label: 'Executor model',
        modelId: 'missing/model',
        status: 'invalid',
        message: 'Model rejected',
      },
      {
        key: 'verifier',
        label: 'Verifier model',
        modelId: null,
        status: 'unverified',
        message: 'Not checked yet',
      },
    ],
  },
  discord: {
    enabled: true,
    configured: true,
    destinationConfigured: true,
    validationStatus: 'valid',
    message: null,
    lastDeliveryStatus: {
      provider: 'discord',
      destination: 'https://discord.test/webhook',
      lastAttemptAt: '2026-05-09T10:00:00.000Z',
      lastSuccessAt: '2026-05-09T10:01:00.000Z',
      lastError: null,
    },
  },
  telegram: {
    enabled: true,
    configured: true,
    destinationConfigured: true,
    validationStatus: 'unknown',
    message: 'Telegram has not been checked',
    lastDeliveryStatus: {
      provider: 'telegram',
      destination: '-100',
      lastAttemptAt: '2026-05-09T10:00:00.000Z',
      lastSuccessAt: null,
      lastError: 'chat not found',
    },
  },
  desktopApps: {
    cursor: {
      key: 'cursor',
      label: 'Cursor',
      available: false,
      path: null,
      error: 'Cursor missing',
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
      available: true,
      path: '/Applications/Ghostty.app',
      error: null,
    },
    vscode: {
      key: 'vscode',
      label: 'Visual Studio Code',
      available: false,
      path: null,
      error: 'VS Code missing',
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

afterEach(() => {
  cleanup();
});

describe('IntegrationsSettingsSection callback coverage', () => {
  it('renders all integration status variants and forwards opener select changes', () => {
    const onUpdate = vi.fn();

    render(
      <IntegrationsSettingsSection
        integrationStatus={status}
        integrationsFetching={false}
        settings={{
          ...DEFAULT_SETTINGS,
          projectOpenTarget: 'cursor',
          terminalOpenTarget: 'terminal',
        }}
        onUpdate={onUpdate}
        onRefetch={vi.fn()}
        onTestChat={vi.fn(async (provider: 'discord' | 'telegram') => `${provider} ok`)}
      />,
    );

    expect(screen.getByText('claude 2.0')).toBeInTheDocument();
    expect(screen.getByText('project scope granted')).toBeInTheDocument();
    expect(screen.getByText('OPENROUTER_API_KEY detected')).toBeInTheDocument();
    expect(screen.getByText('shipcode-key')).toBeInTheDocument();
    expect(screen.getByText('Model rejected')).toBeInTheDocument();
    expect(screen.getByText('Not checked yet')).toBeInTheDocument();
    expect(screen.getByText(/Last delivery succeeded at/)).toBeInTheDocument();
    expect(screen.getByText('Last delivery: chat not found')).toBeInTheDocument();
    expect(screen.getByText('Cursor missing')).toBeInTheDocument();
    expect(screen.getByText('VS Code missing')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('select-terminal-ghostty'));
    fireEvent.click(screen.getByTestId('select-cursor-finder'));

    expect(onUpdate).toHaveBeenCalledWith({ terminalOpenTarget: 'ghostty' });
    expect(onUpdate).toHaveBeenCalledWith({ projectOpenTarget: 'finder' });
  });
});
